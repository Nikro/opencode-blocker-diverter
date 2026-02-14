/**
 * Tool Interception Hook Tests
 * 
 * Tests the tool.execute.before hook that blocks the 'question' tool
 * during autonomous mode (legacy behavior).
 * 
 * NOTE: The blocker tool is now properly registered via plugin.ts
 * and no longer uses interception. See integration tests for blocker tool.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { handleToolExecuteBefore } from '../../src/hooks/tool-intercept'
import * as blockersFile from '../../src/utils/blockers-file'
import { getState, cleanupState } from '../../src/state'
import type { LogClient } from '../../src/config'
import type { PluginConfig } from '../../src/types'

describe('handleToolExecuteBefore', () => {
  const TEST_SESSION_ID = 'test-session-tool'
  const TEST_PROJECT_DIR = '/test/project'
  
  // Mock client
  const mockClient: LogClient = {
    app: {
      log: mock(() => Promise.resolve())
    }
  }
  
  // Mock config
  const mockConfig: PluginConfig = {
    enabled: true,
    defaultDivertBlockers: true,
    blockersFile: '/test/project/blockers.md',
    maxBlockersPerRun: 50,
    cooldownMs: 30000,
    maxReprompts: 5,
    repromptWindowMs: 300000,
    completionMarker: 'BLOCKER_DIVERTER_DONE!',
    promptTimeoutMs: 30000
  }
  
  let appendBlockerSpy: ReturnType<typeof spyOn>
  
  beforeEach(() => {
    // Reset state
    cleanupState(TEST_SESSION_ID)
    
    // Restore previous spy if it exists
    if (appendBlockerSpy) {
      appendBlockerSpy.mockRestore()
    }
    
    // Create fresh spy
    appendBlockerSpy = spyOn(blockersFile, 'appendBlocker').mockResolvedValue(true)
  })
  
  afterEach(() => {
    appendBlockerSpy.mockRestore()
    cleanupState(TEST_SESSION_ID)
  })
  
  describe('Passthrough behavior', () => {
    it('should allow unhandled tools to execute', async () => {
      // Track initial call count
      const initialCallCount = appendBlockerSpy.mock.calls.length
      
      const input = {
        tool: 'bash',
        sessionID: TEST_SESSION_ID,
        callID: 'call-bash-1'
      }
      const output = { args: {} }
      
      // Should not throw
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).resolves.toBeUndefined()
      
      // Should not log blocker (no new calls)
      expect(appendBlockerSpy.mock.calls.length).toBe(initialCallCount)
    })
    
    it('should pass through when divertBlockers is disabled', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = false
      
      // Track initial call count
      const initialCallCount = appendBlockerSpy.mock.calls.length
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-disabled'
      }
      const output = { args: {} }
      
      // Should not throw when disabled
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).resolves.toBeUndefined()
      
      // Should not log blocker (no new calls)
      expect(appendBlockerSpy.mock.calls.length).toBe(initialCallCount)
    })
  })
  
  describe('Question tool blocking', () => {
    it('should block question tool and throw error', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-1'
      }
      const output = { args: {} }
      
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow(/Autonomous mode is active/)
      
      // Should log blocker
      expect(appendBlockerSpy).toHaveBeenCalledTimes(1)
      
      // Check blocker content
      const blockerCall = appendBlockerSpy.mock.calls[0]
      expect(blockerCall[1].category).toBe('question')
      expect(blockerCall[1].question).toContain('blocked tool')
    })
    
    it('should add question tool blocker to session state', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-state'
      }
      const output = { args: {} }
      
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow()
      
      // Check state was updated
      const updatedState = getState(TEST_SESSION_ID)
      expect(updatedState.blockers).toHaveLength(1)
      expect(updatedState.blockers[0].category).toBe('question')
    })
    
    it('should respect deduplication cooldown for question tool', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-dup'
      }
      const output = { args: {} }
      
      // First call - should log
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow()
      
      expect(appendBlockerSpy).toHaveBeenCalledTimes(1)
      
      // Second call immediately after - should skip logging
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow()
      
      // Should not log again
      expect(appendBlockerSpy).toHaveBeenCalledTimes(1)
    })
    
    it('should respect max blockers limit for question tool', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      // Fill state with max blockers
      for (let i = 0; i < mockConfig.maxBlockersPerRun; i++) {
        state.blockers.push({
          id: `blocker-${i}`,
          timestamp: new Date().toISOString(),
          sessionId: TEST_SESSION_ID,
          category: 'other',
          question: `Question ${i}`,
          context: '',
          blocksProgress: true
        })
      }
      
      // Track initial call count
      const initialCallCount = appendBlockerSpy.mock.calls.length
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-max'
      }
      const output = { args: {} }
      
      // Should still block but not log
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow()
      
      // Should not log blocker (no new calls)
      expect(appendBlockerSpy.mock.calls.length).toBe(initialCallCount)
    })
    
    it('should queue failed writes to pendingWrites (FR-024)', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      // Mock appendBlocker to fail
      appendBlockerSpy.mockResolvedValue(false)
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-question-fail'
      }
      const output = { args: {} }
      
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow()
      
      // Check pendingWrites queue
      const updatedState = getState(TEST_SESSION_ID)
      expect(updatedState.pendingWrites).toHaveLength(1)
      expect(updatedState.pendingWrites[0].category).toBe('question')
    })
  })
  
  describe('Error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      const state = getState(TEST_SESSION_ID)
      state.divertBlockers = true
      
      // Mock appendBlocker to throw
      appendBlockerSpy.mockRejectedValue(new Error('File system error'))
      
      const input = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: 'call-error'
      }
      const output = { args: {} }
      
      // Should still throw blocking error
      await expect(
        handleToolExecuteBefore(input, output, mockClient, mockConfig, TEST_PROJECT_DIR)
      ).rejects.toThrow(/Autonomous mode is active/)
    })
  })
})
