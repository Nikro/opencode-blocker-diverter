/**
 * Structured logging utilities for Blocker Diverter plugin
 * 
 * Provides wrapper functions around OpenCode's client.app.log() API
 * with service tagging, error handling, and graceful degradation.
 * 
 * All functions handle cases where client is undefined or unavailable,
 * making logging optional and non-blocking throughout the plugin.
 * 
 * @module utils/logging
 */

import type { LogClient } from '../config'

/**
 * Log info message via OpenCode client
 * 
 * Used for normal operational messages (config loaded, blockers recorded, etc.)
 * 
 * @param client - Optional OpenCode client with logging capability
 * @param message - Human-readable log message
 * @param extra - Additional structured data (sessionId, counts, paths, etc.)
 * 
 * @example
 * ```typescript
 * await logInfo(client, 'Blocker recorded', { 
 *   blockerId: 'abc-123', 
 *   category: 'permission' 
 * })
 * ```
 */
export async function logInfo(
  client: LogClient | undefined,
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!client?.app?.log) {
    return // Graceful degradation when no client available
  }

  try {
    const logOptions: {
      service: string
      level: string
      message: string
      extra?: Record<string, unknown>
    } = {
      service: 'blocker-diverter',
      level: 'info',
      message,
    }

    if (extra !== undefined) {
      logOptions.extra = extra
    }

    await client.app.log(logOptions)
  } catch {
    // Silently fail if logging service is unavailable
    // Prevents logging failures from breaking plugin functionality
  }
}

/**
 * Log warning message via OpenCode client
 * 
 * Used for recoverable issues (config validation failures, fallback to defaults, etc.)
 * 
 * @param client - Optional OpenCode client with logging capability
 * @param message - Human-readable warning message
 * @param extra - Additional structured data (error details, paths, validation errors)
 * 
 * @example
 * ```typescript
 * await logWarn(client, 'Invalid config, using defaults', { 
 *   path: '/project/opencode.json',
 *   errors: validationErrors 
 * })
 * ```
 */
export async function logWarn(
  client: LogClient | undefined,
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!client?.app?.log) {
    return // Graceful degradation when no client available
  }

  try {
    const logOptions: {
      service: string
      level: string
      message: string
      extra?: Record<string, unknown>
    } = {
      service: 'blocker-diverter',
      level: 'warn',
      message,
    }

    if (extra !== undefined) {
      logOptions.extra = extra
    }

    await client.app.log(logOptions)
  } catch {
    // Silently fail if logging service is unavailable
  }
}

/**
 * Log error message via OpenCode client
 * 
 * Used for operational failures (file I/O errors, unexpected exceptions, etc.)
 * Automatically extracts error message and stack trace when Error object provided.
 * 
 * @param client - Optional OpenCode client with logging capability
 * @param message - Human-readable error message
 * @param error - Optional Error object (message and stack extracted automatically)
 * @param extra - Additional structured data (context, operation, paths)
 * 
 * @example
 * ```typescript
 * try {
 *   await fs.writeFile(path, data)
 * } catch (err) {
 *   await logError(client, 'Failed to write blockers file', err as Error, { 
 *     path,
 *     sessionId 
 *   })
 * }
 * ```
 */
export async function logError(
  client: LogClient | undefined,
  message: string,
  error?: Error,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!client?.app?.log) {
    return // Graceful degradation when no client available
  }

  try {
    const logOptions: {
      service: string
      level: string
      message: string
      extra?: Record<string, unknown>
    } = {
      service: 'blocker-diverter',
      level: 'error',
      message,
    }

    // Build extra object with error details and additional context
    const combinedExtra: Record<string, unknown> = {}

    // Add error details if provided
    if (error !== undefined) {
      combinedExtra.error = error.message
      combinedExtra.stack = error.stack
    }

    // Merge with additional extra context
    if (extra !== undefined) {
      Object.assign(combinedExtra, extra)
    }

    // Only include extra if we have data to include
    if (Object.keys(combinedExtra).length > 0) {
      logOptions.extra = combinedExtra
    }

    await client.app.log(logOptions)
  } catch {
    // Silently fail if logging service is unavailable
  }
}

/**
 * Log debug message via OpenCode client
 * 
 * Used for detailed diagnostic information (deduplication checks, state changes, etc.)
 * Should be used for verbose operational details that aid in troubleshooting.
 * 
 * @param client - Optional OpenCode client with logging capability
 * @param message - Human-readable debug message
 * @param extra - Additional structured data (hashes, timings, state snapshots)
 * 
 * @example
 * ```typescript
 * await logDebug(client, 'Deduplication check', { 
 *   hash: 'abc123',
 *   inCooldown: true,
 *   cooldownRemaining: 25000 
 * })
 * ```
 */
export async function logDebug(
  client: LogClient | undefined,
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!client?.app?.log) {
    return // Graceful degradation when no client available
  }

  try {
    const logOptions: {
      service: string
      level: string
      message: string
      extra?: Record<string, unknown>
    } = {
      service: 'blocker-diverter',
      level: 'debug',
      message,
    }

    if (extra !== undefined) {
      logOptions.extra = extra
    }

    await client.app.log(logOptions)
  } catch {
    // Silently fail if logging service is unavailable
  }
}
