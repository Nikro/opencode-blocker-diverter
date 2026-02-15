import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Event Handlers', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-events'

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
    it('should initialize state on session.created and apply config default', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })

      const state = getState(testSessionId)
      expect(state).toBeDefined()
      expect(state.enabled).toBe(true)
      // State should have a defined value (whatever config returned)
      expect(typeof state.divertBlockers).toBe('boolean')
      expect(state.blockers).toEqual([])
      expect(state.lastAssistantAborted).toBe(false)
    })

    it('should log session creation', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle missing session_id gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      // Should not throw
      await expect(
        hooks.event({ event: { type: 'session.created', properties: {} } })
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
        hooks.event({ event: { type: 'session.created', properties: { info: { id: testSessionId } } } })
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
      await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: testSessionId } } } })

      // State should be cleaned up - check it no longer exists in the map
      const { hasState } = await import('../../src/state')
      expect(hasState(testSessionId)).toBe(false)
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

      await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: testSessionId } } } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle deleting non-existent session gracefully', async () => {
      const hooks = createSessionHooks(mockContext)

      // Should not throw when deleting non-existent session
      await expect(
        hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 'non-existent' } } } })
      ).resolves.toBeUndefined()
    })

    it('should handle missing session_id in delete event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.deleted', properties: {} } })
      ).resolves.toBeUndefined()

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })
  })

  describe('session.idle event', () => {
    it('should log idle event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should not throw on idle even if state missing', async () => {
      const hooks = createSessionHooks(mockContext)

      // Don't initialize state, just trigger idle
      await expect(
        hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'unknown-session' } } })
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

      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

      // Should not throw
      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle missing session_id in idle event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.idle', properties: {} } })
      ).resolves.toBeUndefined()
    })
  })

  describe('session.compacted event', () => {
    it('should log compaction event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({ event: { type: 'session.compacted', properties: { sessionID: testSessionId } } })

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

      await hooks.event({ event: { type: 'session.compacted', properties: { sessionID: testSessionId } } })

      expect(state.blockers.length).toBe(blockerCountBefore)
    })

    it('should handle missing session_id in compaction event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.compacted', properties: {} } })
      ).resolves.toBeUndefined()
    })
  })

  describe('session.error event', () => {
    it('should log error event', async () => {
      const hooks = createSessionHooks(mockContext)

      await hooks.event({
        event: {
          type: 'session.error',
          properties: { 
            sessionID: 'error-session',
            error: 'Test error message'
          }
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
          properties: { 
            sessionID: 'error-session',
            error: 'Test error'
          }
        }
      })

      // State should still exist
      const stillThere = getState('error-session')
      expect(stillThere.blockers.length).toBe(1)
    })

    it('should handle missing session_id in error event', async () => {
      const hooks = createSessionHooks(mockContext)

      await expect(
        hooks.event({ event: { type: 'session.error', properties: { error: 'Some error' } } })
      ).resolves.toBeUndefined()
    })
  })

  describe('message.updated event (cancellation flow)', () => {
    it('should set lastAssistantAborted to true when MessageAbortedError occurs on assistant message', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state with lastAssistantAborted = false
      const state = getState(testSessionId)
      state.lastAssistantAborted = false

      // Trigger message.updated with MessageAbortedError
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-123',
              role: 'assistant',
              sessionID: testSessionId,
              error: { name: 'MessageAbortedError' }
            }
          }
        }
      })

      // Verify flag was set
      const updatedState = getState(testSessionId)
      expect(updatedState.lastAssistantAborted).toBe(true)
    })

    it('should set lastAssistantAborted to false when assistant message finishes normally', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state with lastAssistantAborted = true
      const state = getState(testSessionId)
      state.lastAssistantAborted = true

      // Trigger message.updated with finish set (normal completion)
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-124',
              role: 'assistant',
              sessionID: testSessionId,
              finish: 'stop'
            }
          }
        }
      })

      // Verify flag was cleared
      const updatedState = getState(testSessionId)
      expect(updatedState.lastAssistantAborted).toBe(false)
    })

    it('should not change lastAssistantAborted for user messages', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state with lastAssistantAborted = true
      const state = getState(testSessionId)
      state.lastAssistantAborted = true

      // Trigger message.updated with user role
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-125',
              role: 'user',
              sessionID: testSessionId,
              error: { name: 'MessageAbortedError' }
            }
          }
        }
      })

      // Verify flag unchanged
      const updatedState = getState(testSessionId)
      expect(updatedState.lastAssistantAborted).toBe(true)
    })

    it('should disable divertBlockers when session.idle fires after abort', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state with divertBlockers enabled and abort flag set
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.lastAssistantAborted = true
      state.repromptCount = 2

      // Trigger session.idle (should detect abort and disable)
      await hooks.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: testSessionId }
        }
      })

      // Verify auto-disabled
      const updatedState = getState(testSessionId)
      expect(updatedState.divertBlockers).toBe(false)
      expect(updatedState.lastAssistantAborted).toBe(false) // Flag should be reset
      expect(updatedState.repromptCount).toBe(0) // Counter should be reset
    })

    it('should clear abort flag when MessageAbortedError followed by normal finish', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state
      const state = getState(testSessionId)
      state.lastAssistantAborted = false

      // First: trigger abort
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-126',
              role: 'assistant',
              sessionID: testSessionId,
              error: { name: 'MessageAbortedError' }
            }
          }
        }
      })

      expect(getState(testSessionId).lastAssistantAborted).toBe(true)

      // Second: trigger normal finish
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-127',
              role: 'assistant',
              sessionID: testSessionId,
              finish: 'stop'
            }
          }
        }
      })

      // Verify flag was cleared
      expect(getState(testSessionId).lastAssistantAborted).toBe(false)
    })

    it('should clear abort flag when MessageAbortedError followed by streaming update (no finish)', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state
      const state = getState(testSessionId)
      state.lastAssistantAborted = false

      // First: trigger abort
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-abort',
              role: 'assistant',
              sessionID: testSessionId,
              error: { name: 'MessageAbortedError' }
            }
          }
        }
      })

      expect(getState(testSessionId).lastAssistantAborted).toBe(true)

      // Second: NEW assistant message starts streaming (no error, no finish yet)
      // This represents a new message being generated after abort
      await hooks.event({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-new',
              role: 'assistant',
              sessionID: testSessionId,
              // No error, no finish - just a streaming update
            }
          }
        }
      })

      // Verify flag was cleared (bug fix: previously would stay true!)
      expect(getState(testSessionId).lastAssistantAborted).toBe(false)
    })
  })

  describe('chat.message hook (auto-disable on user input)', () => {
    it('should auto-disable blockers when user sends message during autonomous mode', async () => {
      const hooks = createSessionHooks(mockContext)

      // Enable blockers
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.repromptCount = 3

      // User sends a message
      await hooks['chat.message'](
        { sessionID: testSessionId },
        { 
          message: { role: 'user' },
          parts: [{ type: 'text', text: 'Hi there!' }]
        }
      )

      // Verify blockers disabled
      const updatedState = getState(testSessionId)
      expect(updatedState.divertBlockers).toBe(false)
      expect(updatedState.repromptCount).toBe(0)
      expect(updatedState.lastRepromptTime).toBe(0)
    })

    it('should log when auto-disabling on user input', async () => {
      const hooks = createSessionHooks(mockContext)

      // Enable blockers
      const state = getState(testSessionId)
      state.divertBlockers = true

      // User sends a message
      await hooks['chat.message'](
        { sessionID: testSessionId },
        { 
          message: { role: 'user' },
          parts: [{ type: 'text', text: 'Ok now: HI :D' }]
        }
      )

      // Verify log was called (would have been called during auto-disable)
      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should NOT auto-disable if blockers already disabled', async () => {
      const hooks = createSessionHooks(mockContext)

      // Blockers already disabled
      const state = getState(testSessionId)
      state.divertBlockers = false

      // User sends a message
      await hooks['chat.message'](
        { sessionID: testSessionId },
        { 
          message: { role: 'user' },
          parts: [{ type: 'text', text: 'Hi' }]
        }
      )

      // Verify state unchanged
      const updatedState = getState(testSessionId)
      expect(updatedState.divertBlockers).toBe(false)
    })

    it('should still capture assistant messages for completion marker detection', async () => {
      const hooks = createSessionHooks(mockContext)

      // Initialize state
      getState(testSessionId)

      // AI sends a message
      await hooks['chat.message'](
        { sessionID: testSessionId },
        { 
          message: { role: 'assistant' },
          parts: [{ type: 'text', text: 'Here is my response. BLOCKER_DIVERTER_DONE!' }]
        }
      )

      // Verify message content captured
      const state = getState(testSessionId)
      expect(state.lastMessageContent).toContain('BLOCKER_DIVERTER_DONE!')
    })
  })
})
