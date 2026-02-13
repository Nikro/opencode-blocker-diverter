/**
 * E2E Tests: Continue Prompt Flow
 * 
 * Tests automatic continuation injection when blockers exist:
 * - Continue prompt injection on idle
 * - Max reprompts enforcement
 * - Reprompt window reset
 * - Respecting divertBlockers toggle
 * 
 * @module tests/integration/e2e-continue-flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPlugin } from '../../src/core/plugin'
import { getState, cleanupState } from '../../src/state'
import {
  createMockContext,
  setupSpies,
  TEST_SESSION_ID,
  createPermission,
  type MockPluginContext,
  type TestSpies,
} from './fixtures'

describe('E2E: Continue Prompt Flow', () => {
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

  it('should inject continue prompt on idle when blockers exist', async () => {
    // Session created
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Add blocker
    const permissionInput = createPermission({
      id: 'perm-continue',
      messageID: 'msg-continue',
      callID: 'call-continue',
      title: 'Test',
      metadata: { tool: 'bash', args: { command: 'test' } },
    })

    await pluginHooks['permission.asked'](permissionInput, { status: 'ask' })

    // Clear prompt mock to isolate idle behavior
    mockContext.client.session.prompt.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', session_id: TEST_SESSION_ID },
    })

    // Verify continue prompt injected
    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    // Verify reprompt count incremented
    const state = getState(TEST_SESSION_ID)
    expect(state.repromptCount).toBe(1)
    expect(state.lastRepromptTime).toBeGreaterThan(0)
  })

  it('should respect maxReprompts safety limit', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Add blocker
    const state = getState(TEST_SESSION_ID)
    state.blockers.push({
      id: 'test-blocker',
      timestamp: new Date().toISOString(),
      sessionId: TEST_SESSION_ID,
      category: 'permission',
      question: 'Test',
      context: 'test',
      blocksProgress: true,
    })

    // Set reprompt count to max and recent timestamp (within window)
    state.repromptCount = 5
    state.lastRepromptTime = Date.now()

    // Clear prompt mock
    mockContext.client.session.prompt.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', session_id: TEST_SESSION_ID },
    })

    // Should NOT inject prompt (at max limit)
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })

  it('should reset reprompt count after window expires', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    const state = getState(TEST_SESSION_ID)
    state.blockers.push({
      id: 'test-blocker',
      timestamp: new Date().toISOString(),
      sessionId: TEST_SESSION_ID,
      category: 'permission',
      question: 'Test',
      context: 'test',
      blocksProgress: true,
    })

    // Set reprompt count and old timestamp
    state.repromptCount = 3
    state.lastRepromptTime = Date.now() - 200000 // 200 seconds ago (outside 120s window)

    // Clear prompt mock
    mockContext.client.session.prompt.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', session_id: TEST_SESSION_ID },
    })

    // Should reset count and inject prompt
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
    
    const stateAfter = getState(TEST_SESSION_ID)
    expect(stateAfter.repromptCount).toBe(1) // Reset and incremented
  })

  it('should not inject continue prompt when divertBlockers is disabled', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    const state = getState(TEST_SESSION_ID)
    state.blockers.push({
      id: 'test-blocker',
      timestamp: new Date().toISOString(),
      sessionId: TEST_SESSION_ID,
      category: 'permission',
      question: 'Test',
      context: 'test',
      blocksProgress: true,
    })

    // Disable diversion
    state.divertBlockers = false

    mockContext.client.session.prompt.mockClear()

    await pluginHooks.event({
      event: { type: 'session.idle', session_id: TEST_SESSION_ID },
    })

    // Should NOT inject prompt
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })
})
