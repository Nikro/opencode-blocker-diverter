/**
 * Session lifecycle hooks for Blocker Diverter plugin
 * 
 * Handles session creation, deletion, idle, compaction, and error events.
 * Manages session state initialization and cleanup, and preserves blocker
 * context during session compaction.
 * 
 * @module hooks/session
 */

import type { Plugin, PluginConfig, SessionState } from '../types'
import { getState, cleanupState, updateState } from '../state'
import { logInfo, logWarn, logError, logDebug } from '../utils/logging'
import { loadConfig } from '../config'
import { getStopPrompt } from '../utils/templates'
import { withTimeout, TimeoutError } from '../utils/with-timeout'

/**
 * Session event structure from OpenCode SDK
 * Events have a type and properties object with event-specific data
 */
interface SessionEvent {
  type: string
  properties: {
    info?: { id: string; [key: string]: unknown }
    sessionID?: string
    error?: unknown
    [key: string]: unknown
  }
}

/**
 * Event hook input structure
 * Wrapper around SessionEvent passed to event handler
 */
interface EventHookInput {
  event: SessionEvent
}

/**
 * Compaction hook input structure
 * Contains sessionID and additional context data
 */
interface CompactionHookInput {
  sessionID?: string
  [key: string]: unknown
}

/**
 * Compaction hook output structure
 * Contains context array where blocker state is preserved
 */
interface CompactionHookOutput {
  context: string[]
  [key: string]: unknown
}

/**
 * Logging client interface for type-safe logging
 * Compatible with OpenCode SDK client structure
 */
interface LoggingClient {
  app: {
    log: (params: unknown) => Promise<void>
  }
  [key: string]: unknown
}

/**
 * Prompt client interface for type-safe prompt injection
 * Compatible with OpenCode SDK client.session.promptAsync structure
 */
interface PromptClient {
  session: {
    promptAsync: (params: unknown) => Promise<unknown>
  }
  [key: string]: unknown
}

/**
 * Create session lifecycle event hooks
 * 
 * Registers handlers for:
 * - session.created: Initialize session state
 * - session.deleted: Cleanup and log summary
 * - session.idle: Track idle state (future: inject continue prompts)
 * - session.compacted: Log compaction event
 * - session.error: Log errors without cleanup
 * 
 * Also includes experimental.session.compacting hook to preserve
 * blocker state during session history compression.
 * 
 * @param ctx - Plugin context from OpenCode SDK
 * @returns Hook registration object
 */
