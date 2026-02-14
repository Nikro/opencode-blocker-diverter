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
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Add blocker via tool.execute.before with question tool
    const toolInput = {
      tool: 'question',
      sessionID: TEST_SESSION_ID,
      callID: 'call-continue',
    }
    const toolOutput = { args: {} }

    // Tool interception throws - expected behavior
    try {
      await pluginHooks['tool.execute.before']!(toolInput, toolOutput)
    } catch (error) {
      // Expected - tool is blocked in autonomous mode
    }

    // Clear prompt mock to isolate idle behavior
    mockContext.client.session.promptAsync.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    // Verify continue prompt injected
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()

    // Verify reprompt count incremented
    const state = getState(TEST_SESSION_ID)
    expect(state.repromptCount).toBe(1)
    expect(state.lastRepromptTime).toBeGreaterThan(0)
  })

  it('should respect maxReprompts safety limit', async () => {
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

    // Set reprompt count to max and recent timestamp (within window)
    state.repromptCount = 5
    state.lastRepromptTime = Date.now()

    // Clear prompt mock
    mockContext.client.session.promptAsync.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    // Should NOT inject prompt (at max limit)
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should reset reprompt count after window expires', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

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

    // Set reprompt count and old timestamp
    state.repromptCount = 3
    state.lastRepromptTime = Date.now() - 400000 // 400 seconds ago (outside 300s / 5-minute window)

    // Clear prompt mock
    mockContext.client.session.promptAsync.mockClear()

    // Trigger idle
    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    // Should reset count and inject prompt
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
    
    const stateAfter = getState(TEST_SESSION_ID)
    expect(stateAfter.repromptCount).toBe(1) // Reset and incremented
  })

  it('should not inject continue prompt when divertBlockers is disabled', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

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

    // Disable diversion
    state.divertBlockers = false

    mockContext.client.session.promptAsync.mockClear()

    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    // Should NOT inject prompt
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })
})