/**
 * Command handlers for dot-delimited blocker commands
 * 
 * Provides individual handlers for:
 * - /blockers.on: Enable blocker diversion for current session
 * - /blockers.off: Disable blocker diversion for current session
 * - /blockers.status: Show current state (enabled/disabled, blocker count, config)
 * - /blockers.list: List all recorded blockers in current session
 * 
 * @module commands/blockers-cmd
 */

import type { LogClient } from '../config'
import type { SessionState, PluginConfig } from '../types'
import { getState } from '../state'
import { logInfo } from '../utils/logging'

/**
 * Result returned from command handler
 * 
 * Indicates whether the command was fully handled (requiring only toast notification)
 * or needs AI template processing.
 */
export interface CommandResult {
  /** Whether this command was fully handled (toast shown, no AI processing needed) */
  handled: boolean
  
  /** Minimal text for AI if handled (replaces output.parts) */
  minimalResponse?: string
  
  /** Toast notification to show (if any) */
  toast?: {
    title?: string
    message: string
    variant: 'info' | 'success' | 'warning' | 'error'
    duration?: number
  }
}



/**
 * Handle /blockers.on - Enable blocker diversion for session
 * 
 * Modifies session state to enable blocker diversion. When enabled, the plugin
 * will intercept permission dialogs and conversational questions.
 * 
 * @param state - Session state object (mutated in place)
 * @param client - OpenCode client for logging
 * @returns CommandResult with toast notification
 */
export async function handleOnCommand(
  state: SessionState,
  client: LogClient | undefined
): Promise<CommandResult> {
  const wasDiverted = state.divertBlockers
  state.divertBlockers = true
  
  await logInfo(
    client,
    'Blocker diverter enabled for this session',
    { 
      previousState: wasDiverted,
      newState: true
    }
  )
  
  return {
    handled: true,
    minimalResponse: 'Blocker diverter enabled. No further action needed.',
    toast: {
      title: 'Blocker Diverter',
      message: 'Enabled for this session',
      variant: 'success',
      duration: 3000
    }
  }
}

/**
 * Handle /blockers.off - Disable blocker diversion for session
 * 
 * Modifies session state to disable blocker diversion. When disabled, the plugin
 * will not intercept blockers and normal OpenCode behavior will continue.
 * 
 * @param state - Session state object (mutated in place)
 * @param client - OpenCode client for logging
 * @returns CommandResult with toast notification
 */
export async function handleOffCommand(
  state: SessionState,
  client: LogClient | undefined
): Promise<CommandResult> {
  const wasDiverted = state.divertBlockers
  state.divertBlockers = false
  
  await logInfo(
    client,
    'Blocker diverter disabled for this session',
    {
      previousState: wasDiverted,
      newState: false
    }
  )
  
  return {
    handled: true,
    minimalResponse: 'Blocker diverter disabled. No further action needed.',
    toast: {
      title: 'Blocker Diverter',
      message: 'Disabled for this session',
      variant: 'success',
      duration: 3000
    }
  }
}

/**
 * Handle /blockers.stop - Emergency stop for autonomous loop
 * 
 * Immediately disables blocker diversion AND clears all reprompt state.
 * Use this when the agent is stuck in an infinite loop and cancellation
 * detection (Esc+Esc) is not working.
 * 
 * This is more aggressive than .off - it also:
 * - Clears lastAssistantAborted flag
 * - Resets reprompt count
 * 
 * @param state - Session state object
 * @param client - OpenCode client for logging
 * @returns CommandResult with toast notification
 */
export async function handleStopCommand(
  state: SessionState,
  client: LogClient | undefined
): Promise<CommandResult> {
  state.divertBlockers = false
  state.lastAssistantAborted = false
  state.repromptCount = 0
  state.lastRepromptTime = 0
  
  await logInfo(
    client,
    'Blocker diverter STOPPED (emergency halt)'
  )
  
  return {
    handled: true,
    minimalResponse: 'Blocker diverter STOPPED. All autonomous behavior halted.',
    toast: {
      title: 'Blocker Diverter',
      message: '⛔ STOPPED - Loop halted',
      variant: 'error',
      duration: 5000
    }
  }
}


/**
 * Handle /blockers.status - Show current state and statistics
 * 
 * Displays:
 * - Current state (enabled/disabled)
 * - Number of blockers recorded vs max
 * - Additional session statistics
 * 
 * @param state - Session state object
 * @param client - OpenCode client for logging
 * @param config - Plugin configuration
 * @returns CommandResult with toast notification
 */
export async function handleStatusCommand(
  state: SessionState,
  client: LogClient | undefined,
  config: PluginConfig
): Promise<CommandResult> {
  const status = state.divertBlockers ? 'enabled' : 'disabled'
  const blockerCount = state.blockers.length
  const maxBlockers = config.maxBlockersPerRun
  
  const statusMessage = 
    `Blocker Diverter Status:\n` +
    `  State: ${status}\n` +
    `  Blockers recorded: ${blockerCount}/${maxBlockers}\n` +
    `  Reprompt count: ${state.repromptCount}`
  
  await logInfo(client, statusMessage)
  
  return {
    handled: true,
    minimalResponse: `Blocker diverter is ${status}. ${blockerCount}/${maxBlockers} blockers recorded. No further action needed.`,
    toast: {
      title: 'Blocker Diverter Status',
      message: `${status} • ${blockerCount}/${maxBlockers} blockers`,
      variant: 'info',
      duration: 5000
    }
  }
}

/**
 * Handle /blockers.list - List all recorded blockers
 * 
 * Displays numbered list of blockers with category and truncated question.
 * Shows message if no blockers have been recorded yet.
 * 
 * Question text is truncated to 80 characters for readability in list view.
 * 
 * This command is NOT handled - it returns handled: false to allow the AI
 * template to process and format the list nicely.
 * 
 * @param state - Session state object
 * @param client - OpenCode client for logging
 * @returns CommandResult indicating AI should handle this
 */
export async function handleListCommand(
  state: SessionState,
  client: LogClient | undefined
): Promise<CommandResult> {
  // Keep the logging for server-side records
  if (state.blockers.length === 0) {
    await logInfo(client, 'No blockers recorded in this session')
  } else {
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
  
  // Return not handled - let AI template process this
  return {
    handled: false
  }
}