export function createSessionHooks(ctx: Parameters<Plugin>[0]) {
  const { client } = ctx
  // Cast client to LoggingClient for type-safe logging operations
  const loggingClient = client as unknown as LoggingClient

  return {
    /**
     * Main event handler for session lifecycle events
     * 
     * Dispatches to specific handlers based on event.type.
     * All errors are caught and logged to prevent breaking OpenCode sessions.
     */
    event: async ({ event }: EventHookInput): Promise<void> => {
      try {
        // Validate event object
        if (!event || typeof event !== 'object') {
          await logWarn(loggingClient, 'Invalid event object received', { event })
          return
        }

        const { type, properties } = event

        // Extract session ID from properties (varies by event type)
        // session.created/deleted: properties.info.id
        // session.idle/compacted/error: properties.sessionID
        const sessionId = properties?.info?.id ?? properties?.sessionID

        // Validate session ID for session events (protocol-based guard)
        if (!sessionId && typeof type === 'string' && type.startsWith('session.')) {
          await logWarn(loggingClient, 'Session event missing sessionID', { 
            type 
          })
          return
        }

        // Dispatch based on event type
        switch (type) {
          case 'session.created':
            await handleSessionCreated(loggingClient, sessionId as string)
            break

          case 'session.deleted':
            await handleSessionDeleted(loggingClient, sessionId as string)
            break

          case 'session.idle':
            await handleSessionIdle(loggingClient, sessionId as string, ctx)
            break

          case 'session.compacted':
            await handleSessionCompacted(loggingClient, sessionId as string)
            break

          case 'session.error':
            await handleSessionError(loggingClient, sessionId as string, properties?.error)
            break

          default:
            // Silently ignore unknown event types
            await logDebug(loggingClient, `Unknown session event type: ${type}`, { event })
            break
        }
      } catch (error) {
        // Catch all errors to prevent breaking OpenCode
        await logError(
          loggingClient,
          'Error in session event handler',
          error as Error,
          { event }
        )
      }
    },

    /**
     * Compaction hook to preserve blocker state
     * 
     * When OpenCode compresses session history, inject blocker summary
     * into the preserved context so the agent remembers logged blockers.
     */
    'experimental.session.compacting': async (
      input: CompactionHookInput,
      output: CompactionHookOutput
    ): Promise<void> => {
      try {
        const sessionId = input?.sessionID

        if (!sessionId) {
          await logWarn(loggingClient, 'Missing sessionID in compacting hook', { input })
          return
        }

        // Get current state
        const state = getState(sessionId)

        // Build blocker summary
        const blockerCount = state.blockers.length
        const recentBlockers = state.blockers.slice(-5) // Last 5 blockers

        const blockerSummary = `<active-blockers>
Recent blockers logged: ${blockerCount}
Latest: ${JSON.stringify(recentBlockers, null, 2)}
</active-blockers>`

        // Inject into preserved context
        if (output && Array.isArray(output.context)) {
          output.context.push(blockerSummary)
        }

        await logDebug(loggingClient, 'Preserved blocker state during compaction', {
          sessionId,
          blockerCount,
          recentCount: recentBlockers.length
        })
      } catch (error) {
        await logError(
          loggingClient,
          'Error in session compacting hook',
          error as Error,
          { input }
        )
      }
    },

    /**
     * Chat message hook to capture assistant messages
     * 
     * Captures the last assistant message content for completion marker detection.
     * Extracts text from message parts and stores in session state.
     * 
     * This enables the session.idle handler to check if the agent signaled
     * completion by saying the completion marker at the end of its response.
     */
    'chat.message': async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
        variant?: string
      },
      output: {
        message: { role: string; [key: string]: unknown }
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      try {
        const { sessionID } = input
        const { message, parts } = output

        // Only capture assistant messages (ignore user messages)
        if (message.role !== 'assistant') {
          return
        }

        // Extract text content from parts
        const textContent = parts
          .filter(part => part.type === 'text' && typeof part.text === 'string')
          .map(part => part.text)
          .join('\n')

        // Update state with last message content
        if (textContent) {
          updateState(sessionID, s => {
            s.lastMessageContent = textContent
          })

          await logDebug(loggingClient, 'Captured assistant message', {
            sessionID,
            messageLength: textContent.length,
            partCount: parts.length
          })
        }
      } catch (error) {
        // Don't break on message capture errors
        await logError(
          loggingClient,
          'Error capturing chat message',
          error as Error,
          { input }
        )
      }
    }
  }
}

/**
 * Handle session.created event
 * 
 * Initializes session state with default values.
 * State is lazy-initialized by getState(), so this mainly serves
 * to log the event.
 */
async function handleSessionCreated(
  client: LoggingClient,
  sessionId: string
): Promise<void> {
  // Initialize state (lazy initialization via getState)
  getState(sessionId)

  await logInfo(client, 'Session created', { sessionId })
}

/**
 * Handle session.deleted event
 * 
 * Logs session summary including blocker count, then cleans up
 * state from memory to prevent leaks.
 */
async function handleSessionDeleted(
  client: LoggingClient,
  sessionId: string
): Promise<void> {
  // Get state snapshot before cleanup
  const state = getState(sessionId)
  const blockerCount = state.blockers.length

  await logInfo(client, 'Session ended', {
    sessionId,
    blockersLogged: blockerCount,
    repromptCount: state.repromptCount
  })

  // Cleanup state from memory
  cleanupState(sessionId)
}

