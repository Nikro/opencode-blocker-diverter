/**
 * Session lifecycle for the OpenCode 2.x host.
 *
 * Re-expresses the v1 session hooks on v2 durable events (see docs/adr/opencode-v2-port.md, decisions 4 and 6):
 * - `session.created` / `session.deleted`: state init, parent inheritance, cleanup
 * - `session.text.ended`: last assistant text and completion marker
 * - `session.execution.succeeded`: the v1 `session.idle` handler (completion, continue prompt)
 * - `session.execution.failed`: recovery flag (skips the next idle, as v1 did)
 * - `session.execution.interrupted` (reason `user`): user cancellation, disables divert
 *
 * @module v2/session
 */

import type { LogClient, Config } from '../config'
import { getState, cleanupState, updateState } from '../state'
import { logDebug, logError, logInfo, logWarn } from '../utils/logging'
import { getStopPrompt } from '../utils/templates'
import { withTimeout, TimeoutError } from '../utils/with-timeout'
import { shouldContinue } from '../hooks/session'

export interface V2SessionDeps {
  readonly client: LogClient
  readonly config: Config
  readonly synthetic: (input: { sessionID: string; text: string }) => Promise<unknown>
  /** Sessions whose default divert value has been applied (per plugin instance) */
  readonly initialized: Set<string>
  /** Child session IDs by parent session ID, from created events (per plugin instance) */
  readonly children: Map<string, Set<string>>
}

/**
 * Applies `defaultDivertBlockers` once per session. Called from the created event and from every
 * hook, because the created event can be published before the event subscription is connected
 * (a headless `run` creates its session right after plugin load).
 */
export function ensureSession(deps: V2SessionDeps, sessionID: string): void {
  if (deps.initialized.has(sessionID)) return
  deps.initialized.add(sessionID)
  updateState(sessionID, (s) => {
    s.divertBlockers = deps.config.defaultDivertBlockers
  })
}

function disableDivert(sessionID: string): void {
  updateState(sessionID, (s) => {
    s.divertBlockers = false
    s.repromptCount = 0
    s.lastRepromptTime = 0
  })
}

/** Turns divert off for every descendant of `sessionID` (children, grandchildren, ...). The session itself is untouched. */
export function disableDescendantsDivert(deps: V2SessionDeps, sessionID: string): void {
  const seen = new Set<string>()
  const pending = [...(deps.children.get(sessionID) ?? [])]
  for (let childID = pending.pop(); childID !== undefined; childID = pending.pop()) {
    if (seen.has(childID)) continue
    seen.add(childID)
    disableDivert(childID)
    pending.push(...(deps.children.get(childID) ?? []))
  }
}

/** Fail-closed: turns divert off for every session this plugin instance has seen. */
export function disableAllDivert(deps: V2SessionDeps): void {
  for (const sessionID of deps.initialized) disableDivert(sessionID)
}

export async function handleSessionCreated(
  deps: V2SessionDeps,
  sessionID: string,
  parentID: string | undefined
): Promise<void> {
  const { client, config } = deps
  const stateBefore = getState(sessionID).divertBlockers

  ensureSession(deps, sessionID)

  if (parentID) {
    const siblings = deps.children.get(parentID) ?? new Set<string>()
    siblings.add(sessionID)
    deps.children.set(parentID, siblings)
  }

  if (parentID && getState(parentID).divertBlockers) {
    updateState(sessionID, (s) => {
      s.divertBlockers = true
    })
    await logInfo(client, 'Inherited divertBlockers=true from parent session', { sessionID, parentID })
  }

  const divertAfter = getState(sessionID).divertBlockers
  await logInfo(client, 'Session created', {
    sessionID,
    divertBlockersBefore: stateBefore,
    divertBlockersAfter: divertAfter,
    configDefault: config.defaultDivertBlockers,
  })

  if (divertAfter) {
    await logWarn(client, '⚠️  Blocker diverter auto-enabled via config. Use /blockers.off or /blockers.stop to disable.', {
      sessionID,
    })
  }
}

export async function handleSessionDeleted(deps: V2SessionDeps, sessionID: string): Promise<void> {
  const state = getState(sessionID)
  await logInfo(deps.client, 'Session ended', {
    sessionId: sessionID,
    blockersLogged: state.blockers.length,
    repromptCount: state.repromptCount,
  })
  cleanupState(sessionID)
  deps.initialized.delete(sessionID)
  deps.children.delete(sessionID)
  for (const [parentID, siblings] of deps.children) {
    siblings.delete(sessionID)
    if (siblings.size === 0) deps.children.delete(parentID)
  }
}

