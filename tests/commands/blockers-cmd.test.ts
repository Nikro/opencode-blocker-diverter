/**
 * Tests for /blockers command handler
 * 
 * Tests all subcommands (on, off, status, list) with mocked dependencies,
 * verifying state changes and logging output.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { handleBlockersCommand } from '../../src/commands/blockers-cmd'
import { getState, cleanupState } from '../../src/state'
import type { LogClient, PluginConfig } from '../../src/types'

describe('handleBlockersCommand', () => {
  let mockClient: LogClient
  let logMessages: Array<{ level: string; message: string; extra?: Record<string, unknown> }>
  const testSessionId = 'test-session-blockers-cmd'
  const testConfig: PluginConfig = {
    enabled: true,
    defaultDivertBlockers: true,
    blockersFile: './blockers.md',
    maxBlockersPerRun: 50,
    cooldownMs: 30000,
    maxReprompts: 5,
    repromptWindowMs: 120000,
    completionMarker: 'BLOCKER_DIVERTER_DONE!',
  }

  beforeEach(() => {
    // Clean up state before each test
    cleanupState(testSessionId)
    
    // Initialize fresh state with correct defaults
    const state = getState(testSessionId)
    state.divertBlockers = true
    
    logMessages = []

    // Create mock client
    mockClient = {
      app: {
        log: mock(async (opts: { level: string; message: string; extra?: Record<string, unknown> }) => {
          logMessages.push(opts)
        }),
      },
    }
  })

  afterEach(() => {
    // Clean up state after each test
    cleanupState(testSessionId)
  })

  describe('subcommand: on', () => {
    it('should enable blocker diversion for session', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = false // Start disabled

      await handleBlockersCommand('on', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(state.divertBlockers).toBe(true)
      expect(logMessages).toHaveLength(1)
      expect(logMessages[0].level).toBe('info')
      expect(logMessages[0].message).toContain('enabled')
    })

    it('should log confirmation message', async () => {
      await handleBlockersCommand('on', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/blocker diverter enabled/i)
    })
  })

  describe('subcommand: off', () => {
    it('should disable blocker diversion for session', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = true // Start enabled

      await handleBlockersCommand('off', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(state.divertBlockers).toBe(false)
      expect(logMessages).toHaveLength(1)
      expect(logMessages[0].level).toBe('info')
      expect(logMessages[0].message).toContain('disabled')
    })

    it('should log confirmation message', async () => {
      await handleBlockersCommand('off', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/blocker diverter disabled/i)
    })
  })

  describe('subcommand: status', () => {
    it('should show enabled status with blocker count', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.blockers = [
        {
          id: 'blocker-1',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'permission',
          question: 'Allow bash command?',
          context: 'Running git status',
          blocksProgress: true,
        },
        {
          id: 'blocker-2',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'question',
          question: 'Use camelCase or snake_case?',
          context: 'Naming variable',
          blocksProgress: false,
        },
      ]

      await handleBlockersCommand('status', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('enabled')
      expect(logMsg.message).toContain('2')
      expect(logMsg.message).toContain('50')
    })

    it('should show disabled status', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = false

      await handleBlockersCommand('status', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('disabled')
    })

    it('should include blocker count and max', async () => {
      const state = getState(testSessionId)
      state.blockers = Array(15).fill(null).map((_, i) => ({
        id: `blocker-${i}`,
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'question' as const,
        question: `Question ${i}`,
        context: 'Test context',
        blocksProgress: false,
      }))

      await handleBlockersCommand('status', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/15.*50/)
    })
  })

  describe('subcommand: list', () => {
    it('should list all blockers with category and truncated question', async () => {
      const state = getState(testSessionId)
      state.blockers = [
        {
          id: 'blocker-1',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'permission',
          question: 'Allow bash command?',
          context: 'Running git status',
          blocksProgress: true,
        },
        {
          id: 'blocker-2',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'architecture',
          question: 'Should we use REST or GraphQL API?',
          context: 'API design decision',
          blocksProgress: true,
        },
      ]

      await handleBlockersCommand('list', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('permission')
      expect(logMsg.message).toContain('architecture')
      expect(logMsg.message).toContain('Allow bash command?')
      expect(logMsg.message).toContain('REST or GraphQL')
    })

    it('should truncate long questions to 80 characters', async () => {
      const longQuestion = 'A'.repeat(100)
      const state = getState(testSessionId)
      state.blockers = [
        {
          id: 'blocker-long',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'question',
          question: longQuestion,
          context: 'Test context',
          blocksProgress: false,
        },
      ]

      await handleBlockersCommand('list', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('...')
      expect(logMsg.message).not.toContain('A'.repeat(85))
    })

    it('should show message when no blockers recorded', async () => {
      const state = getState(testSessionId)
      state.blockers = []

      await handleBlockersCommand('list', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/no blockers/i)
    })

    it('should number blockers sequentially', async () => {
      const state = getState(testSessionId)
      state.blockers = Array(3).fill(null).map((_, i) => ({
        id: `blocker-${i}`,
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'question' as const,
        question: `Question ${i + 1}`,
        context: 'Test context',
        blocksProgress: false,
      }))

      await handleBlockersCommand('list', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('1.')
      expect(logMsg.message).toContain('2.')
      expect(logMsg.message).toContain('3.')
    })
  })

  describe('subcommand: undefined (help)', () => {
    it('should show help message when no subcommand provided', async () => {
      await handleBlockersCommand(undefined, {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('/blockers on')
      expect(logMsg.message).toContain('/blockers off')
      expect(logMsg.message).toContain('/blockers status')
      expect(logMsg.message).toContain('/blockers list')
    })
  })

  describe('subcommand: invalid', () => {
    it('should show error and suggest valid subcommands', async () => {
      await handleBlockersCommand('invalid', {
        client: mockClient,
        sessionId: testSessionId,
        config: testConfig,
      })

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('invalid')
      expect(logMsg.message).toMatch(/on.*off.*status.*list/i)
    })
  })

  describe('error handling', () => {
    it('should handle missing client gracefully', async () => {
      const state = getState(testSessionId)
      
      // Should not throw
      await expect(
        handleBlockersCommand('on', {
          client: undefined,
          sessionId: testSessionId,
          config: testConfig,
        })
      ).resolves.toBeUndefined()

      // State should still change
      expect(state.divertBlockers).toBe(true)
    })

    it('should handle logging failures gracefully', async () => {
      const faultyClient: LogClient = {
        app: {
          log: mock(async () => {
            throw new Error('Logging service unavailable')
          }),
        },
      }

      // Should not throw
      await expect(
        handleBlockersCommand('status', {
          client: faultyClient,
          sessionId: testSessionId,
          config: testConfig,
        })
      ).resolves.toBeUndefined()
    })
  })
})
