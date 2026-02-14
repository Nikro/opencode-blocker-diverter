import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Error Handling & Edge Cases', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-errors'

  beforeEach(() => {
    // Clean up any existing state
    cleanupState(testSessionId)

    // Initialize fresh state with correct defaults
    const state = getState(testSessionId)
    state.divertBlockers = true

    // Create mock context
    mockContext = {
      client: {
        app: { log: mock(() => Promise.resolve()) },
        session: { promptAsync: mock(() => Promise.resolve()) }
      },
      project: { id: 'test-project', worktree: '/test', name: 'test' },
      $: mock(() => ({})) as any,
      directory: '/test',
      worktree: '/test'
    } as any
  })

  afterEach(() => {
    // Clean up test sessions
    cleanupState(testSessionId)
    cleanupState('session-1')
    cleanupState('session-2')
  })

  describe('error handling', () => {
    it('should catch and log errors without throwing', async () => {
      const errorContext = {
        ...mockContext,
        client: {
          app: { log: mock(() => Promise.resolve()) },
          session: { promptAsync: mock(() => Promise.reject(new Error('Unexpected error'))) }
        }
      } as any

      const hooks = createSessionHooks(errorContext)

      // Should not throw even if internal error occurs
      await expect(
        hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })
      ).resolves.toBeUndefined()
    })

    it('should handle invalid event types gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'unknown.event.type', properties: { sessionID: testSessionId } } })
      ).resolves.toBeUndefined()
    })

    it('should handle malformed event objects', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: null as any })
      ).resolves.toBeUndefined()

      await expect(
        hooks.event({ event: undefined as any })
      ).resolves.toBeUndefined()

      await expect(
        hooks.event({} as any)
      ).resolves.toBeUndefined()
    })

    it('should handle state access errors gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      // Try to trigger with empty session ID
      await expect(
        hooks.event({ event: { type: 'session.deleted', properties: { info: { id: '' } } } })
      ).resolves.toBeUndefined()
    })

    it('should handle events with non-string types', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 123 as any, properties: { sessionID: testSessionId } } })
      ).resolves.toBeUndefined()
    })

    it('should handle events with invalid session_id types', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.created', properties: { info: { id: null as any } } } })
      ).resolves.toBeUndefined()

      await expect(
        hooks.event({ event: { type: 'session.created', properties: { info: { id: 123 as any } } } })
      ).resolves.toBeUndefined()
    })

    it('should log errors in compaction hook without throwing', async () => {
      const hooks = createSessionHooks(mockContext)

      const invalidOutput = null as any

      await expect(
        hooks['experimental.session.compacting'](
          { sessionID: testSessionId },
          invalidOutput
        )
      ).resolves.toBeUndefined()
    })

    it('should handle compaction with undefined output.context', async () => {
      const hooks = createSessionHooks(mockContext)

      const state = getState(testSessionId)
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      const output = { context: undefined as any }

      await expect(
        hooks['experimental.session.compacting'](
          { sessionID: testSessionId },
          output
        )
      ).resolves.toBeUndefined()
    })
  })

  describe('integration tests', () => {
    it('should maintain state across multiple events in same session', async () => {
      const hooks = createSessionHooks(mockContext)

      // Create session
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })

      // Add blocker
      const state = getState(testSessionId)
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      // Trigger idle
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

      // State should still have blocker
      expect(state.blockers.length).toBe(1)

      // Trigger compaction
      await hooks.event({ event: { type: 'session.compacted', properties: { sessionID: testSessionId } } })

      // State should still have blocker
      expect(state.blockers.length).toBe(1)

      // Delete session
      await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: testSessionId } } } })

      // New state should be clean
      const newState = getState(testSessionId)
      expect(newState.blockers.length).toBe(0)
    })

    it('should isolate state between different sessions', async () => {
      const hooks = createSessionHooks(mockContext)
      const session1 = 'session-1'
      const session2 = 'session-2'

      // Create both sessions
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: session1 } } } })
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: session2 } } } })

      // Add blocker to session1
      const state1 = getState(session1)
      state1.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: session1,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      // Session2 should have no blockers
      const state2 = getState(session2)
      expect(state2.blockers.length).toBe(0)

      // Delete session1
      await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: session1 } } } })

      // Session2 should still exist and be unaffected
      expect(state2.blockers.length).toBe(0)

      // Cleanup
      cleanupState(session1)
      cleanupState(session2)
    })

    it('should handle rapid sequential events without errors', async () => {
      const hooks = createSessionHooks(mockContext)

      // Fire multiple events in rapid succession
      const promises = [
        hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } }),
        hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } }),
        hooks.event({ event: { type: 'session.compacted', properties: { sessionID: testSessionId } } }),
        hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } }),
        hooks.event({ event: { type: 'session.deleted', properties: { info: { id: testSessionId } } } })
      ]

      await expect(Promise.all(promises)).resolves.toBeDefined()
    })

    it('should handle compaction followed by more events', async () => {
      const hooks = createSessionHooks(mockContext)

      // Create session and add blocker
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })
      
      const state = getState(testSessionId)
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      // Compact
      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      // Should preserve blocker in output
      expect(output.context.length).toBeGreaterThan(0)

      // Add more blockers after compaction
      state.blockers.push({
        id: 'blocker-2',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'architecture',
        question: 'Another test?',
        context: 'More context',
        blocksProgress: false
      })

      // Should have both blockers
      expect(state.blockers.length).toBe(2)

      // Delete session
      await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: testSessionId } } } })
    })
  })

  describe('recovery guard and abort handling', () => {
    it('should reset reprompt state when MessageAbortedError occurs', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup state with repromptCount and lastRepromptTime
      const state = getState(testSessionId)
      state.repromptCount = 3
      state.lastRepromptTime = Date.now() - 30000 // 30 seconds ago

      // Fire session.error with MessageAbortedError
      await hooks.event({
        event: {
          type: 'session.error',
          properties: {
            sessionID: testSessionId,
            error: { name: 'MessageAbortedError' }
          }
        }
      })

      // Assert repromptCount and lastRepromptTime reset to 0
      const updatedState = getState(testSessionId)
      expect(updatedState.repromptCount).toBe(0)
      expect(updatedState.lastRepromptTime).toBe(0)
    })

    it('should set isRecovering flag on session.error', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup clean state
      const state = getState(testSessionId)
      expect(state.isRecovering).toBe(false)

      // Fire session.error with generic error
      await hooks.event({
        event: {
          type: 'session.error',
          properties: {
            sessionID: testSessionId,
            error: { name: 'GenericError' }
          }
        }
      })

      // Assert isRecovering set to true
      const updatedState = getState(testSessionId)
      expect(updatedState.isRecovering).toBe(true)
    })

    it('should skip idle reprompt when isRecovering is true', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup state with blockers and isRecovering=true
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })
      state.isRecovering = true
      state.repromptCount = 0

      // Fire session.idle
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

      // Assert client.session.promptAsync NOT called (skipped due to recovery)
      expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()

      // Assert isRecovering cleared after skipping
      const updatedState = getState(testSessionId)
      expect(updatedState.isRecovering).toBe(false)
    })

    it('should clear isRecovering flag after recovery idle', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup state with isRecovering=true
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.isRecovering = true

      // Fire session.idle
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

      // Assert isRecovering cleared
      const updatedState = getState(testSessionId)
      expect(updatedState.isRecovering).toBe(false)
    })

    it('should resume normal operation after recovery cycle', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup state with blockers
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      // Simulate error
      await hooks.event({
        event: {
          type: 'session.error',
          properties: {
            sessionID: testSessionId,
            error: { name: 'GenericError' }
          }
        }
      })

      // First idle after error (recovery skip)
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })
      expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()

      // Second idle after recovery (should inject normally)
      state.repromptCount = 0 // Reset for normal injection
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })
      
      // Assert normal operation resumed (prompt injected)
      expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
    })

    it('should handle error with MessageAbortedError setting both abort and recovery state', async () => {
      const hooks = createSessionHooks(mockContext)

      // Setup state with repromptCount
      const state = getState(testSessionId)
      state.repromptCount = 5
      state.lastRepromptTime = Date.now()

      // Fire session.error with MessageAbortedError
      await hooks.event({
        event: {
          type: 'session.error',
          properties: {
            sessionID: testSessionId,
            error: { name: 'MessageAbortedError' }
          }
        }
      })

      // Assert both reprompt reset AND isRecovering set
      const updatedState = getState(testSessionId)
      expect(updatedState.repromptCount).toBe(0)
      expect(updatedState.lastRepromptTime).toBe(0)
      expect(updatedState.isRecovering).toBe(true)
    })
  })
})
