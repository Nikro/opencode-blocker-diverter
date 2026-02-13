/**
 * Core Plugin Factory
 *
 * Creates and initializes the Blocker Diverter plugin instance.
 * Registers all hooks and wires up the plugin lifecycle.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "../config";
import { getState } from "../state";

// Hook handlers will be imported once implemented
// import { handlePermissionAsked } from "../hooks/permission";
// import { handleSessionEvent } from "../hooks/session";
// import { handleStop } from "../hooks/stop";
// import { handleSystemPromptTransform } from "../hooks/system-prompt";
// import { handleCompaction } from "../hooks/compaction";

/**
 * Plugin factory function
 * Called once when OpenCode loads the plugin
 */
export const createPlugin: Plugin = async (ctx) => {
  const { client, project, directory, worktree } = ctx;

  // Load and validate configuration
  const config = await loadConfig(directory);

  // Plugin is not enabled, return minimal hooks
  if (!config.enabled) {
    return {};
  }

  // Return hook registrations
  return {
    // PRIMARY HOOKS (Phase 4 implementation)
    
    // "permission.asked": async (input, output) => {
    //   return handlePermissionAsked(input, output, client, config);
    // },

    // event: async ({ event }) => {
    //   return handleSessionEvent(event, client, config);
    // },

    // stop: async (input) => {
    //   return handleStop(input, client, config);
    // },

    // SECONDARY HOOKS (Phase 4 implementation)
    
    // "experimental.chat.system.transform": async (input, output) => {
    //   return handleSystemPromptTransform(input, output, config);
    // },

    // "experimental.session.compacting": async (input, output) => {
    //   return handleCompaction(input, output, client, config);
    // },

    // COMMANDS (Phase 5 implementation)
    
    // "tui.command.execute": async (input, output) => {
    //   if (input.command === "/blockers") {
    //     return handleBlockersCommand(input.args || [], input.sessionID, client);
    //   }
    // },

    // CONFIG HOOK (register /blockers command)
    
    // config: async (input) => {
    //   input.command ??= {};
    //   input.command.blockers = {
    //     description: "Manage blocker diverter (on|off|status|list)",
    //     template: "$ARGUMENTS",
    //   };
    // },
  };
};
