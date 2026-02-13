/**
 * Core Plugin Factory
 *
 * Creates and initializes the Blocker Diverter plugin instance.
 * Registers all hooks and wires up the plugin lifecycle.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { Permission } from "@opencode-ai/sdk";
import { loadConfig, type LogClient } from "../config";
import { handlePermissionAsked, type PermissionOutput } from "../hooks/permission";
import { createSessionHooks } from "../hooks/session";
import { createSystemPromptHook } from "../hooks/system-prompt";
import { logInfo } from "../utils/logging";

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

  // Cast client to LogClient for logging functions
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

  // Wire up permission hook (needs config and worktree)
  const permissionHook = async (input: Permission, output: PermissionOutput) => {
    await handlePermissionAsked(input, output, logClient, config, worktree);
  };

  // Return hook registrations
  return {
    // Permission hook - intercept permission.asked events
    "permission.asked": permissionHook,

    // Session lifecycle hooks - session.created, session.deleted, session.idle, etc.
    ...sessionHooks,

    // System prompt transformation - inject blocker diversion instructions
    ...systemPromptHooks,
  };
};
