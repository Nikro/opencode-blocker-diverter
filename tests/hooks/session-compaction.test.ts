import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Compaction Hook', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-compaction'

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
  })

  describe('experimental.session.compacting hook', () => {
    it('should preserve blocker state in output.context', async () => {
      const hooks = createSessionHooks(mockContext)

      const state = getState(testSessionId)
      state.blockers.push(
        {
          id: 'blocker-1',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'permission',
          question: 'Test question 1?',
          context: 'Context 1',
          blocksProgress: true
        },
        {
          id: 'blocker-2',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'architecture',
          question: 'Test question 2?',
          context: 'Context 2',
          blocksProgress: false
        }
      )

      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      expect(output.context.length).toBeGreaterThan(0)
      expect(output.context[0]).toContain('active-blockers')
      expect(output.context[0]).toContain('2')
    })

    it('should serialize last 5 blockers if more than 5 exist', async () => {
      const hooks = createSessionHooks(mockContext)

      const state = getState(testSessionId)
      // Add 10 blockers
      for (let i = 0; i < 10; i++) {
        state.blockers.push({
          id: `blocker-${i}`,
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          category: 'permission',
          question: `Question ${i}?`,
          context: `Context ${i}`,
          blocksProgress: i % 2 === 0
        })
      }

      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      expect(output.context.length).toBeGreaterThan(0)
      const contextStr = output.context[0]
      expect(contextStr).toContain('10') // Total count
      // Should contain serialized last 5
      expect(contextStr).toContain('blocker-9')
      expect(contextStr).toContain('blocker-8')
    })

    it('should handle empty blockers array', async () => {
      const hooks = createSessionHooks(mockContext)

      // State exists but no blockers
      getState(testSessionId)

      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      expect(output.context.length).toBeGreaterThan(0)
      expect(output.context[0]).toContain('0')
    })

    it('should handle missing session state', async () => {
      const hooks = createSessionHooks(mockContext)

      const output = { context: [] as string[] }

      // Should not throw for non-existent session
      await expect(
        hooks['experimental.session.compacting'](
          { sessionID: 'non-existent' },
          output
        )
      ).resolves.toBeUndefined()
    })

    it('should handle missing session_id in compacting hook', async () => {
      const hooks = createSessionHooks(mockContext)

      const output = { context: [] as string[] }

      await expect(
        hooks['experimental.session.compacting']({}, output)
      ).resolves.toBeUndefined()
    })

    it('should include blocker details in serialized output', async () => {
      const hooks = createSessionHooks(mockContext)

      const state = getState(testSessionId)
      state.blockers.push({
        id: 'blocker-test-123',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        category: 'architecture',
        question: 'Should I use REST or GraphQL?',
        context: 'API design decision',
        blocksProgress: true
      })

      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      const contextStr = output.context[0]
      expect(contextStr).toContain('blocker-test-123')
      expect(contextStr).toContain('architecture')
      expect(contextStr).toContain('Should I use REST or GraphQL?')
    })

    it('should log debug message on successful compaction', async () => {
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

      const output = { context: [] as string[] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      expect(mockContext.client.app.log).toHaveBeenCalled()
    })

    it('should handle output with existing context entries', async () => {
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

      const output = { context: ['existing-context-1', 'existing-context-2'] }
      await hooks['experimental.session.compacting'](
        { sessionID: testSessionId },
        output
      )

      // Should append to existing context
      expect(output.context.length).toBe(3)
      expect(output.context[0]).toBe('existing-context-1')
      expect(output.context[1]).toBe('existing-context-2')
      expect(output.context[2]).toContain('active-blockers')
    })
  })
})
