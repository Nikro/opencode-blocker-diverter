/**
 * E2E Tests: System Prompt Transform
 * 
 * Tests system prompt injection for LLM context:
 * - Blocker context injection
 * - Respecting divertBlockers toggle
 * - Completion marker inclusion
 * 
 * @module tests/integration/e2e-system-prompt
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

describe('E2E: System Prompt Transform', () => {
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

  it('should inject blocker context into system prompt', async () => {
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
      question: 'Test question',
      context: 'test context',
      blocksProgress: true,
    })

    const systemPromptInput = {
      sessionID: TEST_SESSION_ID,
      model: { id: 'claude-3.5-sonnet' },
    }

    const systemPromptOutput = {
      system: [] as string[],
    }

    await pluginHooks['experimental.chat.system.transform'](
      systemPromptInput,
      systemPromptOutput
    )

    // Verify system prompt was injected
    expect(systemPromptOutput.system.length).toBeGreaterThan(0)
    
    const injectedPrompt = systemPromptOutput.system[0]
    expect(injectedPrompt).toContain('blocker')
    expect(injectedPrompt).toContain('1') // 1 blocker logged
  })

  it('should not inject when divertBlockers is disabled', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    const state = getState(TEST_SESSION_ID)
    state.divertBlockers = false

    const systemPromptInput = {
      sessionID: TEST_SESSION_ID,
      model: { id: 'claude-3.5-sonnet' },
    }

    const systemPromptOutput = {
      system: [] as string[],
    }

    await pluginHooks['experimental.chat.system.transform'](
      systemPromptInput,
      systemPromptOutput
    )

    // Should not inject
    expect(systemPromptOutput.system.length).toBe(0)
  })

  it('should include completion marker in system prompt', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', properties: { info: { id: TEST_SESSION_ID } } },
    })

    const systemPromptInput = {
      sessionID: TEST_SESSION_ID,
      model: { id: 'claude-3.5-sonnet' },
    }

    const systemPromptOutput = {
      system: [] as string[],
    }

    await pluginHooks['experimental.chat.system.transform'](
      systemPromptInput,
      systemPromptOutput
    )

    const injectedPrompt = systemPromptOutput.system[0]
    // Check for escaped version of marker (template contains \_ for escaping)
    expect(injectedPrompt).toContain('BLOCKER')
    expect(injectedPrompt).toContain('DIVERTER')
    expect(injectedPrompt).toContain('DONE')
  })
})
