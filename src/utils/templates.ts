/**
 * Templates Utility
 * 
 * Generates synthetic user messages to inject into OpenCode sessions.
 * Used for autonomous operation by simulating user responses.
 * 
 * @module utils/templates
 */

import type { PluginConfig } from '../types'

/**
 * Fixed response message for blocker acknowledgment (FR-009)
 */
export const BLOCKER_RESPONSE_MESSAGE = "Great, blocker registered, move on with the next non-blocking issues!"

/**
 * Default completion marker for stop prompt (FR-014)
 */
export const DEFAULT_COMPLETION_MARKER = "BLOCKER_DIVERTER_DONE!"

/**
 * Maximum allowed length for sanitized inputs (prevents bloat)
 */
const MAX_INPUT_LENGTH = 200

/**
 * Sanitize user input to prevent prompt injection
 * 
 * Defense-in-depth security measure:
 * - Strips control characters (newlines, tabs, carriage returns)
 * - Trims leading/trailing whitespace
 * - Limits length to prevent message bloat
 * 
 * @param input - Raw input string to sanitize
 * @returns Sanitized string safe for template interpolation
 * 
 * @example
 * ```typescript
 * sanitizeInput("bash\n\nmalicious") // => "bashmalicious"
 * sanitizeInput("  spaced  ") // => "spaced"
 * sanitizeInput("a".repeat(300)) // => "a".repeat(200)
 * ```
 */
export function sanitizeInput(input: string): string {
  // Strip control characters
  let sanitized = input
    .replace(/[\n\r\t]/g, '')
    .trim()
  
  // Limit length to prevent bloat
  if (sanitized.length > MAX_INPUT_LENGTH) {
    sanitized = sanitized.substring(0, MAX_INPUT_LENGTH)
  }
  
  return sanitized
}

/**
 * Message format for session.prompt() SDK call
 * Matches OpenCode's expected prompt structure
 */
export interface PromptMessage {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
  }
}

/**
 * Generate fake user response after blocker logged
 * 
 * Uses fixed message as specified in FR-009 to acknowledge blocker
 * registration and instruct agent to continue with non-blocking work.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @returns Formatted prompt message for session.prompt() injection
 * 
 * @example
 * ```typescript
 * const msg = getBlockerResponse('session-123')
 * await client.session.prompt(msg)
 * ```
 */
export function getBlockerResponse(sessionId: string): PromptMessage {
  return {
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: BLOCKER_RESPONSE_MESSAGE
        }
      ]
    }
  }
}

/**
 * Generate fake user prompt to prevent premature stop
 * 
 * Instructs agent to check progress and signal completion with a
 * configurable marker phrase (FR-014). Used by stop hook to keep
 * autonomous session running until all work is done.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @param config - Plugin configuration containing completionMarker
 * @returns Formatted prompt message for session.prompt() injection
 * 
 * @example
 * ```typescript
 * const msg = getStopPrompt('session-456', config)
 * await client.session.prompt(msg)
 * // Agent will respond with progress check and say marker when done
 * ```
 */
export function getStopPrompt(
  sessionId: string,
  config: PluginConfig
): PromptMessage {
  const marker = sanitizeInput(config.completionMarker || DEFAULT_COMPLETION_MARKER)
  
  return {
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: `Check the progress on current tasks. If there's more non-blocking work to do, continue. When all work is complete, say '${marker}'!`
        }
      ]
    }
  }
}

/**
 * Generate fake user response for permission questions
 * 
 * Instructs agent to log the permission request as a blocker and
 * continue with other available tasks. Used by permission.asked hook
 * to maintain autonomous operation when encountering permissions that
 * require user approval.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @param permission - Permission type being requested (bash, edit, etc.)
 * @returns Formatted prompt message for session.prompt() injection
 * 
 * @example
 * ```typescript
 * const msg = getPermissionPrompt('session-789', 'bash')
 * await client.session.prompt(msg)
 * // Agent will log blocker and move to next task
 * ```
 */
export function getPermissionPrompt(
  sessionId: string,
  permission: string
): PromptMessage {
  const sanitizedPermission = sanitizeInput(permission)
  
  return {
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: `Log this ${sanitizedPermission} permission request as a blocker and continue with other non-blocking tasks.`
        }
      ]
    }
  }
}
