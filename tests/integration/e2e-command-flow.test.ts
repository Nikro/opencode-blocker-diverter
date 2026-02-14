/**
 * E2E Tests: Command Flow
 * 
 * Tests /blockers command execution:
 * - /blockers on/off toggling
 * - /blockers status reporting
 * - /blockers list display
 * - Help display
 * 
 * @module tests/integration/e2e-command-flow
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

describe('E2E: Command Flow', () => {
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

  it('should handle /blockers on command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Disable first
    const state = getState(TEST_SESSION_ID)
    state.divertBlockers = false

    // Execute command
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.on',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      { parts: [] }
    )

    // Verify enabled
    const stateAfter = getState(TEST_SESSION_ID)
    expect(stateAfter.divertBlockers).toBe(true)
    expect(mockContext.client.app.log).toHaveBeenCalled()
  })

  it('should handle /blockers.off command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Execute command
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.off',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      { parts: [] }
    )

    // Verify disabled
    const state = getState(TEST_SESSION_ID)
    expect(state.divertBlockers).toBe(false)
  })

  it('should handle /blockers.status command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
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

    // Execute command
    const output = { parts: [] as any[] }
    
    // Clear previous logs to isolate status command logs
    mockContext.client.app.log.mockClear()
    
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.status',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      output
    )

    // Verify log called with status info
    expect(mockContext.client.app.log).toHaveBeenCalled()
    // Find the status log call (skip the debug log)
    const statusLogCall = mockContext.client.app.log.mock.calls.find(
      (call: any) => call[0]?.message?.includes('Status')
    )
    expect(statusLogCall).toBeDefined()
    expect(statusLogCall[0].message).toContain('Status')
    expect(statusLogCall[0].message).toContain('1/50') // 1 blocker out of 50 max
  })

  it('should handle /blockers.list command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Add blockers
    const state = getState(TEST_SESSION_ID)
    state.blockers.push(
      {
        id: 'blocker-1',
        timestamp: new Date().toISOString(),
        sessionId: TEST_SESSION_ID,
        category: 'permission',
        question: 'Permission question 1',
        context: 'test',
        blocksProgress: true,
      },
      {
        id: 'blocker-2',
        timestamp: new Date().toISOString(),
        sessionId: TEST_SESSION_ID,
        category: 'architecture',
        question: 'Architecture question 2',
        context: 'test',
        blocksProgress: true,
      }
    )

    mockContext.client.app.log.mockClear()

    // Execute command (note: /blockers.list is NOT intercepted by hook, so no logging happens)
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.list',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      { parts: [] }
    )

    // Hook should fire but not log list details (AI template handles it)
    const debugLogCalls = mockContext.client.app.log.mock.calls.filter((call: any[]) =>
      call[0]?.message?.includes('hook fired')
    )
    expect(debugLogCalls.length).toBeGreaterThan(0)
  })
})