/**
 * Check if agent signaled completion via completion marker
 * 
 * Simple string contains check - if the completion marker appears ANYWHERE
 * in the agent's last message, the agent has signaled completion.
 * 
 * Examples that should ALL stop reprompting:
 * - "All done. BLOCKER_DIVERTER_DONE!"
 * - "BLOCKER_DIVERTER_DONE! I fixed everything."
 * - "I finished the work. BLOCKER_DIVERTER_DONE! Everything is ready."
 * 
 * @param state - Current session state with lastMessageContent
 * @param config - Plugin configuration with completionMarker setting
 * @param client - Logging client for debug output
 * @returns true if completion marker found anywhere in message, false otherwise
 */
async function checkCompletionMarker(
  state: SessionState,
  config: PluginConfig,
  client: LoggingClient
): Promise<boolean> {
  const lastMessage = state.lastMessageContent || ''
  
  // No message content captured yet
  if (!lastMessage) {
    return false
  }
  
  // Simple string contains check
  const marker = config.completionMarker
  const markerFound = lastMessage.includes(marker)
  
  if (markerFound) {
    await logDebug(client, 'Completion marker detected', {
      marker,
      messageLength: lastMessage.length,
      markerPosition: lastMessage.indexOf(marker)
    })
  }
  
  return markerFound
}

/**
 * Handle session.idle event
 * 
 * Triggered when agent is waiting for user input.
 * Injects continuation prompts to keep autonomous sessions running
 * when there are logged blockers and work remains.
 * 
 * Checks for completion marker to detect when agent signals it's done.
 */
async function handleSessionIdle(
  client: LoggingClient,
  sessionId: string,
  ctx: Parameters<Plugin>[0]
): Promise<void> {
  const state = getState(sessionId)
  const config = await loadConfig(ctx.project.worktree)

  // Recovery guard - skip one idle cycle after error
  if (state.isRecovering) {
    updateState(sessionId, s => {
      s.isRecovering = false
    })
    await logDebug(client, 'Recovery complete - skipped idle reprompt', { sessionId })
    return
  }

  await logDebug(client, 'Session idle', {
    sessionId,
    divertBlockers: state.divertBlockers,
    blockersLogged: state.blockers.length,
    repromptCount: state.repromptCount
  })

  // Reset reprompt count if outside the reprompt window
  const now = Date.now()
  const timeSinceLastReprompt = now - (state.lastRepromptTime || 0)
  if (timeSinceLastReprompt > config.repromptWindowMs && state.repromptCount > 0) {
    updateState(sessionId, s => {
      s.repromptCount = 0
    })
    await logDebug(client, 'Reset reprompt count (outside window)', { 
      sessionId,
      timeSinceLastReprompt,
      windowMs: config.repromptWindowMs
    })
  }

  // Check for completion marker in last agent response
  // Store last message content in state for completion detection
  const completionDetected = await checkCompletionMarker(state, config, client)
  if (completionDetected) {
    await logInfo(client, 'Completion marker detected - stopping autonomous session', { 
      sessionId,
      marker: config.completionMarker,
      repromptCount: state.repromptCount
    })
    return
  }

  // Check if we should inject continue prompt
  if (shouldContinue(state, config)) {
    // Cast client to PromptClient - OpenCode SDK has complex generic types
    // that don't match our interface, but the runtime behavior is compatible
    await injectContinuePrompt(sessionId, state, config, client, ctx.client as unknown as PromptClient)
  }
}

/**
 * Determines if agent should be prompted to continue
 * 
 * Checks multiple conditions:
 * - Feature enabled (divertBlockers)
 * - Under reprompt limit (safety)
 * - Cooldown elapsed (prevent spam)
 * - No loop detected (prevent infinite loops)
 * 
 * In autonomous mode, the agent is prompted to continue regardless of
 * whether blockers exist. This enables long-running sessions where the
 * agent can work continuously without requiring blocked permissions.
 * 
 * @param state - Current session state
 * @param config - Plugin configuration
 * @returns true if continue prompt should be injected
 */
function shouldContinue(state: SessionState, config: PluginConfig): boolean {
  // Feature disabled
  if (!state.divertBlockers) return false

  // Exceeded max reprompts (safety limit)
  if (state.repromptCount >= config.maxReprompts) return false

  // Cooldown not elapsed (prevent spam)
  const now = Date.now()
  const timeSinceLastReprompt = now - (state.lastRepromptTime || 0)
  if (timeSinceLastReprompt < config.cooldownMs) return false

  // Loop detection (currently disabled - see detectLoop() TODO)
  if (detectLoop(state)) return false

  return true
}

