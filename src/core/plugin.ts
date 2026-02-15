/**
 * Core Plugin Factory
 *
 * Creates and initializes the Blocker Diverter plugin instance.
 * Registers all hooks and wires up the plugin lifecycle.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig, type LogClient } from "../config";
import { handleToolExecuteBefore } from "../hooks/tool-intercept";
import { createSessionHooks } from "../hooks/session";
import { createSystemPromptHook } from "../hooks/system-prompt";
import { 
  handleOnCommand,
  handleOffCommand,
  handleStopCommand,
  handleStatusCommand,
  type CommandResult 
} from "../commands/blockers-cmd";
import { createBlockerTool } from "../tools/blocker";
import { getState } from "../state";
import { logInfo, logError } from "../utils/logging";

/**
 * Command output structure
 * Contains parts array for injecting additional context
 */
interface CommandOutput {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Plugin factory function
 * Called once when OpenCode loads the plugin
 * 
 * Workflow:
 * 1. Load and validate configuration from opencode.json
 * 2. Log initialization message
 * 3. If disabled, return empty hooks object
 * 4. Wire up hooks with proper context and config
 * 5. Return hooks object for OpenCode to register
 * 
 * @param ctx - Plugin context from OpenCode SDK
 * @returns Hooks object with registered event handlers
 */
export const createPlugin: Plugin = async (ctx) => {
  const { client, worktree } = ctx;

  // Cast client to LogClient for logging functions (SDK types don't match internal interface)
  const logClient = client as unknown as LogClient;

  // Load and validate configuration (graceful degradation on errors)
  const config = await loadConfig(worktree, logClient);

  // Log plugin initialization
  await logInfo(logClient, "Blocker Diverter plugin initialized", {
    enabled: config.enabled,
    worktree,
    blockersFile: config.blockersFile,
    maxBlockersPerRun: config.maxBlockersPerRun,
  });

  // Plugin is not enabled, return empty hooks
  if (!config.enabled) {
    await logInfo(logClient, "Plugin disabled via config, skipping hook registration");
    return {};
  }

  // Create hooks with context and config
  const sessionHooks = createSessionHooks(ctx);
  const systemPromptHooks = createSystemPromptHook(ctx, config);

  // Return hook registrations
  return {
    // Blocker tool - AI agents call this to log blocking questions
    tool: {
      blocker: createBlockerTool(logClient, config, worktree),
    },

    // Tool interception - block question tool during autonomous mode
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: any }
    ) => {
      await handleToolExecuteBefore(input, output, logClient, config, worktree);
    },

    // Session lifecycle hooks - session.created, session.deleted, session.idle, etc.
    ...sessionHooks,

    // System prompt transformation - inject blocker diversion instructions
    ...systemPromptHooks,

    // Command hook - handle dot-delimited /blockers.* commands
    "command.execute.before": async (
      input: { command: string; sessionID: string; arguments: string },
      output: CommandOutput
    ) => {
      // Validate required inputs
      if (!input.sessionID || typeof input.command !== 'string') {
        await logError(
          logClient,
          'Invalid command input: missing sessionID or command'
        );
        return;
      }
      
      // Get session state
      const state = getState(input.sessionID);
      
      // Normalize command name (with or without leading /)
      const cmd = input.command.startsWith('/') ? input.command : `/${input.command}`;
      
      // Handle dot-delimited blocker commands
      let result: CommandResult | undefined;
      
      if (cmd === "/blockers.on") {
        result = await handleOnCommand(state, logClient);
      }
      else if (cmd === "/blockers.off") {
        result = await handleOffCommand(state, logClient);
      }
      else if (cmd === "/blockers.stop") {
        result = await handleStopCommand(state, logClient);
      }
      else if (cmd === "/blockers.status") {
        result = await handleStatusCommand(state, logClient, config);
      }
      // Don't intercept /blockers.list - let AI template handle it
      
      // If command was handled, show toast and replace output
      if (result?.handled) {
        // Show toast notification (wrapped in try/catch for safety)
        if (result.toast) {
          try {
            await (client as any).tui.showToast({ body: result.toast });
          } catch (error) {
            // Log error but don't fail - TUI may not be available
            await logError(logClient, 'Failed to show toast notification', error as Error);
          }
        }
        
        // Replace output.parts with minimal response
        if (result.minimalResponse) {
          output.parts = [{ type: 'text', text: result.minimalResponse }];
        }
      }
    },
  };
};
