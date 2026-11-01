/**
 * OpenCode 2.x setup for the Blocker Diverter plugin.
 *
 * Registers the same behavior as the v1 server plugin (see docs/adr/opencode-v2-port.md):
 * - `blocker` tool, question interception, ask-to-allow permission hook
 * - user prompt auto-disable, system prompt injection, compaction summary
 * - session lifecycle on durable events, continue prompts
 * - `/blockers.on|off|stop|status` commands (`/blockers.list` and `/blockers.clarify` stay markdown)
 *
 * @module v2/plugin
 */

import { createBlockerTool } from '../tools/blocker'
import { handleToolExecuteBefore } from '../hooks/tool-intercept'
import {
  handleOnCommand,
  handleOffCommand,
  handleStopCommand,
  handleStatusCommand,
  type CommandResult,
} from '../commands/blockers-cmd'
import { clearAllState, getState, updateState } from '../state'
import { logDebug, logError, logInfo } from '../utils/logging'
import { getBlockerToolDefinition, getSystemPromptTemplate } from '../utils/templates'
import { loadConfigV2 } from './config'
import { createFileLogClient, defaultLogFile } from './log-file'
import {
  disableAllDivert,
  disableDescendantsDivert,
  ensureSession,
  handleExecutionFailed,
  handleExecutionInterrupted,
  handleExecutionSucceeded,
  handleSessionCreated,
  handleSessionDeleted,
  handleTextEnded,
  type V2SessionDeps,
} from './session'
import type { V2CommandInvocation, V2Context, V2Cleanup, V2EventEnvelope, V2TextPart } from './types'

const BLOCKER_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    question: { type: 'string', minLength: 1, description: 'The exact blocking question you need answered' },
    category: {
      type: 'string',
      enum: ['architecture', 'security', 'destructive', 'permission', 'question', 'other'],
      description: 'Category of the blocker',
    },
    context: {
      type: 'string',
      description: 'STRUCTURED context: task reference, what you were doing, file paths with line numbers, progress so far',
    },
    blocksProgress: {
      type: 'boolean',
      description: 'True if this completely halts progress (hard blocker), false if you can make a default choice (soft blocker)',
    },
    options: { type: 'array', items: { type: 'string' }, description: 'For soft blockers: 3 potential choices' },
    chosenOption: { type: 'string', description: 'For soft blockers: the option you chose (must be from options)' },
    chosenReasoning: { type: 'string', description: 'For soft blockers: why you chose this option' },
  },
  required: ['question', 'category'],
}

const SESSION_EVENT_TYPES = [
  'session.created',
  'session.deleted',
  'session.text.ended',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
] as const

