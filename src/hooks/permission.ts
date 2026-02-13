/**
 * Permission Hook Handler
 * 
 * Intercepts permission.asked events to enable autonomous operation.
 * Logs hard blockers, denies permission requests, and injects continuation prompts.
 * 
 * @module hooks/permission
 */

import type { Permission } from '@opencode-ai/sdk'
import type { LogClient } from '../config'
import type { PluginConfig, Blocker } from '../types'
import { getState } from '../state'
import { generateBlockerHash, isInCooldown, addToCooldown } from '../utils/dedupe'
import { appendBlocker } from '../utils/blockers-file'
import { logInfo, logError } from '../utils/logging'
import { getPermissionPrompt } from '../utils/templates'

/**
 * Permission hook output interface
 * Modified by hook to control permission behavior
 */
export interface PermissionOutput {
  status: 'allow' | 'deny' | 'ask'
}

/**
 * Client interface for OpenCode SDK operations
 * Used for logging and prompt injection
 */
interface Client extends LogClient {
  session?: {
    prompt?: (message: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
    }) => Promise<void>
  }
}

/**
 * Handles permission.ask hook events
 * 
 * Workflow:
 * 1. Check if plugin is enabled for this session
 * 2. Filter by permission type (only intercept configured types)
 * 3. Check deduplication cooldown
 * 4. Check max blockers limit (per-session)
 * 5. Create and log blocker
 * 6. Deny permission
 * 7. Inject continuation prompt
 * 
 * @param input - OpenCode Permission object from SDK
 * @param output - Hook output to modify (set status)
 * @param client - OpenCode SDK client for logging and prompts
 * @param config - Plugin configuration
 * @param projectDir - Project root directory for file operations
 */
export async function handlePermissionAsked(
  input: Permission,
  output: PermissionOutput,
  client: Client | undefined,
  config: PluginConfig,
  projectDir: string
): Promise<void> {
  try {
    // 1. Check if plugin is enabled for this session
    const state = getState(input.sessionID)
    if (!state.divertBlockers) {
      // Pass through - don't modify output
      return
    }

    // 2. Filter by permission type - only intercept specific permissions
    const INTERCEPTED_PERMISSIONS = ['bash', 'edit', 'write', 'external_directory']
    if (!INTERCEPTED_PERMISSIONS.includes(input.type)) {
      await logInfo(
        client,
        `Permission type not intercepted: ${input.type}`,
        { sessionId: input.sessionID, permission: input.type }
      )
      return
    }

    // 3. Check deduplication cooldown
    const tool = (input.metadata.tool as string) || input.title || 'unknown'
    const question = `Agent requested ${input.type} permission for: ${tool}`
    const context = redactSensitiveData(JSON.stringify(input.metadata))
    const hash = await generateBlockerHash(question, context)

    if (isInCooldown(hash, state)) {
      await logInfo(
        client,
        `Duplicate blocker skipped (cooldown): ${input.type}`,
        { sessionId: input.sessionID, permission: input.type }
      )
      // Still deny and inject, but don't log
      output.status = 'deny'
      await injectContinuationPrompt(input.sessionID, client, input.type)
      return
    }

    // 4. Check max blockers limit (per-session)
    if (state.blockers.length >= config.maxBlockersPerRun) {
      await logInfo(
        client,
        `Max blockers reached (${state.blockers.length}/${config.maxBlockersPerRun})`,
        { sessionId: input.sessionID, currentCount: state.blockers.length, maxBlockers: config.maxBlockersPerRun }
      )
      // Still deny and inject, but don't log
      output.status = 'deny'
      await injectContinuationPrompt(input.sessionID, client, input.type)
      return
    }

    // 5. Create and log blocker
    const blocker: Blocker = {
      id: generateBlockerId(input.sessionID, hash),
      timestamp: new Date().toISOString(),
      sessionId: input.sessionID,
      category: 'permission',
      question,
      context,
      blocksProgress: true,
    }

    const success = await appendBlocker(config.blockersFile, blocker, projectDir)

    if (success) {
      // Add to session state
      state.blockers.push(blocker)
      addToCooldown(hash, state, config)

      await logInfo(
        client,
        `Blocker logged: ${blocker.question}`,
        { blockerId: blocker.id, permission: input.type, sessionId: input.sessionID }
      )
    } else {
      await logError(
        client,
        'Failed to log blocker to file',
        new Error('appendBlocker returned false'),
        { blockerId: blocker.id, sessionId: input.sessionID }
      )
    }

    // 6. Deny permission
    output.status = 'deny'

    // 7. Inject continuation prompt
    await injectContinuationPrompt(input.sessionID, client, input.type)

  } catch (error) {
    // Log error but don't modify output - let dialog show to user on critical failure
    await logError(
      client,
      'Permission hook error',
      error as Error,
      { sessionId: input.sessionID, permission: input.type }
    )
    
    // Still try to deny and inject if possible (graceful degradation)
    try {
      output.status = 'deny'
      await injectContinuationPrompt(input.sessionID, client, input.type)
    } catch (recoveryError) {
      // Final fallback - just log the recovery error
      await logError(
        client,
        'Failed to recover from permission hook error',
        recoveryError as Error,
        { sessionId: input.sessionID }
      )
    }
  }
}

