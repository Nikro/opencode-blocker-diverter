/**
 * Tests for dot-delimited /blockers.* command handlers
 * 
 * Tests all commands (on, off, status, list) with mocked dependencies,
 * verifying state changes and logging output.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { 
  handleOnCommand,
  handleOffCommand,
  handleStatusCommand,
  handleListCommand 
} from '../../src/commands/blockers-cmd'
import { getState, cleanupState } from '../../src/state'
import type { LogClient } from '../../src/config'
import type { PluginConfig } from '../../src/types'

describe('Blocker Command Handlers', () => {
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
    repromptWindowMs: 300000,
    completionMarker: 'BLOCKER_DIVERTER_DONE!',
    promptTimeoutMs: 30000,
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

  describe('handleOnCommand', () => {
    it('should enable blocker diversion for session', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = false // Start disabled

      const result = await handleOnCommand(state, mockClient)

      expect(state.divertBlockers).toBe(true)
      expect(logMessages).toHaveLength(1)
      expect(logMessages[0].level).toBe('info')
      expect(logMessages[0].message).toContain('enabled')
      
      // Check CommandResult structure
      expect(result.handled).toBe(true)
      expect(result.minimalResponse).toBeDefined()
      expect(result.toast).toBeDefined()
      expect(result.toast?.variant).toBe('success')
    })

    it('should log confirmation message', async () => {
      const state = getState(testSessionId)
      const result = await handleOnCommand(state, mockClient)

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/blocker diverter enabled/i)
      expect(result.toast?.message).toContain('Enabled')
    })
  })

  describe('handleOffCommand', () => {
    it('should disable blocker diversion for session', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = true // Start enabled

      const result = await handleOffCommand(state, mockClient)

      expect(state.divertBlockers).toBe(false)
      expect(logMessages).toHaveLength(1)
      expect(logMessages[0].level).toBe('info')
      expect(logMessages[0].message).toContain('disabled')
      
      // Check CommandResult structure
      expect(result.handled).toBe(true)
      expect(result.minimalResponse).toBeDefined()
      expect(result.toast).toBeDefined()
      expect(result.toast?.variant).toBe('success')
    })

    it('should log confirmation message', async () => {
      const state = getState(testSessionId)
      const result = await handleOffCommand(state, mockClient)

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/blocker diverter disabled/i)
      expect(result.toast?.message).toContain('Disabled')
    })
  })

  describe('handleStatusCommand', () => {
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

      const result = await handleStatusCommand(state, mockClient, testConfig)

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('enabled')
      expect(logMsg.message).toContain('2')
      expect(logMsg.message).toContain('50')
      
      // Check CommandResult structure
      expect(result.handled).toBe(true)
      expect(result.minimalResponse).toContain('enabled')
      expect(result.minimalResponse).toContain('2/50')
      expect(result.toast).toBeDefined()
      expect(result.toast?.variant).toBe('info')
      expect(result.toast?.message).toContain('enabled')
      expect(result.toast?.message).toContain('2/50')
    })

    it('should show disabled status', async () => {
      const state = getState(testSessionId)
      state.divertBlockers = false

      const result = await handleStatusCommand(state, mockClient, testConfig)

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('disabled')
      expect(result.toast?.message).toContain('disabled')
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

      const result = await handleStatusCommand(state, mockClient, testConfig)

      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/15.*50/)
      expect(result.toast?.message).toContain('15/50')
    })
  })

  describe('handleListCommand', () => {
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

      const result = await handleListCommand(state, mockClient)

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.level).toBe('info')
      expect(logMsg.message).toContain('permission')
      expect(logMsg.message).toContain('architecture')
      expect(logMsg.message).toContain('Allow bash command?')
      expect(logMsg.message).toContain('REST or GraphQL')
      
      // List should NOT be handled - let AI process it
      expect(result.handled).toBe(false)
      expect(result.minimalResponse).toBeUndefined()
      expect(result.toast).toBeUndefined()
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

      const result = await handleListCommand(state, mockClient)

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('...')
      expect(logMsg.message).not.toContain('A'.repeat(85))
      expect(result.handled).toBe(false)
    })

    it('should show message when no blockers recorded', async () => {
      const state = getState(testSessionId)
      state.blockers = []

      const result = await handleListCommand(state, mockClient)

      expect(logMessages).toHaveLength(1)
      const logMsg = logMessages[0]
      expect(logMsg.message).toMatch(/no blockers/i)
      expect(result.handled).toBe(false)
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

      const result = await handleListCommand(state, mockClient)

      const logMsg = logMessages[0]
      expect(logMsg.message).toContain('1.')
      expect(logMsg.message).toContain('2.')
      expect(logMsg.message).toContain('3.')
      expect(result.handled).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle missing client gracefully in handleOnCommand', async () => {
      const state = getState(testSessionId)
      
      // Should not throw
      const result = await handleOnCommand(state, undefined)

      // State should still change
      expect(state.divertBlockers).toBe(true)
      
      // Should still return valid CommandResult
      expect(result.handled).toBe(true)
      expect(result.toast).toBeDefined()
    })

    it('should handle logging failures gracefully in handleStatusCommand', async () => {
      const faultyClient: LogClient = {
        app: {
          log: mock(async () => {
            throw new Error('Logging service unavailable')
          }),
        },
      }

      const state = getState(testSessionId)
      
      // Should not throw
      const result = await handleStatusCommand(state, faultyClient, testConfig)
      
      // Should still return valid CommandResult
      expect(result.handled).toBe(true)
      expect(result.toast).toBeDefined()
    })
  })
})

