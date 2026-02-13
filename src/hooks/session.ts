/**
 * Session lifecycle hooks for Blocker Diverter plugin
 * 
 * Handles session creation, deletion, idle, compaction, and error events.
 * Manages session state initialization and cleanup, and preserves blocker
 * context during session compaction.
 * 
 * @module hooks/session
 */

import type { Plugin } from '../types'
import { getState, cleanupState } from '../state'
import { logInfo, logWarn, logError, logDebug } from '../utils/logging'

/**
 * Session event structure from OpenCode SDK
 * Contains event type, optional session_id, and additional properties
 */
interface SessionEvent {
  type: string
  session_id?: string
  error?: unknown
  [key: string]: unknown
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
 * Contains session_id and additional context data
 */
interface CompactionHookInput {
  session_id?: string
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

        const { type, session_id: sessionId } = event

        // Validate session_id for session events (protocol-based guard)
        if (!sessionId && typeof type === 'string' && type.startsWith('session.')) {
          await logWarn(loggingClient, 'Session event missing session_id', { 
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
            await handleSessionIdle(loggingClient, sessionId as string)
            break

          case 'session.compacted':
            await handleSessionCompacted(loggingClient, sessionId as string)
            break

          case 'session.error':
            await handleSessionError(loggingClient, sessionId as string, event.error)
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
        const sessionId = input?.session_id

        if (!sessionId) {
          await logWarn(loggingClient, 'Missing session_id in compacting hook', { input })
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
 * Handle session.idle event
 * 
 * Triggered when agent is waiting for user input.
 * Currently logs the event. Future iterations may inject
 * "continue" prompts here if autonomous mode is enabled.
 */
async function handleSessionIdle(
  client: LoggingClient,
  sessionId: string
): Promise<void> {
  const state = getState(sessionId)

  await logDebug(client, 'Session idle', {
    sessionId,
    divertBlockers: state.divertBlockers,
    blockersLogged: state.blockers.length
  })

  // Future: Check if we should inject continue prompt
  // if (state.divertBlockers && state.blockers.length > 0) {
  //   await client.session.prompt({
  //     path: { id: sessionId },
  //     body: { parts: [{ type: "text", text: "Continue with next task" }] }
  //   })
  // }
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
