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
        session: { prompt: mock(() => Promise.resolve()) }
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
          session: { prompt: mock(() => Promise.reject(new Error('Unexpected error'))) }
        }
      } as any

      const hooks = createSessionHooks(errorContext)

      // Should not throw even if internal error occurs
      await expect(
        hooks.event({ event: { type: 'session.created', session_id: testSessionId } })
      ).resolves.toBeUndefined()
    })

    it('should handle invalid event types gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'unknown.event.type', session_id: testSessionId } })
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
        hooks.event({ event: { type: 'session.deleted', session_id: '' } })
      ).resolves.toBeUndefined()
    })

    it('should handle events with non-string types', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 123 as any, session_id: testSessionId } })
      ).resolves.toBeUndefined()
    })

    it('should handle events with invalid session_id types', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.created', session_id: null as any } })
      ).resolves.toBeUndefined()

      await expect(
        hooks.event({ event: { type: 'session.created', session_id: 123 as any } })
      ).resolves.toBeUndefined()
    })

    it('should log errors in compaction hook without throwing', async () => {
      const hooks = createSessionHooks(mockContext)

      const invalidOutput = null as any

      await expect(
        hooks['experimental.session.compacting'](
          { session_id: testSessionId },
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
          { session_id: testSessionId },
          output
        )
      ).resolves.toBeUndefined()
    })
  })

  describe('integration tests', () => {
    it('should maintain state across multiple events in same session', async () => {
      const hooks = createSessionHooks(mockContext)

      // Create session
      await hooks.event({ event: { type: 'session.created', session_id: testSessionId } })

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
      await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

      // State should still have blocker
      expect(state.blockers.length).toBe(1)

      // Trigger compaction
      await hooks.event({ event: { type: 'session.compacted', session_id: testSessionId } })

      // State should still have blocker
      expect(state.blockers.length).toBe(1)

      // Delete session
      await hooks.event({ event: { type: 'session.deleted', session_id: testSessionId } })

      // New state should be clean
      const newState = getState(testSessionId)
      expect(newState.blockers.length).toBe(0)
    })

    it('should isolate state between different sessions', async () => {
      const hooks = createSessionHooks(mockContext)
      const session1 = 'session-1'
      const session2 = 'session-2'

      // Create both sessions
      await hooks.event({ event: { type: 'session.created', session_id: session1 } })
      await hooks.event({ event: { type: 'session.created', session_id: session2 } })

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
      await hooks.event({ event: { type: 'session.deleted', session_id: session1 } })

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
        hooks.event({ event: { type: 'session.created', session_id: testSessionId } }),
        hooks.event({ event: { type: 'session.idle', session_id: testSessionId } }),
        hooks.event({ event: { type: 'session.compacted', session_id: testSessionId } }),
        hooks.event({ event: { type: 'session.idle', session_id: testSessionId } }),
        hooks.event({ event: { type: 'session.deleted', session_id: testSessionId } })
      ]

      await expect(Promise.all(promises)).resolves.toBeDefined()
    })

    it('should handle compaction followed by more events', async () => {
      const hooks = createSessionHooks(mockContext)

      // Create session and add blocker
      await hooks.event({ event: { type: 'session.created', session_id: testSessionId } })
      
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
        { session_id: testSessionId },
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
      await hooks.event({ event: { type: 'session.deleted', session_id: testSessionId } })
    })
  })
})
