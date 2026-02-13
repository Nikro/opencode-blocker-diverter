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
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Disable first
    const state = getState(TEST_SESSION_ID)
    state.divertBlockers = false

    // Execute command
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['on'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    // Verify enabled
    const stateAfter = getState(TEST_SESSION_ID)
    expect(stateAfter.divertBlockers).toBe(true)
    expect(mockContext.client.app.log).toHaveBeenCalled()
  })

  it('should handle /blockers off command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Execute command
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['off'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    // Verify disabled
    const state = getState(TEST_SESSION_ID)
    expect(state.divertBlockers).toBe(false)
  })

  it('should handle /blockers status command', async () => {
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

    mockContext.client.app.log.mockClear()

    // Execute command
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['status'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    // Verify log called with status info
    expect(mockContext.client.app.log).toHaveBeenCalled()
    const logCall = mockContext.client.app.log.mock.calls[0][0]
    expect(logCall.message).toContain('Status')
    expect(logCall.message).toContain('1/50') // 1 blocker out of 50 max
  })

  it('should handle /blockers list command', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
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

    // Execute command
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['list'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    // Verify log called with list
    expect(mockContext.client.app.log).toHaveBeenCalled()
    const logCall = mockContext.client.app.log.mock.calls[0][0]
    expect(logCall.message).toContain('Permission question 1')
    expect(logCall.message).toContain('Architecture question 2')
    expect(logCall.message).toContain('[permission]')
    expect(logCall.message).toContain('[architecture]')
  })

  it('should show help when no subcommand provided', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    mockContext.client.app.log.mockClear()

    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: [],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    // Verify help displayed
    expect(mockContext.client.app.log).toHaveBeenCalled()
    const logCall = mockContext.client.app.log.mock.calls[0][0]
    expect(logCall.message).toContain('Commands')
    expect(logCall.message).toContain('on')
    expect(logCall.message).toContain('off')
  })
})
