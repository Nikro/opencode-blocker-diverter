/**
 * Blocker Tool Definition
 *
 * Registers the `blocker` tool that AI agents call to log blocking questions.
 * Handles validation, deduplication, cooldown, file persistence, and state management.
 *
 * Hard blockers (architecture, security, destructive) are logged and require user input.
 * Soft blockers allow the agent to make a default choice and continue working.
 *
 * @module tools/blocker
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { LogClient } from "../config"
import type { PluginConfig, Blocker } from "../types"
import { BlockerToolArgsSchema } from "../types"
import { getState } from "../state"
import { logInfo, logError } from "../utils/logging"
import { generateBlockerHash, isInCooldown, addToCooldown } from "../utils/dedupe"
import { appendBlocker } from "../utils/blockers-file"
import { BLOCKER_RESPONSE_MESSAGE } from "../utils/templates"

/**
 * Creates the blocker tool definition for plugin registration
 *
 * @param logClient - OpenCode client for structured logging
 * @param config - Validated plugin configuration
 * @param worktree - Git worktree root for file path resolution
 * @returns Tool definition ready for plugin's `tool` property
 */
export function createBlockerTool(
  logClient: LogClient,
  config: PluginConfig,
  worktree: string
): ToolDefinition {
  return tool({
    description:
      "Log a blocker question to blockers.md and continue with independent tasks. Use for hard blockers (architecture, security, destructive, deployment decisions) or soft blockers with research options. Returns success message.",
    args: {
      question: tool.schema
        .string()
        .min(1, "Question cannot be empty")
        .describe("The exact blocking question you need answered"),
      category: tool.schema
        .enum(["architecture", "security", "destructive", "permission", "question", "other"])
        .describe("Category of the blocker"),
      context: tool.schema
        .string()
        .optional()
        .default("")
        .describe(
          "STRUCTURED context (required for quality): Task reference/ID, what you were doing (specific action), where you got stuck (file paths with line numbers, commands), and progress made before hitting blocker. Example: 'Task: #3 \"Add auth\" | Action: JWT validation setup | Files: src/auth.ts:45 | Progress: Middleware skeleton done | Blocker: RS256 vs HS256 choice'"
        ),
      blocksProgress: tool.schema
        .boolean()
        .optional()
        .default(true)
        .describe(
          "True if this completely halts progress (hard blocker), false if you can make a default choice (soft blocker)"
        ),
      options: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("For soft blockers: 3 potential choices you researched"),
      chosenOption: tool.schema
        .string()
        .optional()
        .describe("For soft blockers: the option you chose (must be from options array)"),
      chosenReasoning: tool.schema
        .string()
        .optional()
        .describe("For soft blockers: why you chose this option"),
    },
    async execute(args, context) {
      // Validate args with our stricter Zod schema (includes refinements)
      const parseResult = BlockerToolArgsSchema.safeParse(args)
      if (!parseResult.success) {
        throw new Error(`Invalid blocker tool arguments: ${parseResult.error.message}`)
      }

      const validatedArgs = parseResult.data

      // Get session ID from context (OpenCode provides this)
      const sessionId = context.sessionID

      // Check if plugin is enabled for this session
      const state = getState(sessionId)
      if (!state.divertBlockers) {
        return "Blocker diversion is disabled for this session. Use /blockers.on to enable."
      }

      // Check deduplication cooldown
      const hash = await generateBlockerHash(validatedArgs.question, validatedArgs.context)

      if (isInCooldown(hash, state)) {
        await logInfo(logClient, `Duplicate blocker skipped (cooldown): ${validatedArgs.question}`, {
          sessionId,
          category: validatedArgs.category,
        })
        return BLOCKER_RESPONSE_MESSAGE
      }

      // Check max blockers limit
      if (state.blockers.length >= config.maxBlockersPerRun) {
        await logInfo(
          logClient,
          `Max blockers reached (${state.blockers.length}/${config.maxBlockersPerRun})`,
          { sessionId, currentCount: state.blockers.length, maxBlockers: config.maxBlockersPerRun }
        )
        return BLOCKER_RESPONSE_MESSAGE
      }

      // Create blocker from validated args
      const blocker: Blocker = {
        id: `${Date.now()}-${sessionId}-${hash.substring(0, 6)}`,
        timestamp: new Date().toISOString(),
        sessionId,
        category: validatedArgs.category,
        question: validatedArgs.question,
        context: validatedArgs.context,
        blocksProgress: validatedArgs.blocksProgress,
        options: validatedArgs.options,
        chosenOption: validatedArgs.chosenOption,
        chosenReasoning: validatedArgs.chosenReasoning,
      }

      // Try to write to file
      const success = await appendBlocker(config.blockersFile, blocker, worktree)

      if (success) {
        // Add to session state
        state.blockers.push(blocker)
        addToCooldown(hash, state, config)

        await logInfo(logClient, `Blocker logged: ${validatedArgs.question}`, {
          blockerId: blocker.id,
          category: validatedArgs.category,
          sessionId,
        })
      } else {
        // Failed to write - queue for retry (FR-024)
        state.pendingWrites.push(blocker)

        await logError(logClient, "Failed to log blocker to file, queued for retry", new Error("appendBlocker returned false"), {
          blockerId: blocker.id,
          sessionId,
          queueLength: state.pendingWrites.length,
        })
      }

      return BLOCKER_RESPONSE_MESSAGE
    },
  })
}