function resolveProjectDir(location: V2Context['location']): string {
  return [location.project.directory, location.directory].find((dir) => dir && dir !== '/') ?? '/'
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

const EVENT_RETRY_MIN_MS = 1_000
const EVENT_RETRY_MAX_MS = 30_000

export function nextRetryDelay(delayMs: number): number {
  return Math.min(delayMs * 2, EVENT_RETRY_MAX_MS)
}

export async function setupV2(ctx: V2Context): Promise<V2Cleanup | void> {
  const projectDir = resolveProjectDir(ctx.location)
  const logClient = createFileLogClient(defaultLogFile())
  const config = await loadConfigV2(projectDir, ctx.options, logClient)

  await logInfo(logClient, 'Blocker Diverter plugin initialized', {
    runtime: 'opencode-v2',
    enabled: config.enabled,
    projectBaseDir: projectDir,
    blockersFile: config.blockersFile,
    maxBlockersPerRun: config.maxBlockersPerRun,
  })

  if (!config.enabled) {
    await logInfo(logClient, 'Plugin disabled via config, skipping hook registration')
    return
  }

  const deps: V2SessionDeps = {
    client: logClient,
    config,
    synthetic: (input) => ctx.session.synthetic(input),
    initialized: new Set<string>(),
    children: new Map<string, Set<string>>(),
  }
  const abort = new AbortController()

  const blockerTool = createBlockerTool(logClient, config, projectDir)
  await ctx.tool.transform((editor) => {
    editor.add({
      name: 'blocker',
      description: blockerTool.description,
      input: BLOCKER_INPUT_SCHEMA,
      execute: async (input, context) => ({
        content: await blockerTool.execute(
          input as Parameters<typeof blockerTool.execute>[0],
          { sessionID: context.sessionID } as unknown as Parameters<typeof blockerTool.execute>[1]
        ),
      }),
    })
  })

  await ctx.tool.hook('execute.before', async (event) => {
    if (typeof event.sessionID !== 'string' || !event.sessionID) return
    ensureSession(deps, event.sessionID)
    await handleToolExecuteBefore(
      { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
      { args: event.input },
      logClient,
      config,
      projectDir
    )
  })

  // Only ask -> allow. Configured deny rules are evaluated before this hook runs
  // (packages/core/src/permission.ts), and this hook never writes 'deny'.
  await ctx.permission.hook('evaluate', (event) => {
    if (event.effect !== 'ask') return
    if (typeof event.sessionID !== 'string' || !event.sessionID) return
    // Unattended asks have no one to answer them; the host settles them, so never auto-allow.
    if (event.metadata?.unattended === true) return
    ensureSession(deps, event.sessionID)
    if (!getState(event.sessionID).divertBlockers) return
    event.effect = 'allow'
    void logInfo(logClient, 'Auto-allowed permission in autonomous mode', {
      sessionID: event.sessionID,
      action: event.action,
    })
  })

  // Port of the v1 chat.message user branch: a manual prompt hands control back to the user.
  await ctx.session.hook('prompt', (event) => {
    const sessionID = event.sessionID
    if (typeof sessionID !== 'string' || !sessionID) return
    ensureSession(deps, sessionID)
    const state = getState(sessionID)

    if (state.ignoreNextUserMessage) {
      updateState(sessionID, (s) => {
        s.ignoreNextUserMessage = false
      })
      void logDebug(logClient, 'Skipping auto-disable (command user-message absorbed)', { sessionID })
      return
    }
    if (!state.divertBlockers) return

    const hasAssistantMessage = state.lastMessageContent.trim().length > 0
    if (!(hasAssistantMessage || state.repromptCount > 0 || state.blockers.length > 0)) return

    updateState(sessionID, (s) => {
      s.divertBlockers = false
      s.repromptCount = 0
      s.lastRepromptTime = 0
    })
    disableDescendantsDivert(deps, sessionID)
    void logInfo(logClient, 'Auto-disabled blocker diverter (user message detected)', {
      sessionID,
      hasAssistantMessage,
      blockerCount: state.blockers.length,
    })
  })

  await ctx.session.hook('context', (event) => {
    if (typeof event.sessionID !== 'string' || !event.sessionID) return
    ensureSession(deps, event.sessionID)
    const state = getState(event.sessionID)
    if (!state.divertBlockers) return
    event.system.push(
      { type: 'text', text: getSystemPromptTemplate(state, config) },
      { type: 'text', text: getBlockerToolDefinition() }
    )
  })

  await ctx.session.hook('compaction', (event) => {
    if (typeof event.sessionID !== 'string' || !event.sessionID) return
    const state = getState(event.sessionID)
    const summary: V2TextPart = {
      type: 'text',
      text: `<active-blockers>
Recent blockers logged: ${state.blockers.length}
Latest: ${JSON.stringify(state.blockers.slice(-5), null, 2)}
</active-blockers>`,
    }
    event.system.push(summary)
  })

  const blockerCommand = (
    name: string,
    description: string,
    run: (sessionID: string) => Promise<CommandResult>
  ) => ({
    name,
    description,
    execute: async (input: V2CommandInvocation): Promise<void> => {
      ensureSession(deps, input.sessionID)
      const result = await run(input.sessionID)
      // Same reply text as v1: sent as a user message, which the prompt hook absorbs (ignoreNextUserMessage)
      if (result.handled && result.minimalResponse) {
        try {
          await ctx.session.prompt({ sessionID: input.sessionID, text: result.minimalResponse, delivery: input.delivery })
        } catch (error) {
          // The reply never reached the prompt hook, so nothing will absorb the flag; clear it
          updateState(input.sessionID, (s) => {
            s.ignoreNextUserMessage = false
          })
          throw error
        }
      }
    },
  })

  await ctx.command.transform((editor) => {
    editor.add(blockerCommand('blockers.on', 'Enable blocker interception for the current session', (id) =>
      handleOnCommand(getState(id), logClient)))
    editor.add(blockerCommand('blockers.off', 'Disable blocker interception for the current session', async (id) => {
      const result = await handleOffCommand(getState(id), logClient)
      disableDescendantsDivert(deps, id)
      return result
    }))
    editor.add(blockerCommand('blockers.stop', 'Emergency stop: disable blocker interception and reset reprompt state', async (id) => {
      const result = await handleStopCommand(getState(id), logClient)
      disableDescendantsDivert(deps, id)
      return result
    }))
    editor.add(blockerCommand('blockers.status', 'Show current blocker diverter state and blocker count', (id) =>
      handleStatusCommand(getState(id), logClient, config)))
  })

  void consumeEvents(ctx, abort.signal, deps)

  return async () => {
    abort.abort()
    clearAllState()
    deps.initialized.clear()
    deps.children.clear()
    await logInfo(logClient, 'Blocker Diverter plugin unloaded')
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Keeps the session event subscription alive. A failed or ended stream means session events are
 * missed, so divert is turned off for every session before resubscribing with backoff.
 */
async function consumeEvents(ctx: V2Context, signal: AbortSignal, deps: V2SessionDeps): Promise<void> {
  let retryDelayMs = EVENT_RETRY_MIN_MS
  while (!signal.aborted) {
    let failure: Error
    try {
      for await (const event of ctx.event.subscribe({ types: SESSION_EVENT_TYPES, signal })) {
        retryDelayMs = EVENT_RETRY_MIN_MS
        await dispatchEvent(event, deps)
      }
      failure = new Error('session event stream ended')
    } catch (error) {
      failure = error as Error
    }
    if (signal.aborted) return
    disableAllDivert(deps)
    await logError(deps.client, 'Session event stream failed, blocker diverter disabled for all sessions', failure, {
      retryInMs: retryDelayMs,
    })
    await sleep(retryDelayMs, signal)
    retryDelayMs = nextRetryDelay(retryDelayMs)
  }
}

async function dispatchEvent(event: V2EventEnvelope, deps: V2SessionDeps): Promise<void> {
  const sessionID = str(event.data, 'sessionID')
  if (!sessionID) return
  try {
    switch (event.type) {
      case 'session.created':
        await handleSessionCreated(deps, sessionID, str(event.data, 'parentID'))
        break
      case 'session.deleted':
        await handleSessionDeleted(deps, sessionID)
        break
      case 'session.text.ended':
        await handleTextEnded(deps, sessionID, str(event.data, 'text') ?? '')
        break
      case 'session.execution.succeeded':
        await handleExecutionSucceeded(deps, sessionID)
        break
      case 'session.execution.failed':
        handleExecutionFailed(deps, sessionID)
        break
      case 'session.execution.interrupted':
        await handleExecutionInterrupted(deps, sessionID, str(event.data, 'reason') ?? '')
        break
    }
  } catch (error) {
    await logError(deps.client, 'Error in session event handler', error as Error, { type: event.type, sessionID })
  }
}
