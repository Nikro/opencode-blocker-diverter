/**
 * Configuration loading and validation for Blocker Diverter plugin
 * 
 * Loads configuration from standard plugin config locations:
 * - User: ~/.config/opencode/blocker-diverter.json (global defaults)
 * - Project: .opencode/blocker-diverter.json (project overrides)
 * 
 * Project config takes precedence over user config.
 * Falls back to defaults if no config files exist.
 * 
 * @module config
 */

import { z } from 'zod'
import { resolve, isAbsolute, join } from 'path'
import { homedir } from 'os'

/**
 * Zod schema for plugin configuration
 * 
 * Validates all configuration fields with appropriate constraints:
 * - enabled: Global plugin toggle (default: true)
 * - defaultDivertBlockers: Default session behavior (default: false)
 * - blockersFile: Path to log file (default: './BLOCKERS.md')
 * - maxBlockersPerRun: Session blocker limit, 1-100 (default: 50)
 * - cooldownMs: Deduplication window, min 1000ms (default: 30000)
 * - maxReprompts: Stop prevention limit, min 1 (default: 5)
 * - repromptWindowMs: Reprompt time window, min 60000ms (default: 300000 / 5 minutes)
 * - completionMarker: Session completion marker (default: 'BLOCKER_DIVERTER_DONE!')
 * - promptTimeoutMs: Prompt API timeout, min 1000ms (default: 30000)
 */
export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultDivertBlockers: z.boolean().default(false),
  blockersFile: z.string().default('./BLOCKERS.md'),
  maxBlockersPerRun: z.number().int().min(1).max(100).default(50),
  cooldownMs: z.number().int().min(1000).default(30000),
  maxReprompts: z.number().int().min(1).default(5),
  repromptWindowMs: z.number().int().min(60000).default(300000),
  completionMarker: z.string().default('BLOCKER_DIVERTER_DONE!'),
  promptTimeoutMs: z.number().int().min(1000).default(30000),
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
 * Type guard to check if an object is a LogClient
 * 
 * @param client - Object to check
 * @returns true if client has the LogClient structure
 */
export function isLogClient(client: unknown): client is LogClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'app' in client
  )
}

/**
 * Load and validate plugin configuration from standard locations
 * 
 * Config loading order (later overrides earlier):
 * 1. User config: ~/.config/opencode/blocker-diverter.json
 * 2. Project config: .opencode/blocker-diverter.json
 * 
 * Falls back to defaults if no config files exist.
 * Logs warnings/info via client.app.log when available.
 * 
 * Error handling strategy:
 * - File not found → try next location, fallback to defaults
 * - Invalid JSON → log warning, use defaults
 * - Zod validation fails → log warning with errors, use defaults
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
  // Standard plugin config locations
  const userConfigPath = join(homedir(), '.config', 'opencode', 'blocker-diverter.json')
  const projectConfigPath = join(projectDir, '.opencode', 'blocker-diverter.json')

  // Try project config first (highest priority)
  const projectConfig = await loadConfigFromPath(projectConfigPath, client)
  if (projectConfig) {
    await logInfo(client, `Loaded config from ${projectConfigPath}`)
    return resolveConfigPaths(projectConfig, projectDir)
  }

  // Fall back to user config
  const userConfig = await loadConfigFromPath(userConfigPath, client)
  if (userConfig) {
    await logInfo(client, `Loaded config from ${userConfigPath}`)
    return resolveConfigPaths(userConfig, projectDir)
  }

  // No config found, use defaults
  await logInfo(
    client,
    'No config found, using defaults',
    { 
      checkedPaths: [projectConfigPath, userConfigPath] 
    }
  )
  return getDefaultsWithResolvedPaths(projectDir)
}

/**
 * Load config from a specific file path
 * 
 * @param configPath - Absolute path to config file
 * @returns Validated config or null if file doesn't exist or is invalid
 */
async function loadConfigFromPath(
  configPath: string,
  client?: LogClient
): Promise<Config | null> {
  try {
    // Check if file exists (using Bun.file for async)
    const file = Bun.file(configPath)
    const exists = await file.exists()
    
    if (!exists) {
      return null
    }

    // Read and parse JSON
    const fileContent = await file.text()
    const parsedJson: unknown = JSON.parse(fileContent)

    // Validate with Zod schema
    const validationResult = ConfigSchema.safeParse(parsedJson)

    if (!validationResult.success) {
      // Validation failed - log and return null
      await logWarning(
        client,
        `Config validation failed for ${configPath}`,
        { issues: validationResult.error.issues.map(i => i.message) }
      )
      return null
    }

    return validationResult.data
  } catch (error) {
    // Parse error or filesystem error
    await logWarning(
      client,
      `Failed to load config from ${configPath}`,
      { error: error instanceof Error ? error.message : String(error) }
    )
    return null
  }
}

/**
 * Resolve relative paths in config
 * 
 * @param config - Validated config with potentially relative paths
 * @param projectDir - Project root directory
 * @returns Config with resolved absolute paths
 */
function resolveConfigPaths(config: Config, projectDir: string): Config {
  return {
    ...config,
    blockersFile: resolveBlockersFilePath(config.blockersFile, projectDir),
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
      return resolve(absoluteProjectDir, './BLOCKERS.md')
    }
    return blockersFile
  }
  
  // Relative path: resolve and validate
  const resolvedPath = resolve(absoluteProjectDir, blockersFile)
  
  // Security check: ensure resolved path stays within projectDir
  if (!resolvedPath.startsWith(absoluteProjectDir)) {
    // Path traversal detected (e.g., '../../../outside.md'), use default
    return resolve(absoluteProjectDir, './BLOCKERS.md')
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