export async function handleTextEnded(deps: V2SessionDeps, sessionID: string, text: string): Promise<void> {
  if (!text) return
  updateState(sessionID, (s) => {
    s.lastMessageContent = text
  })
  if (text.includes(deps.config.completionMarker)) {
    updateState(sessionID, (s) => {
      s.completionMarkerDetected = true
    })
  }
  await logDebug(deps.client, 'Captured assistant text', { sessionID, textLength: text.length })
}

export function handleExecutionFailed(deps: V2SessionDeps, sessionID: string): void {
  updateState(sessionID, (s) => {
    s.isRecovering = true
  })
  void logDebug(deps.client, 'Execution failed - next idle reprompt will be skipped', { sessionID })
}

export async function handleExecutionInterrupted(
  deps: V2SessionDeps,
  sessionID: string,
  reason: string
): Promise<void> {
  if (reason !== 'user') return
  const state = getState(sessionID)
  if (!state.divertBlockers) return
  updateState(sessionID, (s) => {
    s.divertBlockers = false
    s.repromptCount = 0
    s.lastRepromptTime = 0
  })
  disableDescendantsDivert(deps, sessionID)
  await logInfo(deps.client, 'User cancellation detected (execution interrupted) - disabling blocker diverter', {
    sessionID,
  })
}

/**
 * Port of the v1 `session.idle` handler, triggered by `session.execution.succeeded`.
 */
export async function handleExecutionSucceeded(deps: V2SessionDeps, sessionID: string): Promise<void> {
  const { client, config } = deps
  const state = getState(sessionID)

  if (state.isRecovering) {
    updateState(sessionID, (s) => {
      s.isRecovering = false
    })
    await logDebug(client, 'Recovery complete - skipped idle reprompt', { sessionID })
    return
  }

  if (Date.now() - (state.lastRepromptTime || 0) > config.repromptWindowMs && state.repromptCount > 0) {
    updateState(sessionID, (s) => {
      s.repromptCount = 0
    })
  }

  const completionDetected =
    state.completionMarkerDetected || state.lastMessageContent.includes(config.completionMarker)
  if (completionDetected) {
    await logInfo(client, 'Completion marker detected - stopping autonomous session', {
      sessionID,
      marker: config.completionMarker,
      repromptCount: state.repromptCount,
    })
    updateState(sessionID, (s) => {
      s.divertBlockers = false
      s.repromptCount = 0
      s.lastRepromptTime = 0
      s.completionMarkerDetected = false
    })
    return
  }

  if (shouldContinue(state, config)) {
    await injectContinuePrompt(deps, sessionID)
    return
  }

  // A fast reply to a real continue prompt can end inside the cooldown. No further idle event
  // follows it, so dropping it would end the loop. Re-check once the cooldown is over. The wait is
  // a detached timer, because events are handled one at a time and a sleep here would delay a user
  // interrupt behind it. This also covers the idle right after /blockers.on, whose own cooldown
  // would otherwise swallow it and let the model stop after its confirmation reply.
  if (state.divertBlockers && state.repromptCount < config.maxReprompts) {
    const remaining = config.cooldownMs - (Date.now() - (state.lastRepromptTime || 0))
    if (remaining > 0) {
      const before = state.lastMessageContent
      const timer = setTimeout(() => {
        const next = getState(sessionID)
        // New assistant text means another turn began while waiting; its own idle event decides.
        if (next.lastMessageContent === before && shouldContinue(next, config)) {
          void injectContinuePrompt(deps, sessionID)
        }
      }, remaining + 50)
      timer.unref?.()
    }
  }
}

async function injectContinuePrompt(deps: V2SessionDeps, sessionID: string): Promise<void> {
  const { client, config } = deps
  const text = getStopPrompt(sessionID, config).body.parts[0].text
  try {
    await withTimeout(deps.synthetic({ sessionID, text }), config.promptTimeoutMs, 'Continue prompt injection')
    updateState(sessionID, (s) => {
      s.repromptCount++
      s.lastRepromptTime = Date.now()
    })
    await logInfo(client, 'Injected continuation prompt', {
      sessionID,
      repromptCount: getState(sessionID).repromptCount,
      blockerCount: getState(sessionID).blockers.length,
    })
  } catch (error) {
    if (error instanceof TimeoutError) {
      await logError(client, 'Continuation prompt timed out', error, { sessionID, timeoutMs: config.promptTimeoutMs })
    } else {
      await logError(client, 'Failed to inject continuation prompt', error as Error, { sessionID })
    }
  }
}
