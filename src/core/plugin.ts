/**
 * Core Plugin Factory
 *
 * Creates and initializes the Blocker Diverter plugin instance.
 * Registers all hooks and wires up the plugin lifecycle.
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { loadConfig, type LogClient, isLogClient } from "../config";
import { handleToolExecuteBefore } from "../hooks/tool-intercept";
import { createSessionHooks } from "../hooks/session";
import { createSystemPromptHook } from "../hooks/system-prompt";
import { 
  handleOnCommand,
  handleOffCommand, 
  handleStatusCommand,
  type CommandResult 
} from "../commands/blockers-cmd";
import { getState } from "../state";
import { logInfo, logError } from "../utils/logging";
import { BlockerToolArgsSchema, type Blocker } from "../types";
import { generateBlockerHash, isInCooldown, addToCooldown } from "../utils/dedupe";
import { appendBlocker } from "../utils/blockers-file";
import { BLOCKER_RESPONSE_MESSAGE } from "../utils/templates";

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
    // Register blocker tool for AI agents to actively call
    tool: {
      blocker: tool({
        description: "Log a blocker question to blockers.md and continue with independent tasks. Use for hard blockers (architecture, security, destructive, deployment decisions) or soft blockers with research options. Returns success message.",
        args: {
          question: tool.schema.string().min(1, "Question cannot be empty").describe("The exact blocking question you need answered"),
          category: tool.schema.enum(["architecture", "security", "destructive", "permission", "question", "other"]).describe("Category of the blocker"),
          context: tool.schema.string().optional().default("").describe("Additional context: what you were doing, file paths, command args, etc."),
          blocksProgress: tool.schema.boolean().optional().default(true).describe("True if this completely halts progress (hard blocker), false if you can make a default choice (soft blocker)"),
          options: tool.schema.array(tool.schema.string()).optional().describe("For soft blockers: 3 potential choices you researched"),
          chosenOption: tool.schema.string().optional().describe("For soft blockers: the option you chose (must be from options array)"),
          chosenReasoning: tool.schema.string().optional().describe("For soft blockers: why you chose this option")
        },
        async execute(args, context) {
          // Validate args with our stricter Zod schema (includes refinements)
          const parseResult = BlockerToolArgsSchema.safeParse(args);
          if (!parseResult.success) {
            throw new Error(`Invalid blocker tool arguments: ${parseResult.error.message}`);
          }

          const validatedArgs = parseResult.data;
          
          // Get session ID from context (OpenCode provides this)
          const sessionId = context.sessionID;
          
          // Check if plugin is enabled for this session
          const state = getState(sessionId);
          if (!state.divertBlockers) {
            return "Blocker diversion is disabled for this session. Use /blockers.on to enable.";
          }

          // Check deduplication cooldown
          const hash = await generateBlockerHash(validatedArgs.question, validatedArgs.context);

          if (isInCooldown(hash, state)) {
            await logInfo(
              client as unknown as LogClient,
              `Duplicate blocker skipped (cooldown): ${validatedArgs.question}`,
              { sessionId, category: validatedArgs.category }
            );
            return BLOCKER_RESPONSE_MESSAGE;
          }

          // Check max blockers limit
          if (state.blockers.length >= config.maxBlockersPerRun) {
            await logInfo(
              client as unknown as LogClient,
              `Max blockers reached (${state.blockers.length}/${config.maxBlockersPerRun})`,
              { sessionId, currentCount: state.blockers.length, maxBlockers: config.maxBlockersPerRun }
            );
            return BLOCKER_RESPONSE_MESSAGE;
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
            chosenReasoning: validatedArgs.chosenReasoning
          };

          // Try to write to file
          const success = await appendBlocker(config.blockersFile, blocker, worktree);

          if (success) {
            // Add to session state
            state.blockers.push(blocker);
            addToCooldown(hash, state, config);

            await logInfo(
              client as unknown as LogClient,
              `Blocker tool called: ${validatedArgs.question}`,
              { blockerId: blocker.id, category: validatedArgs.category, sessionId }
            );
          } else {
            // Failed to write - queue for retry (FR-024)
            state.pendingWrites.push(blocker);
            
            await logError(
              client as unknown as LogClient,
              'Failed to log blocker to file, queued for retry',
              new Error('appendBlocker returned false'),
              { blockerId: blocker.id, sessionId, queueLength: state.pendingWrites.length }
            );
          }

          return BLOCKER_RESPONSE_MESSAGE;
        }
      })
    },

    // Tool interception hook - block tools requiring user interaction (question tool)
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: any }
    ) => {
      await handleToolExecuteBefore(input, output, client as unknown as LogClient, config, worktree);
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
      // DEBUG: Log that hook was called
      await logInfo(logClient, "command.execute.before hook fired!", {
        command: input.command,
        arguments: input.arguments,
        sessionID: input.sessionID
      });
      
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
