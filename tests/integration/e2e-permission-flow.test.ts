/**
 * E2E Tests: Permission Flow
 * 
 * Tests complete permission request workflows including:
 * - Full permission lifecycle (request → block → log → state)
 * - Permission type filtering
 * - Max blockers limit enforcement
 * 
 * @module tests/integration/e2e-permission-flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPlugin } from '../../src/core/plugin'
import { getState, cleanupState } from '../../src/state'
import type { Permission } from '@opencode-ai/sdk'
import {
  createMockContext,
  setupSpies,
  TEST_SESSION_ID,
  createPermission,
  createPermissionOutput,
  type MockPluginContext,
  type TestSpies,
} from './fixtures'

describe('E2E: Permission Flow', () => {
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

  it('should handle complete permission workflow: request → block → log → state', async () => {
    // Step 1: Initialize session
    await pluginHooks.event({
      event: {
        type: 'session.created',
        session_id: TEST_SESSION_ID,
      },
    })

    // Verify session state initialized
    const stateAfterCreate = getState(TEST_SESSION_ID)
    expect(stateAfterCreate.divertBlockers).toBe(true)
    expect(stateAfterCreate.blockers.length).toBe(0)

    // Step 2: Trigger permission request
    const permissionInput: Permission = {
      id: 'perm-e2e-001',
      type: 'bash',
      sessionID: TEST_SESSION_ID,
      messageID: 'msg-e2e-001',
      callID: 'call-e2e-001',
      title: 'Run bash command',
      metadata: {
        tool: 'bash',
        args: { command: 'npm install' },
      },
      time: {
        created: Date.now(),
      },
    }

    const permissionOutput = createPermissionOutput()

    await pluginHooks['permission.asked'](permissionInput, permissionOutput)

    // Step 3: Verify blocker logged
    expect(spies.appendBlockerSpy).toHaveBeenCalledTimes(1)
    const loggedBlocker = spies.appendBlockerSpy.mock.calls[0][1]
    expect(loggedBlocker.category).toBe('permission')
    expect(loggedBlocker.sessionId).toBe(TEST_SESSION_ID)
    expect(loggedBlocker.blocksProgress).toBe(true)

    // Step 4: Verify output status changed to "deny"
    expect(permissionOutput.status).toBe('deny')

    // Step 5: Verify continuation prompt injected
    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    // Step 6: Verify state updated correctly
    const stateAfterPermission = getState(TEST_SESSION_ID)
    expect(stateAfterPermission.blockers.length).toBe(1)
    expect(stateAfterPermission.blockers[0].question).toContain('bash permission')
    expect(stateAfterPermission.cooldownHashes.size).toBeGreaterThan(0)
  })

  it('should respect permission type filtering (only intercept bash/edit/write)', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Clear mock from previous tests
    spies.appendBlockerSpy.mockClear()

    // Test non-intercepted permission type
    const readPermission: Permission = {
      id: 'perm-read-001',
      type: 'read',
      sessionID: TEST_SESSION_ID,
      messageID: 'msg-read-001',
      callID: 'call-read-001',
      title: 'Read file',
      metadata: { tool: 'read', args: { filePath: '/test/file.ts' } },
      time: { created: Date.now() },
    }

    const output = createPermissionOutput()
    await pluginHooks['permission.asked'](readPermission, output)

    // Should NOT modify output or log blocker
    expect(output.status).toBe('ask')
    expect(spies.appendBlockerSpy).not.toHaveBeenCalled()
    expect(getState(TEST_SESSION_ID).blockers.length).toBe(0)
  })

  it('should enforce max blockers limit', async () => {
    await pluginHooks.event({
      event: { type: 'session.created', session_id: TEST_SESSION_ID },
    })

    // Fill state with max blockers
    const state = getState(TEST_SESSION_ID)
    for (let i = 0; i < 50; i++) {
      state.blockers.push({
        id: `blocker-${i}`,
        timestamp: new Date().toISOString(),
        sessionId: TEST_SESSION_ID,
        category: 'permission',
        question: `Question ${i}`,
        context: 'test',
        blocksProgress: true,
      })
    }

    // Clear mock from previous tests
    spies.appendBlockerSpy.mockClear()

    // Try to add another blocker
    const permissionInput = createPermission({
      id: 'perm-overflow',
      messageID: 'msg-overflow',
      callID: 'call-overflow',
      title: 'Overflow test',
      metadata: { tool: 'bash', args: { command: 'echo test' } },
    })

    const output = createPermissionOutput()
    await pluginHooks['permission.asked'](permissionInput, output)

    // Should deny but NOT log new blocker
    expect(output.status).toBe('deny')
    expect(spies.appendBlockerSpy).not.toHaveBeenCalled()
    expect(state.blockers.length).toBe(50) // Still at max
  })
})