/**
 * Detects if agent is in an infinite loop (repeated responses)
 * 
 * TODO: Implement response hash tracking via message.updated or tool.execute.after hooks.
 * Currently disabled as recentResponseHashes is not populated anywhere in the codebase.
 * Will implement in future iteration once we add proper response tracking.
 * 
 * @param state - Current session state with response hashes
 * @returns false (always - loop detection disabled for MVP)
 */
function detectLoop(state: SessionState): boolean {
  // Loop detection temporarily disabled
  // Need to implement response hash tracking first
  return false
  
  // Original implementation (commented out until tracking is implemented):
  // const { recentResponseHashes } = state
  // if (recentResponseHashes.length < 3) return false
  // const last3 = recentResponseHashes.slice(-3)
  // return last3.every(hash => hash === last3[0])
}

/**
 * Injects continuation prompt to keep agent working
 * 
 * Uses the stop prompt template which instructs the agent to:
 * - Check progress on current tasks
 * - Continue with non-blocking work if available
 * - Say completion marker when all work is done
 * 
 * Uses promptAsync (non-blocking) with timeout wrapper to prevent hangs.
 * Updates state to track reprompt count and timestamp.
 * 
 * @param sessionId - Current session ID
 * @param state - Current session state
 * @param config - Plugin configuration
 * @param loggingClient - Client for logging
 * @param client - OpenCode client for prompt injection
 */
async function injectContinuePrompt(
  sessionId: string,
  state: SessionState,
  config: PluginConfig,
  loggingClient: LoggingClient,
  client: PromptClient
): Promise<void> {
  try {
    const continuePrompt = getStopPrompt(sessionId, config)

    // Use promptAsync with timeout to prevent indefinite hangs
    await withTimeout(
      client.session.promptAsync(continuePrompt),
      config.promptTimeoutMs,
      'Continue prompt injection'
    )

    // Update state
    updateState(sessionId, s => {
      s.repromptCount++
      s.lastRepromptTime = Date.now()
    })

    // Get updated state after mutation for accurate logging
    const updatedState = getState(sessionId)

    await logInfo(loggingClient, 'Injected continuation prompt', {
      sessionId,
      repromptCount: updatedState.repromptCount,
      blockerCount: updatedState.blockers.length
    })
  } catch (error) {
    // Log specific timeout errors separately
    if (error instanceof TimeoutError) {
      await logError(
        loggingClient,
        'Continuation prompt timed out',
        error,
        { sessionId, timeoutMs: config.promptTimeoutMs }
      )
    } else {
      await logError(
        loggingClient,
        'Failed to inject continuation prompt',
        error as Error,
        { sessionId }
      )
    }
  }
}

/**
 * Handle session.compacted event
 * 
 * Triggered when OpenCode compresses session history.
 * State is preserved in memory (handled by compacting hook).
 * This just logs the event for observability.
 */
async function handleSessionCompacted(
  client: LoggingClient,
  sessionId: string
): Promise<void> {
  await logDebug(client, 'Session compacted', { sessionId })
}

/**
 * Handle session.error event
 * 
 * Logs error details with state snapshot for debugging.
 * Does NOT cleanup state - session may continue after error recovery.
 */
async function handleSessionError(
  client: LoggingClient,
  sessionId: string,
  error: unknown
): Promise<void> {
  const state = getState(sessionId)

  // Handle user abort - reset reprompt state
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'MessageAbortedError') {
    updateState(sessionId, s => {
      s.repromptCount = 0
      s.lastRepromptTime = 0
    })
    await logInfo(client, 'User aborted session - reset reprompt state', { sessionId })
  }

  // Always set recovery flag to skip next idle reprompt
  updateState(sessionId, s => {
    s.isRecovering = true
  })

  await logError(
    client,
    'Session error occurred',
    error instanceof Error ? error : new Error(String(error)),
    {
      sessionId,
      blockersLogged: state.blockers.length,
      repromptCount: state.repromptCount
    }
  )
}
