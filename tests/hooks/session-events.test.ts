import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Event Handlers', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-123'

  beforeEach(() => {
    // Clean up any existing state
    cleanupState(testSessionId)

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
    cleanupState('session-2')
    cleanupState('error-session')
  })

  describe('session.created event', () => {
    it('should initialize state on session.created', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.created', session_id: testSessionId } })

      const state = getState(testSessionId)
      expect(state).toBeDefined()
      expect(state.enabled).toBe(true)
      expect(state.divertBlockers).toBe(true)
      expect(state.blockers).toEqual([])
    })

    it('should log session creation', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.created', session_id: testSessionId } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle missing session_id gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      // Should not throw
      await expect(
        hooks.event({ event: { type: 'session.created' } })
      ).resolves.toBeUndefined()

      // Should log warning
      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should not throw if logging fails', async () => {
      const brokenContext = {
        ...mockContext,
        client: {
          ...mockContext.client,
          app: { log: mock(() => Promise.reject(new Error('Log failed'))) }
        }
      } as any

      const hooks = createSessionHooks(brokenContext)

      // Should not throw even if logging fails
      await expect(
        hooks.event({ event: { type: 'session.created', session_id: testSessionId } })
      ).resolves.toBeUndefined()
    })
  })

  describe('session.deleted event', () => {
    it('should cleanup state on session.deleted', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state first
      const state = getState(testSessionId)
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'permission',
        question: 'Test question?',
        context: 'Test context',
        blocksProgress: true
      })

      // Delete session
      await hooks.event({ event: { type: 'session.deleted', session_id: testSessionId } })

      // State should be cleaned up (getState will create new empty state)
      const newState = getState(testSessionId)
      expect(newState.blockers).toEqual([])
    })

    it('should log session summary with blocker count', async () => {
      const hooks = createSessionHooks(mockContext)

      // Add some blockers
      const state = getState(testSessionId)
      state.blockers.push(
        {
          id: 'blocker-1',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'permission',
          question: 'Test question 1?',
          context: 'Test context',
          blocksProgress: true
        },
        {
          id: 'blocker-2',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'architecture',
          question: 'Test question 2?',
          context: 'Test context',
          blocksProgress: false
        }
      )

      await hooks.event({ event: { type: 'session.deleted', session_id: testSessionId } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle deleting non-existent session gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      // Should not throw when deleting non-existent session
      await expect(
        hooks.event({ event: { type: 'session.deleted', session_id: 'non-existent' } })
      ).resolves.toBeUndefined()
    })

    it('should handle missing session_id in delete event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.deleted' } })
      ).resolves.toBeUndefined()

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })
  })

  describe('session.idle event', () => {
    it('should log idle event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should not throw on idle even if state missing', async () => {
      const hooks = createSessionHooks(mockContext)

      // Don't initialize state, just trigger idle
      await expect(
        hooks.event({ event: { type: 'session.idle', session_id: 'unknown-session' } })
      ).resolves.toBeUndefined()
    })

    it('should handle idle with divertBlockers enabled', async () => {
      const hooks = createSessionHooks(mockContext)

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

      await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

      // Should not throw
      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle missing session_id in idle event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.idle' } })
      ).resolves.toBeUndefined()
    })
  })

  describe('session.compacted event', () => {
    it('should log compaction event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.compacted', session_id: testSessionId } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should not modify state on compaction', async () => {
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

      const blockerCountBefore = state.blockers.length

      await hooks.event({ event: { type: 'session.compacted', session_id: testSessionId } })

      expect(state.blockers.length).toBe(blockerCountBefore)
    })

    it('should handle missing session_id in compaction event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.compacted' } })
      ).resolves.toBeUndefined()
    })
  })

  describe('session.error event', () => {
    it('should log error event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({
        event: {
          type: 'session.error',
          session_id: 'error-session',
          error: 'Test error message'
        }
      })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should not cleanup state on error', async () => {
      const hooks = createSessionHooks(mockContext)

      const state = getState('error-session')
      state.blockers.push({
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: 'error-session',
        category: 'permission',
        question: 'Test?',
        context: 'Context',
        blocksProgress: true
      })

      await hooks.event({
        event: {
          type: 'session.error',
          session_id: 'error-session',
          error: 'Test error'
        }
      })

      // State should still exist
      const stillThere = getState('error-session')
      expect(stillThere.blockers.length).toBe(1)
    })

    it('should handle missing session_id in error event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.error', error: 'Some error' } })
      ).resolves.toBeUndefined()
    })
  })
})
