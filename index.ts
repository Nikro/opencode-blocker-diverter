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

export default createPlugin;
