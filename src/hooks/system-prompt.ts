/**
 * System Prompt Hook
 * 
 * Injects autonomous mode instructions into the LLM system prompt
 * to guide blocker handling behavior during agent execution.
 * 
 * Fires before each LLM call to provide context-aware guidance.
 * 
 * @module hooks/system-prompt
 */

import type { Plugin, PluginConfig } from "../types"
import type { LogClient } from "../config"
import { getState } from "../state"
import { logDebug, logError } from "../utils/logging"
import { getSystemPromptTemplate } from "../utils/templates"

/**
 * Input structure for system prompt transform hook
 */
interface SystemPromptInput {
  sessionID?: string
  model: {
    id: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Output structure for system prompt transform hook
 */
interface SystemPromptOutput {
  system: string[]
  [key: string]: unknown
}

/**
 * Creates the system prompt transformation hook
 * 
 * This hook fires before each LLM call and conditionally injects
 * blocker diversion instructions based on session state.
 * 
 * @param ctx - Plugin context from OpenCode SDK
 * @param config - Plugin configuration (loaded once at plugin init)
 * @returns Hook object with system prompt transform function
 * 
 * @example
 * ```typescript
 * const config = await loadConfig(context.project.worktree)
 * const hooks = createSystemPromptHook(context, config)
 * // Returns: { "experimental.chat.system.transform": async (input, output) => {...} }
 * ```
 */
export function createSystemPromptHook(
  ctx: Parameters<Plugin>[0],
  config: PluginConfig
) {
  const { client } = ctx
  
  return {
    "experimental.chat.system.transform": async (
      input: SystemPromptInput,
      output: SystemPromptOutput
    ): Promise<void> => {
      try {
        // Cast client to LogClient for logging functions
        const logClient = client as unknown as LogClient
        
        // Validate session ID
        if (!input.sessionID) {
          await logDebug(logClient, "No session ID provided, skipping system prompt injection")
          return
        }
        
        // Check feature toggle
        const state = getState(input.sessionID)
        if (!state.divertBlockers) {
          await logDebug(logClient, "Blocker diversion disabled, skipping system prompt injection")
          return
        }
        
        // Generate template (config passed as parameter, no I/O)
        const template = getSystemPromptTemplate(state, config)
        
        // Inject to system prompt array
        output.system.push(template)
        
        // Log injection for observability (changed to debug level)
        await logDebug(logClient, "Injected blocker diverter system prompt", {
          sessionId: input.sessionID,
          modelId: input.model.id,
          templateLength: template.length
        })
        
      } catch (error) {
        // Graceful degradation: log error but don't throw
        // We don't want to break LLM calls if template generation fails
        const logClient = client as unknown as LogClient
        await logError(
          logClient,
          "Failed to inject system prompt",
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
  }
}
