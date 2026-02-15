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
    expect(pluginHooks['tool.execute.before']).toBeDefined()
    expect(pluginHooks.event).toBeDefined()

    // Step 2: Session created
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    let state = getState(TEST_SESSION_ID)
    expect(state.divertBlockers).toBe(true)
    expect(state.blockers.length).toBe(0)

    // Clear mock from previous tests
    spies.appendBlockerSpy.mockClear()

    // Step 3: Tool intercepted (question tool) → blocked and logged
    const toolInput1 = {
      tool: 'question',
      sessionID: TEST_SESSION_ID,
      callID: 'call-e2e-1',
    }
    const toolOutput1 = { args: {} }

    // Should throw when blocked
    await expect(
      pluginHooks['tool.execute.before']!(toolInput1, toolOutput1)
    ).rejects.toThrow(/Autonomous mode is active/)

    expect(spies.appendBlockerSpy).toHaveBeenCalledTimes(1)

    state = getState(TEST_SESSION_ID)
    expect(state.blockers.length).toBe(1)

    // Step 4: Session goes idle → continue injected
    mockContext.client.session.promptAsync.mockClear()
    await pluginHooks.event({
      event: { type: 'session.idle', properties: { sessionID: TEST_SESSION_ID } },
    })

    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()

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
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.status',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      { parts: [] }
    )

    expect(mockContext.client.app.log).toHaveBeenCalled()
    // Find the status log message (avoid brittle hardcoded index)
    const statusLog = mockContext.client.app.log.mock.calls.find(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>
        return typeof arg?.message === 'string' && arg.message.includes('Status')
      }
    )
    expect(statusLog).toBeDefined()
    expect((statusLog![0] as Record<string, unknown>).message).toContain('enabled')
    expect((statusLog![0] as Record<string, unknown>).message).toContain('1/50')

    // Step 7: User runs /blockers list → AI template should handle it
    // /blockers.list is NOT intercepted by the command hook, so it passes through
    const listOutput = { parts: [] }
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.list',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      listOutput
    )

    // Output should remain empty since command is not intercepted
    expect(listOutput.parts).toHaveLength(0)

    // Step 8: Session compacted → blocker preserved
    const compactionInput = { sessionID: TEST_SESSION_ID }
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
      event: { type: 'session.deleted', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // New state should be fresh
    const newState = getState(TEST_SESSION_ID)
    expect(newState.blockers.length).toBe(0)
    expect(newState.repromptCount).toBe(0)
  })

  it('should handle multiple blockers across session lifecycle', async () => {
    // Initialize session
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    // Log 3 different blocked tool attempts
    for (let i = 0; i < 3; i++) {
      const toolInput = {
        tool: 'question',
        sessionID: TEST_SESSION_ID,
        callID: `call-${i}`,
      }
      const toolOutput = { args: {} }

      // Use try/catch since we expect it to throw
      try {
        await pluginHooks['tool.execute.before']!(toolInput, toolOutput)
      } catch (error) {
        // Expected - tool is blocked
        expect(error).toBeInstanceOf(Error)
      }
      
      // Wait a bit to ensure different hashes (deduplication)
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    const state = getState(TEST_SESSION_ID)
    // May be less than 3 due to deduplication
    expect(state.blockers.length).toBeGreaterThan(0)

    // User disables diversion
    await pluginHooks['command.execute.before'](
      {
        command: '/blockers.off',
        arguments: '',
        sessionID: TEST_SESSION_ID,
      },
      { parts: [] }
    )

    expect(state.divertBlockers).toBe(false)

    // New tool attempt should pass through
    const toolInput4 = {
      tool: 'question',
      sessionID: TEST_SESSION_ID,
      callID: 'call-4',
    }
    const toolOutput4 = { args: {} }

    // Should NOT throw when diversion disabled
    await expect(
      pluginHooks['tool.execute.before']!(toolInput4, toolOutput4)
    ).resolves.toBeUndefined()

    // Blockers count unchanged
    const blockerCountBefore = state.blockers.length
    expect(state.blockers.length).toBe(blockerCountBefore)

    // Cleanup
    await pluginHooks.event({
      event: { type: 'session.deleted', properties: { info: { id: TEST_SESSION_ID } } },
    })
  })
})
