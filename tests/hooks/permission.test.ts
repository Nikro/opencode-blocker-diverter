/**
 * Test suite for permission hook handler
 * 
 * TDD: Tests written BEFORE implementation
 * Tests cover: blocker detection, deduplication, logging, prompt injection, error handling
 * 
 * @module tests/hooks/permission
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import type { Permission } from '@opencode-ai/sdk'
import { handlePermissionAsked } from '../../src/hooks/permission'
import { getState, cleanupState } from '../../src/state'
import type { PluginConfig } from '../../src/types'
import { resolve } from 'node:path'
import * as blockersFile from '../../src/utils/blockers-file'

describe('permission hook - handlePermissionAsked', () => {
  const mockProjectDir = '/test/project'
  const testSessionId = 'test-session-permission'
  
  let mockClient: any
  let mockConfig: PluginConfig
  let mockInput: Permission
  let mockOutput: any
  let appendBlockerSpy: any

  beforeEach(() => {
    // Clean up session state
    cleanupState(testSessionId)

    // Initialize fresh state with correct defaults
    const state = getState(testSessionId)
    state.divertBlockers = true

    // Mock client with logging and session.prompt
    mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      },
      session: {
        prompt: mock(() => Promise.resolve()),
      }
    }

    // Default config
    mockConfig = {
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: resolve(mockProjectDir, './blockers.md'),
      maxBlockersPerRun: 50,
      cooldownMs: 30000,
      maxReprompts: 5,
      repromptWindowMs: 120000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
    }

    // Default input - CORRECT SDK structure
    mockInput = {
      id: 'perm-test-123',
      type: 'bash',
      sessionID: testSessionId,
      messageID: 'msg-test-456',
      callID: 'call-test-789',
      title: 'Run bash command',
      metadata: {
        tool: 'bash',
        args: { command: 'npm install' }
      },
      time: {
        created: Date.now()
      }
    }

    // Default output
    mockOutput = {
      status: 'ask' as 'allow' | 'deny' | 'ask',
    }

    // Mock blockers-file functions to avoid filesystem operations
    appendBlockerSpy = spyOn(blockersFile, 'appendBlocker').mockResolvedValue(true)
  })

  afterEach(() => {
    cleanupState(testSessionId)
  })

  describe('Plugin State Checks', () => {
    it('should pass through when divertBlockers is disabled', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = false

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should not modify output
      expect(mockOutput.status).toBe('ask')
      // Should not log blocker
      expect(mockClient.app.log).not.toHaveBeenCalled()
      // Should not inject prompt
      expect(mockClient.session.prompt).not.toHaveBeenCalled()
    })

    it('should intercept when divertBlockers is enabled (default)', async () => {
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should modify output to deny
      expect(mockOutput.status).toBe('deny')
      // Should have logged
      expect(mockClient.app.log).toHaveBeenCalled()
      // Should have injected prompt
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })
  })

  describe('Permission Type Filtering', () => {
    it('should intercept bash permission', async () => {
      mockInput.type = 'bash'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should intercept edit permission', async () => {
      mockInput.type = 'edit'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should intercept write permission', async () => {
      mockInput.type = 'write'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should intercept external_directory permission', async () => {
      mockInput.type = 'external_directory'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should pass through non-intercepted permission types', async () => {
      mockInput.type = 'network'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should not modify output
      expect(mockOutput.status).toBe('ask')
      // Should log that it's not intercepted
      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('not intercepted'),
        })
      )
      // Should not inject prompt
      expect(mockClient.session.prompt).not.toHaveBeenCalled()
    })

    it('should pass through read-only permissions', async () => {
      mockInput.type = 'read'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('ask')
      expect(mockClient.session.prompt).not.toHaveBeenCalled()
    })
  })

  describe('Blocker Logging', () => {
    it('should create blocker with correct structure', async () => {
      const state = getState(testSessionId)

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(state.blockers.length).toBe(1)
      const blocker = state.blockers[0]
      
      expect(blocker).toBeDefined()
      expect(blocker?.id).toBeTypeOf('string')
      expect(blocker?.timestamp).toBeTypeOf('string')
      expect(blocker?.sessionId).toBe(testSessionId)
      expect(blocker?.category).toBe('permission')
      expect(blocker?.question).toContain('bash')
      expect(blocker?.context).toBeTypeOf('string')
      expect(blocker?.blocksProgress).toBe(true)
    })

    it('should include permission details in blocker question', async () => {
      mockInput.type = 'bash'
      mockInput.metadata.tool = 'bash'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]
      
      expect(blocker?.question).toContain('bash')
      expect(blocker?.question).toContain('permission')
    })

    it('should include args in blocker context', async () => {
      mockInput.metadata.args = { command: 'rm -rf /data', cwd: '/project' }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]
      
      expect(blocker?.context).toContain('rm -rf')
    })

    it('should handle missing tool gracefully', async () => {
      mockInput.metadata.tool = undefined

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]
      
      expect(blocker?.question).toBeDefined()
      expect(blocker?.question).toContain('permission')
    })

    it('should handle missing args gracefully', async () => {
      mockInput.metadata.args = undefined

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]
      
      expect(blocker?.context).toBeDefined()
      expect(blocker?.context).toBeTypeOf('string')
    })

    it('should log info message when blocker is recorded', async () => {
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'blocker-diverter',
          level: 'info',
          message: expect.stringContaining('Blocker logged'),
        })
      )
    })
  })

  describe('Deduplication', () => {
    it('should skip logging duplicate blocker within cooldown', async () => {
      // First call - should log
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(1)

      // Reset mocks
      mockClient.app.log = mock(() => Promise.resolve())
      mockClient.session.prompt = mock(() => Promise.resolve())
      mockOutput.status = 'ask'

      // Second call with same input - should skip logging but still deny
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still deny and inject prompt
      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()

      // Should NOT add second blocker
      expect(state.blockers.length).toBe(1)

      // Should log that it's a duplicate
      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('Duplicate blocker'),
        })
      )
    })

    it('should log different permissions separately', async () => {
      // First permission
      mockInput.type = 'bash'
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Second different permission
      mockInput.type = 'edit'
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(2)
    })

    it('should log same permission with different args', async () => {
      // First command
      mockInput.metadata.args = { command: 'npm install' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Second different command
      mockInput.metadata.args = { command: 'npm test' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(2)
    })
  })

  describe('Max Blockers Limit', () => {
    it('should skip logging when max blockers reached (per-session)', async () => {
      // Set very low limit
      mockConfig.maxBlockersPerRun = 2

      // Pre-fill session state to reach limit
      const state = getState(testSessionId)
      state.blockers.push(
        { id: '1', timestamp: new Date().toISOString(), sessionId: testSessionId, category: 'permission', question: 'q1', context: 'c1', blocksProgress: true },
        { id: '2', timestamp: new Date().toISOString(), sessionId: testSessionId, category: 'permission', question: 'q2', context: 'c2', blocksProgress: true }
      )

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still deny and inject prompt
      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()

      // Should log that max reached
      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('Max blockers reached'),
        })
      )

      // Should NOT add new blocker (still 2)
      expect(state.blockers.length).toBe(2)
    })

    it('should continue logging until max reached', async () => {
      mockConfig.maxBlockersPerRun = 3

      // Log 3 different permissions
      mockInput.type = 'bash'
      mockInput.metadata.args = { command: 'cmd1' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      mockInput.type = 'edit'
      mockInput.metadata.args = { file: 'file1' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      mockInput.type = 'write'
      mockInput.metadata.args = { file: 'file2' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(3)
    })
  })

  describe('Prompt Injection', () => {
    it('should inject continuation prompt with correct session ID', async () => {
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: testSessionId },
          body: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('permission'),
              })
            ])
          })
        })
      )
    })

    it('should include permission type in injected prompt', async () => {
      mockInput.type = 'bash'

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const promptCall = mockClient.session.prompt.mock.calls[0]?.[0]
      const promptText = promptCall?.body?.parts?.[0]?.text

      expect(promptText).toContain('bash')
    })

    it('should set output status to deny before injecting prompt', async () => {
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      expect(mockOutput.status).toBe('deny')
    })
  })

  describe('Error Handling', () => {
    it('should handle file write failures gracefully', async () => {
      // Make appendBlocker fail
      appendBlockerSpy.mockResolvedValue(false)

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should log error about failed file write
      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('Failed to log blocker'),
        })
      )

      // Should still deny and inject (graceful degradation)
      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should log error when session.prompt fails', async () => {
      mockClient.session.prompt = mock(() => Promise.reject(new Error('Prompt injection failed')))

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still deny
      expect(mockOutput.status).toBe('deny')

      // Should log error
      expect(mockClient.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('continuation prompt'),
        })
      )
    })

    it('should continue operation when logging fails', async () => {
      mockClient.app.log = mock(() => Promise.reject(new Error('Logging service down')))

      // Should not throw - logging errors are caught
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still deny and inject
      expect(mockOutput.status).toBe('deny')
      expect(mockClient.session.prompt).toHaveBeenCalled()
    })

    it('should handle undefined client gracefully', async () => {
      // This tests defensive programming
      await handlePermissionAsked(mockInput, mockOutput, undefined as any, mockConfig, mockProjectDir)

      // Should still modify output
      expect(mockOutput.status).toBe('deny')
    })
  })

  describe('Classification Logic', () => {
    it('should classify all intercepted permissions as hard blockers', async () => {
      const permissions = ['bash', 'edit', 'write', 'external_directory']

      for (const permission of permissions) {
        cleanupState(testSessionId)
        mockInput.type = permission
        mockOutput.status = 'ask'

        await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

        const state = getState(testSessionId)
        const blocker = state.blockers[0]

        expect(blocker?.blocksProgress).toBe(true)
        expect(blocker?.category).toBe('permission')
      }
    })

    it('should create unique blocker IDs', async () => {
      mockInput.metadata.args = { command: 'cmd1' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      mockInput.metadata.args = { command: 'cmd2' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const id1 = state.blockers[0]?.id
      const id2 = state.blockers[1]?.id

      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })
  })

  describe('Integration Tests', () => {
    it('should handle complete workflow: detect → log → deny → inject', async () => {
      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(0)

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Check blocker logged
      expect(state.blockers.length).toBe(1)
      expect(state.blockers[0]?.category).toBe('permission')

      // Check output modified
      expect(mockOutput.status).toBe('deny')

      // Check prompt injected
      expect(mockClient.session.prompt).toHaveBeenCalledTimes(1)

      // Check logging happened
      expect(mockClient.app.log).toHaveBeenCalled()
    })

    it('should handle multiple permissions in same session', async () => {
      // First permission
      mockInput.type = 'bash'
      mockInput.metadata.args = { command: 'npm install' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Second permission
      mockInput.type = 'edit'
      mockInput.metadata.args = { file: 'test.ts' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Third permission
      mockInput.type = 'write'
      mockInput.metadata.args = { file: 'output.json' }
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      expect(state.blockers.length).toBe(3)
      expect(state.blockers[0]?.category).toBe('permission')
      expect(state.blockers[1]?.category).toBe('permission')
      expect(state.blockers[2]?.category).toBe('permission')
    })

    it('should maintain cooldown hashes across calls', async () => {
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const hashCount = state.cooldownHashes.size

      expect(hashCount).toBeGreaterThan(0)

      // Duplicate call
      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Hash count should not increase
      expect(state.cooldownHashes.size).toBe(hashCount)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty session ID', async () => {
      mockInput.sessionID = ''

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still work (empty string is valid session ID)
      expect(mockOutput.status).toBe('deny')
    })

    it('should pass through very long permission names that are not intercepted', async () => {
      mockInput.type = 'a'.repeat(500)

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should pass through (not in intercepted list)
      expect(mockOutput.status).toBe('ask')
    })

    it('should handle complex nested args', async () => {
      mockInput.metadata.args = {
        command: 'docker run',
        flags: ['--rm', '-it'],
        env: { NODE_ENV: 'production' },
        volumes: ['/host:/container'],
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      expect(blocker?.context).toContain('docker')
    })

    it('should handle null args', async () => {
      mockInput.metadata.args = null

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      // Should still work - null args are handled
      expect(mockOutput.status).toBe('deny')
    })
  })

  describe('Secret Redaction', () => {
    it('should redact case-insensitive keywords (API keys)', async () => {
      mockInput.metadata.args = {
        command: 'curl',
        api_key: 'secret123',
        API_KEY: 'TOPSECRET',
        apiKey: 'alsoSecret',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // All API key variations should be redacted
      expect(blocker?.context).not.toContain('secret123')
      expect(blocker?.context).not.toContain('TOPSECRET')
      expect(blocker?.context).not.toContain('alsoSecret')
      expect(blocker?.context).toContain('[REDACTED]')
    })

    it('should redact all occurrences (global flag)', async () => {
      mockInput.metadata.args = {
        password: 'pass1',
        backup_password: 'pass2',
        admin_password: 'pass3',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // All password occurrences should be redacted
      expect(blocker?.context).not.toContain('pass1')
      expect(blocker?.context).not.toContain('pass2')
      expect(blocker?.context).not.toContain('pass3')
      
      // Count [REDACTED] occurrences - should be at least 3
      const redactedCount = (blocker?.context.match(/\[REDACTED\]/g) || []).length
      expect(redactedCount).toBeGreaterThanOrEqual(3)
    })

    it('should redact auth/authorization keywords', async () => {
      mockInput.metadata.args = {
        command: 'curl -H "Authorization: Bearer abc123"',
        auth: 'Basic dXNlcjpwYXNz',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // Authorization values should be redacted
      expect(blocker?.context).not.toContain('abc123')
      expect(blocker?.context).not.toContain('dXNlcjpwYXNz')
      expect(blocker?.context).toContain('[REDACTED]')
    })

    it('should handle embedded secrets in bash commands', async () => {
      mockInput.metadata.args = {
        command: 'export API_KEY=sk-1234567890 && curl -H "token: secret-token-here" https://api.example.com',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // Command-line style secrets should be redacted
      expect(blocker?.context).not.toContain('sk-1234567890')
      expect(blocker?.context).not.toContain('secret-token-here')
      expect(blocker?.context).toContain('[REDACTED]')
      
      // Should preserve non-sensitive parts
      expect(blocker?.context).toContain('curl')
      expect(blocker?.context).toContain('https://api.example.com')
    })

    it('should preserve non-sensitive data', async () => {
      mockInput.metadata.args = {
        command: 'npm install',
        file: 'README.md',
        port: 3000,
        host: 'localhost',
        environment: 'production',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // Non-sensitive data should remain intact
      expect(blocker?.context).toContain('npm install')
      expect(blocker?.context).toContain('README.md')
      expect(blocker?.context).toContain('3000')
      expect(blocker?.context).toContain('localhost')
      expect(blocker?.context).toContain('production')
      
      // Should NOT contain [REDACTED] for non-sensitive data
      expect(blocker?.context).not.toContain('[REDACTED]')
    })

    it('should redact tokens in various formats', async () => {
      mockInput.metadata.args = {
        access_token: 'oauth_token_123',
        'auth-token': 'bearer_456',
        bearer: 'jwt_789',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // All token formats should be redacted
      expect(blocker?.context).not.toContain('oauth_token_123')
      expect(blocker?.context).not.toContain('bearer_456')
      expect(blocker?.context).not.toContain('jwt_789')
      expect(blocker?.context).toContain('[REDACTED]')
    })

    it('should redact secrets in mixed-case JSON', async () => {
      mockInput.metadata.args = {
        PASSWORD: 'MyPassword123',
        Secret: 'MySecret456',
        Client_Secret: 'ClientSecret789',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // Mixed-case sensitive keys should be redacted
      expect(blocker?.context).not.toContain('MyPassword123')
      expect(blocker?.context).not.toContain('MySecret456')
      expect(blocker?.context).not.toContain('ClientSecret789')
    })

    it('should handle CLI-style key=value without quotes', async () => {
      mockInput.metadata.args = {
        command: 'app deploy --password=secret123 --api_key=key456 --token=tok789',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // CLI-style secrets should be redacted
      expect(blocker?.context).not.toContain('secret123')
      expect(blocker?.context).not.toContain('key456')
      expect(blocker?.context).not.toContain('tok789')
      expect(blocker?.context).toContain('[REDACTED]')
    })

    it('should redact JSON keys with hyphens (SECURITY FIX)', async () => {
      mockInput.metadata.args = {
        'x-api-key': 'sk-12345678901234567890',
        'auth-token': 'tok-987654321',
        'bearer-token': 'jwt-abcdefghijk',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // CRITICAL: Hyphenated keys MUST be redacted
      expect(blocker?.context).not.toContain('sk-12345678901234567890')
      expect(blocker?.context).not.toContain('tok-987654321')
      expect(blocker?.context).not.toContain('jwt-abcdefghijk')
      expect(blocker?.context).toContain('[REDACTED]')
      
      // Count [REDACTED] occurrences - should be at least 3
      const redactedCount = (blocker?.context.match(/\[REDACTED\]/g) || []).length
      expect(redactedCount).toBeGreaterThanOrEqual(3)
    })

    it('should redact JSON keys with dots (SECURITY FIX)', async () => {
      mockInput.metadata.args = {
        'db.password': 'supersecret123',
        'config.api_key': 'key-456789',
        'settings.auth.token': 'token-xyz',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // CRITICAL: Dot-separated keys MUST be redacted
      expect(blocker?.context).not.toContain('supersecret123')
      expect(blocker?.context).not.toContain('key-456789')
      expect(blocker?.context).not.toContain('token-xyz')
      expect(blocker?.context).toContain('[REDACTED]')
      
      // Count [REDACTED] occurrences - should be at least 3
      const redactedCount = (blocker?.context.match(/\[REDACTED\]/g) || []).length
      expect(redactedCount).toBeGreaterThanOrEqual(3)
    })

    it('should redact JSON keys with colons (SECURITY FIX)', async () => {
      mockInput.metadata.args = {
        'auth:token': 'Bearer abc123xyz',
        'client:secret': 'client-secret-value',
        'private:key': 'private-key-data',
      }

      await handlePermissionAsked(mockInput, mockOutput, mockClient, mockConfig, mockProjectDir)

      const state = getState(testSessionId)
      const blocker = state.blockers[0]

      // CRITICAL: Colon-separated keys MUST be redacted
      expect(blocker?.context).not.toContain('Bearer abc123xyz')
      expect(blocker?.context).not.toContain('client-secret-value')
      expect(blocker?.context).not.toContain('private-key-data')
      expect(blocker?.context).toContain('[REDACTED]')
      
      // Count [REDACTED] occurrences - should be at least 3
      const redactedCount = (blocker?.context.match(/\[REDACTED\]/g) || []).length
      expect(redactedCount).toBeGreaterThanOrEqual(3)
    })
  })
})
