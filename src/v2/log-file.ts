/**
 * File-backed logger for the OpenCode 2.x host.
 *
 * v2 plugins get no `client.app.log`. This provides the same `LogClient` interface the
 * shared logging helpers use, and appends JSON lines to the plugin's state directory:
 * `$XDG_STATE_HOME/opencode/blocker-diverter.log` (default `~/.local/state`).
 *
 * @module v2/log-file
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LogClient } from '../config'

export function defaultLogFile(env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME || join(homedir(), '.local', 'state')
  return join(stateHome, 'opencode', 'blocker-diverter.log')
}

export function createFileLogClient(file: string): LogClient {
  return {
    app: {
      log: async ({ body }) => {
        try {
          const line = JSON.stringify({
            time: new Date().toISOString(),
            level: body.level,
            service: body.service,
            message: body.message,
            ...(body.extra === undefined ? {} : { extra: body.extra }),
          })
          await mkdir(dirname(file), { recursive: true, mode: 0o700 })
          await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
        } catch {
          // Logging must never break the plugin
        }
      },
    },
  }
}
