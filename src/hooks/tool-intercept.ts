/**
 * Tool Interception Hook Handler
 * 
 * Intercepts tool.execute.before events to block the 'question' tool
 * during autonomous mode. This is legacy behavior - the blocker tool
 * is now properly registered via plugin.ts and doesn't need interception.
 * 
 * @module hooks/tool-intercept
 */

import type { LogClient } from '../config'
import type { PluginConfig, Blocker, SessionState } from '../types'
import { getState } from '../state'
import { generateBlockerHash, isInCooldown, addToCooldown } from '../utils/dedupe'
import { appendBlocker } from '../utils/blockers-file'
import { logInfo, logError } from '../utils/logging'

/**
 * Tools handled by this hook
 * Only 'question' tool is blocked - blocker tool is registered separately
 */
const HANDLED_TOOLS: Record<string, boolean> = {
  'question': true    // Legacy: block this tool (throws error)
}

/**
 * Handles tool.execute.before hook events
 * 
 * Workflow for 'question' tool (legacy blocking):
 * 1. Check if plugin is enabled
 * 2. Log blocker and throw error to block execution
 * 
 * @param input - Tool execution input from OpenCode
 * @param output - Tool output (unused, kept for signature compatibility)
 * @param client - OpenCode SDK client for logging
 * @param config - Plugin configuration
 * @param projectDir - Project root directory for file operations
 */
export async function handleToolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string; args?: any },
  output: { args: any; result?: string },
  client: LogClient | undefined,
  config: PluginConfig,
  projectDir: string
): Promise<void> {
  try {
    // 1. Check if this tool is handled
    if (!HANDLED_TOOLS[input.tool]) {
      void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleToolExecuteBefore: tool=${input.tool} handled=false -> ALLOWING pass-through` } }).catch(() => {})
      return
    }

    void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleToolExecuteBefore: tool=${input.tool} handled=true -> checking state` } }).catch(() => {})

    // 2. Check if plugin is enabled for this session
    const state = getState(input.sessionID)
    if (!state.divertBlockers) {
      void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleToolExecuteBefore: state.divertBlockers=false -> ALLOWING (pass-through)` } }).catch(() => {})
      return
    }

    void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleToolExecuteBefore: state.divertBlockers=true -> BLOCKING tool=${input.tool}` } }).catch(() => {})

    // Handle question tool (legacy blocking behavior)
    if (input.tool === 'question') {
      await handleQuestionTool(input, client, config, projectDir, state)
      return
    }

  } catch (error) {
    // If error is a blocking error, re-throw it
    if (error instanceof Error && error.message.includes('Autonomous mode is active')) {
      void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleToolExecuteBefore: re-throwing blocking error for tool=${input.tool}` } }).catch(() => {})
      throw error
    }

    // Log unexpected errors
    await logError(
      client,
      'Tool intercept hook error',
      error as Error,
      { sessionId: input.sessionID, tool: input.tool }
    )
    
    // If this is a handled tool but we hit an error, still try to block question tool
    if (input.tool === 'question') {
      void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: '[BD] handleToolExecuteBefore: error path - still throwing block for question tool' } }).catch(() => {})
      throw new Error('Blocker Diverter: Autonomous mode is active. Do not ask the user questions — make a reasonable default choice based on project conventions, log your decision in the response, and continue working on the next task.')
    }
    
    // Otherwise let the tool execute
  }
}

/**
 * Handle the question tool - blocks it (legacy behavior)
 * 
 * Throws error to prevent execution.
 */
async function handleQuestionTool(
  input: { tool: string; sessionID: string; callID: string },
  client: LogClient | undefined,
  config: PluginConfig,
  projectDir: string,
  state: SessionState
): Promise<void> {
  void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleQuestionTool: entered, sessionID=${input.sessionID}` } }).catch(() => {})
  const question = `Agent tried to use blocked tool: ${input.tool}`
  const context = JSON.stringify({
    tool: input.tool,
    callID: input.callID,
    sessionID: input.sessionID
  })
  const hash = await generateBlockerHash(question, context)
  const inCooldown = isInCooldown(hash, state)
  void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleQuestionTool: cooldown check hash=${hash.substring(0, 8)} inCooldown=${inCooldown}` } }).catch(() => {})

  if (inCooldown) {
    await logInfo(
      client,
      `Duplicate tool intercept skipped (cooldown): ${input.tool}`,
      { sessionId: input.sessionID, tool: input.tool }
    )
    // Still block the tool but don't log
    void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: '[BD] handleQuestionTool: THROWING to block question tool (cooldown path)' } }).catch(() => {})
    throw new Error('Blocker Diverter: Autonomous mode is active. Do not ask the user questions — make a reasonable default choice based on project conventions, log your decision in the response, and continue working on the next task.')
  }

  // Check max blockers limit
  if (state.blockers.length >= config.maxBlockersPerRun) {
    void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleQuestionTool: max blockers reached (${state.blockers.length}/${config.maxBlockersPerRun}) -> THROWING` } }).catch(() => {})
    await logInfo(
      client,
      `Max blockers reached (${state.blockers.length}/${config.maxBlockersPerRun})`,
      { sessionId: input.sessionID, currentCount: state.blockers.length, maxBlockers: config.maxBlockersPerRun }
    )
    // Still block the tool but don't log
    throw new Error('Blocker Diverter: Autonomous mode is active. Do not ask the user questions — make a reasonable default choice based on project conventions, log your decision in the response, and continue working on the next task.')
  }

  // Create and log blocker
  const blocker: Blocker = {
    id: `${Date.now()}-${input.sessionID}-${hash.substring(0, 6)}`,
    timestamp: new Date().toISOString(),
    sessionId: input.sessionID,
    category: 'question',
    question,
    context,
    blocksProgress: true,
  }

  void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleQuestionTool: about to THROW blocking error for tool=${input.tool}` } }).catch(() => {})
  const success = await appendBlocker(config.blockersFile, blocker, projectDir)

  if (success) {
    // Add to session state
    state.blockers.push(blocker)
    addToCooldown(hash, state, config)

    await logInfo(
      client,
      `Tool intercepted and logged: ${input.tool}`,
      { blockerId: blocker.id, tool: input.tool, sessionId: input.sessionID }
    )
  } else {
    // Failed to write - queue for retry (FR-024)
    state.pendingWrites.push(blocker)
    
    await logError(
      client,
      'Failed to log tool interception to file, queued for retry',
      new Error('appendBlocker returned false'),
      { blockerId: blocker.id, sessionId: input.sessionID, queueLength: state.pendingWrites.length }
    )
  }

  // Block the tool by throwing error
  void client?.app?.log?.({ body: { service: 'blocker-diverter', level: 'info', message: `[BD] handleQuestionTool: THREW blocking error successfully` } }).catch(() => {})
  throw new Error('Blocker Diverter: Autonomous mode is active. Do not ask the user questions — make a reasonable default choice based on project conventions, log your decision in the response, and continue working on the next task.')
}
