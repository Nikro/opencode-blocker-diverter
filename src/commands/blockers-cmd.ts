/**
 * /blockers command handler for user interaction with the plugin
 * 
 * Provides subcommands to control and view blocker state:
 * - on: Enable blocker diversion for current session
 * - off: Disable blocker diversion for current session
 * - status: Show current state (enabled/disabled, blocker count, config)
 * - list: List all recorded blockers in current session
 * 
 * @module commands/blockers-cmd
 */

import type { LogClient } from '../config'
import type { SessionState, PluginConfig } from '../types'
import { getState } from '../state'
import { logInfo } from '../utils/logging'

/**
 * Context object passed to command handler
 * 
 * Provides access to OpenCode client, session ID, and plugin configuration
 * required for command execution.
 */
export interface BlockersCommandContext {
  /** OpenCode client for structured logging */
  client: LogClient | undefined
  
  /** OpenCode session ID where command was invoked */
  sessionId: string
  
  /** Plugin configuration (loaded from opencode.json) */
  config: PluginConfig
}

/**
 * Handle /blockers command with subcommands
 * 
 * Routes to appropriate handler based on subcommand. Shows help if no subcommand
 * provided or if invalid subcommand given.
 * 
 * @param subcommand - Command argument (on, off, status, list, or undefined)
 * @param context - Command execution context
 * 
 * @example
 * ```typescript
 * await handleBlockersCommand('status', {
 *   client,
 *   sessionId: 'session-abc',
 *   config: loadedConfig
 * })
 * ```
 */
export async function handleBlockersCommand(
  subcommand: string | undefined,
  context: BlockersCommandContext
): Promise<void> {
  const { client, sessionId, config } = context
  const state = getState(sessionId)

  switch (subcommand) {
    case 'on':
      await handleOn(state, client)
      break
    
    case 'off':
      await handleOff(state, client)
      break
    
    case 'status':
      await handleStatus(state, client, config)
      break
    
    case 'list':
      await handleList(state, client)
      break
    
    case undefined:
      // No subcommand - show help
      await showHelp(client)
      break
    
    default:
      // Invalid subcommand - show error and help
      await logInfo(
        client,
        `Unknown subcommand: ${subcommand}. Use /blockers [on|off|status|list]`
      )
  }
}

/**
 * Handle /blockers on - Enable blocker diversion for session
 * 
 * Modifies session state to enable blocker diversion. When enabled, the plugin
 * will intercept permission dialogs and conversational questions.
 * 
 * @param state - Session state object (mutated in place)
 * @param client - OpenCode client for logging
 */
async function handleOn(
  state: SessionState,
  client: LogClient | undefined
): Promise<void> {
  state.divertBlockers = true
  
  await logInfo(
    client,
    'Blocker diverter enabled for this session'
  )
}

/**
 * Handle /blockers off - Disable blocker diversion for session
 * 
 * Modifies session state to disable blocker diversion. When disabled, the plugin
 * will not intercept blockers and normal OpenCode behavior will continue.
 * 
 * @param state - Session state object (mutated in place)
 * @param client - OpenCode client for logging
 */
async function handleOff(
  state: SessionState,
  client: LogClient | undefined
): Promise<void> {
  state.divertBlockers = false
  
  await logInfo(
    client,
    'Blocker diverter disabled for this session'
  )
}

/**
 * Handle /blockers status - Show current state and statistics
 * 
 * Displays:
 * - Current state (enabled/disabled)
 * - Number of blockers recorded vs max
 * - Additional session statistics
 * 
 * @param state - Session state object
 * @param client - OpenCode client for logging
 * @param config - Plugin configuration
 */
async function handleStatus(
  state: SessionState,
  client: LogClient | undefined,
  config: PluginConfig
): Promise<void> {
  const status = state.divertBlockers ? 'enabled' : 'disabled'
  const blockerCount = state.blockers.length
  const maxBlockers = config.maxBlockersPerRun
  
  const statusMessage = 
    `Blocker Diverter Status:\n` +
    `  State: ${status}\n` +
    `  Blockers recorded: ${blockerCount}/${maxBlockers}\n` +
    `  Reprompt count: ${state.repromptCount}`
  
  await logInfo(client, statusMessage)
}

/**
 * Handle /blockers list - List all recorded blockers
 * 
 * Displays numbered list of blockers with category and truncated question.
 * Shows message if no blockers have been recorded yet.
 * 
 * Question text is truncated to 80 characters for readability in list view.
 * 
 * @param state - Session state object
 * @param client - OpenCode client for logging
 */
async function handleList(
  state: SessionState,
  client: LogClient | undefined
): Promise<void> {
  if (state.blockers.length === 0) {
    await logInfo(client, 'No blockers recorded in this session')
    return
  }
  
  const blockerList = state.blockers
    .map((blocker, index) => {
      const truncatedQuestion = 
        blocker.question.length > 80
          ? blocker.question.substring(0, 80) + '...'
          : blocker.question
      
      return `${index + 1}. [${blocker.category}] ${truncatedQuestion}`
    })
    .join('\n')
  
  const listMessage = `Recorded Blockers (${state.blockers.length}):\n${blockerList}`
  
  await logInfo(client, listMessage)
}

/**
 * Show help message with all available subcommands
 * 
 * Displays usage information for /blockers command with descriptions
 * of each subcommand.
 * 
 * @param client - OpenCode client for logging
 */
async function showHelp(client: LogClient | undefined): Promise<void> {
  const helpMessage = 
    `Blocker Diverter Commands:\n` +
    `  /blockers on      - Enable blocker diversion for this session\n` +
    `  /blockers off     - Disable blocker diversion for this session\n` +
    `  /blockers status  - Show current state and blocker count\n` +
    `  /blockers list    - List all recorded blockers`
  
  await logInfo(client, helpMessage)
}
