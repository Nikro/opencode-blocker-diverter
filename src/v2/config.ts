/**
 * Configuration loading for the OpenCode 2.x host.
 *
 * Sources, highest precedence first:
 * 1. `ctx.options` (keys override the chosen file)
 * 2. Project file `.opencode/blocker-diverter.json`
 * 3. Global file `blocker-diverter.json` in the v2 config dir
 *    (`OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`)
 * 4. Defaults (`defaultDivertBlockers: false`)
 *
 * @module v2/config
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, resolveBlockersFilePath, type Config, type LogClient } from '../config'
import { logInfo, logWarn } from '../utils/logging'

export function globalConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
}

async function readJsonFile(path: string, client: LogClient): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    await logWarn(client, `Config is not a JSON object: ${path}`)
  } catch (error) {
    await logWarn(client, `Failed to parse config ${path}`, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return undefined
}

export async function loadConfigV2(
  projectDir: string,
  options: Readonly<Record<string, unknown>>,
  client: LogClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<Config> {
  const configDir = globalConfigDir(env)
  const candidates = [
    join(projectDir, '.opencode', 'blocker-diverter.json'),
    join(configDir, 'blocker-diverter.json'),
  ]
  const baseDir = projectDir === '/' ? configDir : projectDir

  for (const path of candidates) {
    const fileConfig = await readJsonFile(path, client)
    if (fileConfig === undefined) continue

    const parsed = ConfigSchema.safeParse({ ...fileConfig, ...options })
    if (parsed.success) {
      await logInfo(client, `Loaded config from ${path}`)
      return { ...parsed.data, blockersFile: resolveBlockersFilePath(parsed.data.blockersFile, baseDir) }
    }
    await logWarn(client, `Config validation failed for ${path}`, {
      issues: parsed.error.issues.map((issue) => issue.message),
    })
  }

  const optionsOnly = ConfigSchema.safeParse(options)
  if (!optionsOnly.success) {
    await logWarn(client, 'Plugin options failed validation, using defaults', {
      issues: optionsOnly.error.issues.map((issue) => issue.message),
    })
  }
  const defaults = optionsOnly.success ? optionsOnly.data : ConfigSchema.parse({})
  await logInfo(client, 'No config found, using defaults', { checkedPaths: candidates })
  return { ...defaults, blockersFile: resolveBlockersFilePath(defaults.blockersFile, baseDir) }
}
