import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getState, updateState, cleanupState } from '../src/state'

describe('state.ts - Session State Management', () => {
  const sessionId1 = 'test-session-1'
  const sessionId2 = 'test-session-2'

  beforeEach(() => {
    // Clean up any existing state before each test
    cleanupState(sessionId1)
    cleanupState(sessionId2)
  })

  afterEach(() => {
    // Clean up all test session IDs to prevent cross-test pollution
    cleanupState(sessionId1)
    cleanupState(sessionId2)
    cleanupState('')
    cleanupState('session-with-special-chars-!@#$%^&*()')
    cleanupState('non-existent-session')
  })

  describe('getState', () => {
    it('should create new state with defaults if session does not exist', () => {
      const state = getState(sessionId1)

      expect(state).toBeDefined()
      expect(state.enabled).toBe(true)
      expect(state.divertBlockers).toBe(false) // Changed default
      expect(state.blockers).toEqual([])
      expect(state.cooldownHashes).toBeInstanceOf(Map)
      expect(state.cooldownHashes.size).toBe(0)
      expect(state.lastBlockerTime).toBeTypeOf('number')
      expect(state.lastBlockerTime).toBeGreaterThan(0)
      expect(state.repromptCount).toBe(0)
      expect(state.recentResponseHashes).toEqual([])
      expect(state.lastRepromptTime).toBe(0)
      expect(state.lastAssistantAborted).toBe(false)
    })

    it('should return same state object on subsequent calls for same session', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId1)

      expect(state1).toBe(state2) // Same reference
    })

    it('should create independent state for different sessions', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      expect(state1).not.toBe(state2)
      expect(state1.blockers).not.toBe(state2.blockers)
      expect(state1.cooldownHashes).not.toBe(state2.cooldownHashes)
    })

    it('should ensure cooldownHashes is a new Map for each session', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      state1.cooldownHashes.set('hash1', Date.now() + 30000)

      expect(state1.cooldownHashes.has('hash1')).toBe(true)
      expect(state2.cooldownHashes.has('hash1')).toBe(false)
      expect(state2.cooldownHashes.size).toBe(0)
    })

    it('should ensure blockers array is independent per session', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      state1.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        question: 'Test question?',
        context: 'Test context',
        category: 'permission',
        sessionId: sessionId1,
        blocksProgress: true
      })

      expect(state1.blockers.length).toBe(1)
      expect(state2.blockers.length).toBe(0)
    })

    it('should set lastBlockerTime to current timestamp', () => {
      const beforeTime = Date.now()
      const state = getState(sessionId1)
      const afterTime = Date.now()

      expect(state.lastBlockerTime).toBeGreaterThanOrEqual(beforeTime)
      expect(state.lastBlockerTime).toBeLessThanOrEqual(afterTime)
    })
  })

  describe('updateState', () => {
    it('should mutate existing state using updater function', () => {
      const state = getState(sessionId1)
      const originalState = state

      updateState(sessionId1, (s) => {
        s.enabled = false
        s.repromptCount = 5
      })

      const updatedState = getState(sessionId1)

      expect(updatedState).toBe(originalState) // Same reference
      expect(updatedState.enabled).toBe(false)
      expect(updatedState.repromptCount).toBe(5)
    })

    it('should auto-initialize state if session does not exist before update', () => {
      updateState(sessionId1, (s) => {
        s.divertBlockers = false
      })

      const state = getState(sessionId1)

      expect(state.enabled).toBe(true) // Default value
      expect(state.divertBlockers).toBe(false) // Updated value
    })

    it('should allow complex state mutations', () => {
      updateState(sessionId1, (s) => {
        s.blockers.push({
          id: 'blocker-1',
          timestamp: new Date().toISOString(),
          question: 'Test?',
          context: 'Context',
          category: 'question',
          sessionId: sessionId1,
          blocksProgress: false
        })
        s.cooldownHashes.set('hash123', Date.now() + 30000)
        s.recentResponseHashes.push('response-hash-1')
        s.lastRepromptTime = Date.now()
      })

      const state = getState(sessionId1)

      expect(state.blockers.length).toBe(1)
      expect(state.blockers[0]?.id).toBe('blocker-1')
      expect(state.cooldownHashes.has('hash123')).toBe(true)
      expect(state.recentResponseHashes.length).toBe(1)
      expect(state.lastRepromptTime).toBeGreaterThan(0)
    })

    it('should not affect other sessions when updating one', () => {
      getState(sessionId1)
      getState(sessionId2)

      updateState(sessionId1, (s) => {
        s.repromptCount = 10
      })

      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      expect(state1.repromptCount).toBe(10)
      expect(state2.repromptCount).toBe(0)
    })

    it('should handle multiple updates to the same session', () => {
      updateState(sessionId1, (s) => {
        s.repromptCount = 1
      })

      updateState(sessionId1, (s) => {
        s.repromptCount = s.repromptCount + 1
      })

      updateState(sessionId1, (s) => {
        s.repromptCount = s.repromptCount + 1
      })

      const state = getState(sessionId1)
      expect(state.repromptCount).toBe(3)
    })
  })

  describe('cleanupState', () => {
    it('should remove state from map', () => {
      const state = getState(sessionId1)
      state.repromptCount = 42

      cleanupState(sessionId1)

      // Getting state again should return fresh state
      const newState = getState(sessionId1)
      expect(newState.repromptCount).toBe(0) // Default value
      expect(newState).not.toBe(state) // New object
    })

    it('should be a no-op if session does not exist', () => {
      // Should not throw error
      expect(() => cleanupState('non-existent-session')).not.toThrow()
    })

    it('should not affect other sessions when cleaning up one', () => {
      getState(sessionId1)
      const state2 = getState(sessionId2)
      state2.repromptCount = 5

      cleanupState(sessionId1)

      const retrievedState2 = getState(sessionId2)
      expect(retrievedState2.repromptCount).toBe(5)
      expect(retrievedState2).toBe(state2) // Same reference
    })

    it('should handle multiple cleanups of the same session', () => {
      getState(sessionId1)

      cleanupState(sessionId1)
      cleanupState(sessionId1) // Second cleanup should be no-op

      expect(() => cleanupState(sessionId1)).not.toThrow()
    })
  })

  describe('Memory Isolation', () => {
    it('should ensure complete isolation between sessions', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      // Mutate session 1
      state1.enabled = false
      state1.divertBlockers = false
      state1.blockers.push({
        id: 'b1',
        timestamp: new Date(1000).toISOString(),
        question: 'Q1?',
        context: 'C1',
        category: 'architecture',
        sessionId: sessionId1,
        blocksProgress: true
      })
      state1.cooldownHashes.set('hash-1', Date.now() + 30000)
      state1.recentResponseHashes.push('resp-1')
      state1.repromptCount = 10
      state1.lastBlockerTime = 5000
      state1.lastRepromptTime = 6000

      // Session 2 should remain unchanged
      expect(state2.enabled).toBe(true)
      expect(state2.divertBlockers).toBe(false) // Changed default
      expect(state2.blockers.length).toBe(0)
      expect(state2.cooldownHashes.size).toBe(0)
      expect(state2.recentResponseHashes.length).toBe(0)
      expect(state2.repromptCount).toBe(0)
      expect(state2.lastRepromptTime).toBe(0)
    })

    it('should maintain isolation after cleanup', () => {
      const state1 = getState(sessionId1)
      const state2 = getState(sessionId2)

      state1.repromptCount = 20
      state2.repromptCount = 30

      cleanupState(sessionId1)

      // Session 2 should be unaffected
      expect(getState(sessionId2).repromptCount).toBe(30)

      // Session 1 should be fresh
      expect(getState(sessionId1).repromptCount).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string session ID', () => {
      const state = getState('')
      expect(state).toBeDefined()
      expect(state.enabled).toBe(true)
    })

    it('should handle special characters in session ID', () => {
      const specialId = 'session-with-special-chars-!@#$%^&*()'
      const state = getState(specialId)
      expect(state).toBeDefined()
      cleanupState(specialId)
    })

    it('should maintain state consistency across rapid operations', () => {
      // Rapid get/update/get cycle
      getState(sessionId1)
      updateState(sessionId1, (s) => { s.repromptCount = 1 })
      const state1 = getState(sessionId1)
      updateState(sessionId1, (s) => { s.repromptCount = 2 })
      const state2 = getState(sessionId1)
      updateState(sessionId1, (s) => { s.repromptCount = 3 })
      const state3 = getState(sessionId1)

      expect(state1).toBe(state2)
      expect(state2).toBe(state3)
      expect(state3.repromptCount).toBe(3)
    })
  })
})
