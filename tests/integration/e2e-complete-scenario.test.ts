/**
 * E2E Tests: Complete User Scenario
 * 
 * Tests realistic end-to-end user sessions combining all hooks:
 * - Complete session from initialization to cleanup
 * - Multiple blockers across lifecycle
 * - All hooks working together
 * 
 * @module tests/integration/e2e-complete-scenario
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPlugin } from '../../src/core/plugin'
import { getState, cleanupState } from '../../src/state'
import type { Permission } from '@opencode-ai/sdk'
import {
  createMockContext,
  setupSpies,
  TEST_SESSION_ID,
  type MockPluginContext,
  type TestSpies,
} from './fixtures'

describe('E2E: Complete User Scenario', () => {
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

  it('should handle realistic user session from start to finish', async () => {
    // Step 1: Plugin initializes with config (already done in beforeEach)
    expect(pluginHooks).toBeDefined()
    expect(pluginHooks['permission.asked']).toBeDefined()
    expect(pluginHooks.event).toBeDefined()

    // Step 2: Session created
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    let state = getState(TEST_SESSION_ID)
    expect(state.divertBlockers).toBe(true)
    expect(state.blockers.length).toBe(0)

    // Clear mock from previous tests
    spies.appendBlockerSpy.mockClear()

    // Step 3: Permission requested → blocked and logged
    const permission1: Permission = {
      id: 'perm-e2e-1',
      type: 'bash',
      sessionID: TEST_SESSION_ID,
      messageID: 'msg-e2e-1',
      callID: 'call-e2e-1',
      title: 'Run tests',
      metadata: { tool: 'bash', args: { command: 'npm test' } },
      time: { created: Date.now() },
    }

    const output1 = { status: 'ask' as 'allow' | 'deny' | 'ask' }
    await pluginHooks['permission.asked'](permission1, output1)

    expect(output1.status).toBe('deny')
    expect(spies.appendBlockerSpy).toHaveBeenCalledTimes(1)

    state = getState(TEST_SESSION_ID)
    expect(state.blockers.length).toBe(1)

    // Step 4: Session goes idle → continue injected
    mockContext.client.session.prompt.mockClear()
    await pluginHooks.event({
      event: { type: 'session.idle', session_id: TEST_SESSION_ID },
    })

    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    state = getState(TEST_SESSION_ID)
    expect(state.repromptCount).toBe(1)

    // Step 5: System prompt includes blocker context
    const systemPromptInput = {
      sessionID: TEST_SESSION_ID,
      model: { id: 'claude-3.5-sonnet' },
    }
    const systemPromptOutput = { system: [] as string[] }

    await pluginHooks['experimental.chat.system.transform'](
      systemPromptInput,
      systemPromptOutput
    )

    expect(systemPromptOutput.system.length).toBeGreaterThan(0)
    expect(systemPromptOutput.system[0]).toContain('blocker')
    expect(systemPromptOutput.system[0]).toContain('1') // 1 blocker

    // Step 6: User runs /blockers status → sees state
    mockContext.client.app.log.mockClear()
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['status'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    expect(mockContext.client.app.log).toHaveBeenCalled()
    const statusLog = mockContext.client.app.log.mock.calls[0][0]
    expect(statusLog.message).toContain('enabled')
    expect(statusLog.message).toContain('1/50')

    // Step 7: User runs /blockers list → sees blocker
    mockContext.client.app.log.mockClear()
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['list'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    expect(mockContext.client.app.log).toHaveBeenCalled()
    const listLog = mockContext.client.app.log.mock.calls[0][0]
    expect(listLog.message).toContain('bash permission')

    // Step 8: Session compacted → blocker preserved
    const compactionInput = { session_id: TEST_SESSION_ID }
    const compactionOutput = { context: [] as string[] }

    await pluginHooks['experimental.session.compacting'](
      compactionInput,
      compactionOutput
    )

    expect(compactionOutput.context.length).toBeGreaterThan(0)
    expect(compactionOutput.context[0]).toContain('active-blockers')

    state = getState(TEST_SESSION_ID)
    expect(state.blockers.length).toBe(1) // Still preserved

    // Step 9: Session deleted → cleanup successful
    await pluginHooks.event({
      event: { type: 'session.deleted', session_id: TEST_SESSION_ID },
    })

    // New state should be fresh
    const newState = getState(TEST_SESSION_ID)
    expect(newState.blockers.length).toBe(0)
    expect(newState.repromptCount).toBe(0)
  })

  it('should handle multiple blockers across session lifecycle', async () => {
    // Initialize session
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Log 3 different blockers
    for (let i = 0; i < 3; i++) {
      const permission: Permission = {
        id: `perm-${i}`,
        type: 'bash',
        sessionID: TEST_SESSION_ID,
        messageID: `msg-${i}`,
        callID: `call-${i}`,
        title: `Command ${i}`,
        metadata: { tool: 'bash', args: { command: `test${i}` } },
        time: { created: Date.now() + i * 1000 }, // Different timestamps
      }

      await pluginHooks['permission.asked'](permission, { status: 'ask' })
    }

    const state = getState(TEST_SESSION_ID)
    expect(state.blockers.length).toBe(3)

    // Verify each blocker has unique ID and context
    const blockerIds = state.blockers.map(b => b.id)
    expect(new Set(blockerIds).size).toBe(3) // All unique

    // User disables diversion
    await pluginHooks['tui.command.execute'](
      {
        command: '/blockers',
        args: ['off'],
        sessionID: TEST_SESSION_ID,
      },
      {}
    )

    expect(state.divertBlockers).toBe(false)

    // New permission should pass through
    const permission4: Permission = {
      id: 'perm-4',
      type: 'bash',
      sessionID: TEST_SESSION_ID,
      messageID: 'msg-4',
      callID: 'call-4',
      title: 'Command 4',
      metadata: { tool: 'bash', args: { command: 'test4' } },
      time: { created: Date.now() },
    }

    const output4 = { status: 'ask' as 'allow' | 'deny' | 'ask' }
    await pluginHooks['permission.asked'](permission4, output4)

    expect(output4.status).toBe('ask') // Not modified
    expect(state.blockers.length).toBe(3) // No new blocker added

    // Cleanup
    await pluginHooks.event({
      event: { type: 'session.deleted', session_id: TEST_SESSION_ID },
    })
  })
})
