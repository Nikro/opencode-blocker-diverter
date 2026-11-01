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
import { setupV2 } from "./src/v2/plugin";
import type { PluginModule } from "@opencode-ai/plugin";

/**
 * Dual export (see docs/adr/opencode-v2-port.md).
 * - `server`: OpenCode 1.x PluginModule entry (@opencode-ai/plugin >= 1.3.x), unchanged.
 * - `setup`: OpenCode 2.x definition ({ id, setup }). The v2 loader ignores extra keys.
 */
const plugin: PluginModule & { setup: typeof setupV2 } = {
  id: "opencode-blocker-diverter",
  server: createPlugin,
  setup: setupV2,
};

export default plugin;