/**
 * Redact sensitive data from metadata before logging
 * 
 * Replaces common secret patterns with [REDACTED] to prevent
 * accidental exposure of credentials in blocker logs.
 * 
 * Patterns redacted (case-insensitive, all occurrences):
 * - API keys, tokens, passwords, auth headers, secrets
 * - Both JSON ("key": "value") and CLI (key=value) formats
 * 
 * @param jsonString - String to redact (JSON or plain text)
 * @returns Redacted string with [REDACTED] replacing sensitive values
 */
function redactSensitiveData(jsonString: string): string {
  const keywords = [
    'api[\\w.\\-:]*key', 'token', 'access[\\w.\\-:]*token', 'auth[\\w.\\-:]*token',
    'bearer', 'authorization', 'auth', 'password', 'passwd', 'pwd',
    'private[\\w.\\-:]*key', 'secret', 'client[\\w.\\-:]*secret',
  ]

  let redacted = jsonString

  // JSON-style: "any_password": "value" (supports hyphens, dots, colons in keys)
  keywords.forEach(kw => {
    redacted = redacted.replace(
      new RegExp(`("([^"]*${kw}[^"]*)"\\s*:\\s*)"[^"]*"`, 'gi'),
      (match, keyWithColon, keyOnly) => `${keyWithColon}"[REDACTED]"`
    )
  })

  // CLI-style: any_password=value (supports hyphens, dots, colons in keys)
  keywords.forEach(kw => {
    redacted = redacted.replace(
      new RegExp(`([^\\s=]*${kw}[^\\s=]*=["']?[^\\s"',]+["']?)`, 'gi'),
      m => `${m.split('=')[0]}=[REDACTED]`
    )
  })

  // Header-style: "Authorization: Bearer value"
  redacted = redacted.replace(
    /(Authorization|Auth):\s*(?:Bearer\s+)?[^\s"',}]+/gi,
    m => `${m.split(':')[0]}: [REDACTED]`
  )

  // Inline: "token: value" in strings
  keywords.forEach(kw => {
    redacted = redacted.replace(
      new RegExp(`(${kw}):\\s*[^\\s"',}]+`, 'gi'),
      m => `${m.split(':')[0]}: [REDACTED]`
    )
  })
  
  return redacted
}

/**
 * Generate unique blocker ID
 * 
 * Format: timestamp-sessionId-hash (truncated)
 * Example: "1707829200000-session-abc-a3f5e9"
 * 
 * @param sessionId - OpenCode session ID
 * @param hash - Blocker hash from generateBlockerHash
 * @returns Unique blocker ID string
 */
function generateBlockerId(sessionId: string, hash: string): string {
  const timestamp = Date.now()
  const shortHash = hash.substring(0, 6)
  return `${timestamp}-${sessionId}-${shortHash}`
}

/**
 * Inject continuation prompt to maintain autonomous operation
 * 
 * Uses getPermissionPrompt template to generate appropriate message.
 * Handles errors gracefully to prevent blocking plugin operation.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @param client - OpenCode client with session.prompt capability
 * @param permission - Permission type that was denied
 */
async function injectContinuationPrompt(
  sessionId: string,
  client: Client | undefined,
  permission: string
): Promise<void> {
  try {
    if (!client?.session?.prompt) {
      // Client not available or doesn't support prompts - graceful degradation
      return
    }

    const promptMessage = getPermissionPrompt(sessionId, permission)
    await client.session.prompt(promptMessage)

    await logInfo(
      client,
      `Continuation prompt injected for session ${sessionId}`,
      { sessionId, permission }
    )
  } catch (error) {
    await logError(
      client,
      'Failed to inject continuation prompt',
      error as Error,
      { sessionId, permission }
    )
  }
}
