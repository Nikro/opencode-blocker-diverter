/**
 * Tests for the v2 file logger permissions (src/v2/log-file.ts).
 *
 * @module tests/v2/log-file
 */

import { describe, it, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileLogClient } from '../../src/v2/log-file'

describe('file log client permissions', () => {
  it('creates the log directory with mode 0700 and the log file with mode 0600', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bd-log-file-'))
    try {
      const dir = join(root, 'state', 'opencode')
      const file = join(dir, 'blocker-diverter.log')
      await createFileLogClient(file).app?.log?.({
        body: { level: 'info', service: 'blocker-diverter', message: 'hello' },
      })
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(readFileSync(file, 'utf8')).toContain('"message":"hello"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
