/**
 * E2E Tests: Session Lifecycle
 * 
 * Tests session state management across complete lifecycle:
 * - Session creation and initialization
 * - State persistence through idle/compaction
 * - Session deletion and cleanup
 * - Session isolation (no state leaks)
 * 
 * @module tests/integration/e2e-session-lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPlugin } from '../../src/core/plugin'
import { getState, cleanupState } from '../../src/state'
import {
  createMockContext,
  setupSpies,
  TEST_SESSION_ID,
  type MockPluginContext,
  type TestSpies,
} from './fixtures'

describe('E2E: Session Lifecycle', () => {
  let mockContext: MockPluginContext
  let pluginHooks: Awaited<ReturnType<typeof createPlugin>>
  let spies: TestSpies

  beforeEach(async () => {
    cleanupState(TEST_SESSION_ID)
    
    spies = setupSpies()
    mockContext = createMockContext()
    pluginHooks = await createPlugin(mockContext)
  })

  afterEach(() => {
    cleanupState(TEST_SESSION_ID)
  })

  it('should manage state across complete session lifecycle', async () => {
    // Step 1: Session created
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    const stateAfterCreate = getState(TEST_SESSION_ID)
    expect(stateAfterCreate).toBeDefined()
    expect(stateAfterCreate.blockers.length).toBe(0)

    // Step 2: Add blocker via tool.execute.before with question tool
    const toolInput = {
      tool: 'question',
      sessionID: TEST_SESSION_ID,
      callID: 'call-lifecycle',
    }
    const toolOutput = { args: {} }

    // Tool interception throws - expected behavior
    try {
      await pluginHooks['tool.execute.before']!(toolInput, toolOutput)
    } catch (error) {
      // Expected - tool is blocked in autonomous mode
    }

    const stateAfterBlocker = getState(TEST_SESSION_ID)
    expect(stateAfterBlocker.blockers.length).toBe(1)

    // Step 3: Session idle
    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    // State should persist
    const stateAfterIdle = getState(TEST_SESSION_ID)
    expect(stateAfterIdle.blockers.length).toBe(1)

    // Step 4: Session compacted
    await pluginHooks.event({
      event: { type: 'session.compacted', properties: { sessionID: TEST_SESSION_ID } },
    })

    // State should still persist
    const stateAfterCompaction = getState(TEST_SESSION_ID)
    expect(stateAfterCompaction.blockers.length).toBe(1)

    // Step 5: Session deleted
    await pluginHooks.event({
      event: { type: 'session.deleted', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Verify cleanup: getting state should create new empty state
    const stateAfterDelete = getState(TEST_SESSION_ID)
    expect(stateAfterDelete.blockers.length).toBe(0)
    expect(stateAfterDelete.repromptCount).toBe(0)
  })

  it('should not leak state across different sessions', async () => {
    const session1 = 'session-1'
    const session2 = 'session-2'

    // Create session 1 and add blocker
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: session1 } } },
    })

    // Add blocker directly to session 1 state
    const state1 = getState(session1)
    state1.blockers.push({
      id: 'test-blocker-s1',
      timestamp: new Date().toISOString(),
      sessionId: session1,
      category: 'question',
      question: 'Session 1 blocker',
      context: 'test1',
      blocksProgress: true,
    })

    // Create session 2
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: session2 } } },
    })

    // Verify isolation
    const state1Check = getState(session1)
    const state2 = getState(session2)

    expect(state1Check.blockers.length).toBe(1)
    expect(state2.blockers.length).toBe(0)

    // Cleanup
    cleanupState(session1)
    cleanupState(session2)
  })

  it('should handle session.error without cleanup', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Add blocker directly to state
    const state = getState(TEST_SESSION_ID)
    state.blockers.push({
      id: 'test-blocker',
      timestamp: new Date().toISOString(),
      sessionId: TEST_SESSION_ID,
      category: 'question',
      question: 'Test',
      context: 'test',
      blocksProgress: true,
    })

    // Trigger error event
    await pluginHooks.event({
      event: {
        type: 'session.error',
        properties: {
          sessionID: TEST_SESSION_ID,
          error: new Error('Test error'),
        },
      },
    })

    // State should NOT be cleaned up (session may continue)
    const stateAfterError = getState(TEST_SESSION_ID)
    expect(stateAfterError.blockers.length).toBe(1)
  })
})
