/**
 * Blocker Diverter Plugin - Main Entry Point
 *
 * An OpenCode plugin that enables autonomous overnight coding sessions by:
 * - Intercepting blocker questions before they reach the user
 * - Classifying blockers as hard (need user) or soft (can proceed)
 * - Logging hard blockers to a file for morning review
 * - Providing synthetic responses for soft blockers
 * - Injecting "continue" prompts to maintain session momentum
 */

import { createPlugin } from "./src/core/plugin";
import type { PluginModule } from "@opencode-ai/plugin";

/**
 * Export as PluginModule format required by @opencode-ai/plugin >= 1.3.x
 * Older versions accepted a raw Plugin function as default export.
 * Newer versions require { server: Plugin } (PluginModule) for server-side plugins.
 */
const plugin: PluginModule = {
  id: "opencode-blocker-diverter",
  server: createPlugin,
};

export default plugin;
