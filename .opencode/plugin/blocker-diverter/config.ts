/**
 * Configuration loading and validation for Blocker Diverter plugin
 * 
 * Loads configuration from opencode.json, validates with Zod schema,
 * and provides graceful fallback to defaults on errors.
 * 
 * @module config
 */

import { z } from 'zod'
import { resolve, isAbsolute } from 'path'

/**
 * Zod schema for plugin configuration
 * 
 * Validates all configuration fields with appropriate constraints:
 * - enabled: Global plugin toggle (default: true)
 * - defaultDivertBlockers: Default session behavior (default: true)
 * - blockersFile: Path to log file (default: './blockers.md')
 * - maxBlockersPerRun: Session blocker limit, 1-100 (default: 50)
 * - cooldownMs: Deduplication window, min 1000ms (default: 30000)
 * - maxReprompts: Stop prevention limit, min 1 (default: 5)
 * - repromptWindowMs: Reprompt time window, min 60000ms (default: 120000)
 * - completionMarker: Session completion marker (default: 'BLOCKER_DIVERTER_DONE!')
 */
export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultDivertBlockers: z.boolean().default(true),
  blockersFile: z.string().default('./blockers.md'),
  maxBlockersPerRun: z.number().int().min(1).max(100).default(50),
  cooldownMs: z.number().int().min(1000).default(30000),
  maxReprompts: z.number().int().min(1).default(5),
  repromptWindowMs: z.number().int().min(60000).default(120000),
  completionMarker: z.string().default('BLOCKER_DIVERTER_DONE!'),
})

/**
 * Validated configuration type inferred from Zod schema
 */
export type Config = z.infer<typeof ConfigSchema>

/**
 * OpenCode client interface for structured logging
 * 
 * This interface provides type safety for the optional client parameter
 * used in loadConfig for structured logging via OpenCode's logging API.
 */
export interface LogClient {
  app?: {
    log?: (opts: {
      service?: string
      level: string
      message: string
      extra?: Record<string, unknown>
    }) => Promise<void>
  }
}

/**
 * Load and validate plugin configuration from opencode.json
 * 
 * Reads the `blockerDiverter` section from opencode.json in the project root.
 * Falls back to defaults on any error (missing file, invalid JSON, validation failure).
 * Logs warnings/info via client.app.log when available.
 * 
 * Error handling strategy:
 * - File not found → use defaults, log info
 * - Invalid JSON → use defaults, log warning
 * - Zod validation fails → use defaults, log warning with errors
 * - No client provided → skip logging (graceful degradation)
 * 
 * Path resolution:
 * - Relative paths (starting with '.') are resolved against projectDir
 * - Absolute paths are kept unchanged
 * 
 * @param projectDir - Project worktree path (from plugin context)
 * @param client - Optional OpenCode client for structured logging
 * @returns Validated config with defaults applied and paths resolved
 * 
 * @example
 * ```typescript
 * const config = await loadConfig('/path/to/project', client)
 * console.log(config.blockersFile) // Absolute path
 * ```
 */
export async function loadConfig(
  projectDir: string,
  client?: LogClient
): Promise<Config> {
  const configPath = resolve(projectDir, 'opencode.json')

  try {
    // Check if config file exists
    const file = Bun.file(configPath)
    const exists = await file.exists()

    if (!exists) {
      await logInfo(
        client,
        `opencode.json not found at ${configPath}, using defaults`
      )
      return getDefaultsWithResolvedPaths(projectDir)
    }

    // Read and parse JSON
    const fileContent = await file.text()
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(fileContent)
    } catch (parseError) {
      await logWarning(
        client,
        `Invalid JSON in opencode.json: ${(parseError as Error).message}`,
        { path: configPath }
      )
      return getDefaultsWithResolvedPaths(projectDir)
    }

    // Extract blockerDiverter section (safe extraction from unknown type)
    const blockerDiverterConfig =
      (parsedJson as Record<string, unknown>)?.blockerDiverter ?? {}

    // Validate with Zod schema
    const validationResult = ConfigSchema.safeParse(blockerDiverterConfig)

    if (!validationResult.success) {
      // Extract validation errors safely (Zod uses .issues, not .errors)
      const validationErrors = validationResult.error.issues.map(err => ({
        path: err.path.join('.'),
        message: err.message,
        code: err.code,
      }))

      await logWarning(
        client,
        'Blocker Diverter config validation failed, using defaults',
        { errors: validationErrors }
      )
      return getDefaultsWithResolvedPaths(projectDir)
    }

    // Resolve blockersFile path
    const validatedConfig = validationResult.data
    validatedConfig.blockersFile = resolveBlockersFilePath(
      validatedConfig.blockersFile,
      projectDir
    )

    return validatedConfig
  } catch (error) {
    // Catch-all for unexpected errors (filesystem issues, etc.)
    await logWarning(
      client,
      `Failed to load config: ${(error as Error).message}`,
      { error: (error as Error).stack }
    )
    return getDefaultsWithResolvedPaths(projectDir)
  }
}

/**
 * Get default configuration with resolved paths
 * 
 * @param projectDir - Project root directory
 * @returns Default config with blockersFile resolved to absolute path
 */
function getDefaultsWithResolvedPaths(projectDir: string): Config {
  const defaults = ConfigSchema.parse({})
  defaults.blockersFile = resolveBlockersFilePath(defaults.blockersFile, projectDir)
  return defaults
}

/**
 * Resolve blockersFile path to absolute path
 * 
 * Relative paths (starting with '.') are resolved against projectDir.
 * Absolute paths are returned unchanged.
 * 
 * Security: Validates that resolved paths stay within projectDir to prevent
 * directory traversal attacks (e.g., '../../../etc/passwd').
 * 
 * @param blockersFile - Path from config (relative or absolute)
 * @param projectDir - Project root directory
 * @returns Absolute path to blockers file (validated to be within projectDir)
 */
function resolveBlockersFilePath(blockersFile: string, projectDir: string): string {
  // Resolve absolute project directory
  const absoluteProjectDir = resolve(projectDir)
  
  if (isAbsolute(blockersFile)) {
    // Absolute path: validate it's within project directory
    if (!blockersFile.startsWith(absoluteProjectDir)) {
      // Path traversal detected: absolute path outside project, use default
      return resolve(absoluteProjectDir, './blockers.md')
    }
    return blockersFile
  }
  
  // Relative path: resolve and validate
  const resolvedPath = resolve(absoluteProjectDir, blockersFile)
  
  // Security check: ensure resolved path stays within projectDir
  if (!resolvedPath.startsWith(absoluteProjectDir)) {
    // Path traversal detected (e.g., '../../../outside.md'), use default
    return resolve(absoluteProjectDir, './blockers.md')
  }
  
  return resolvedPath
}

/**
 * Log info message via OpenCode client
 * 
 * @param client - Optional OpenCode client
 * @param message - Log message
 * @param extra - Additional structured data
 */
async function logInfo(
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
  }
}

/**
 * Log warning message via OpenCode client
 * 
 * @param client - Optional OpenCode client
 * @param message - Log message
 * @param extra - Additional structured data (errors, context)
 */
async function logWarning(
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
      level: 'warning',
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
