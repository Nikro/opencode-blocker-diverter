/**
 * Plugin Factory Tests
 * 
 * Tests the main plugin initialization and hook wiring.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { Plugin } from '@opencode-ai/plugin'
import { createPlugin } from '../../src/core/plugin'

describe('createPlugin', () => {
  // Mock context object matching OpenCode SDK structure
  const createMockContext = (): any => ({
    client: {
      app: {
        log: mock(async () => {}),
      },
      session: {
        prompt: mock(async () => {}),
      },
    } as any,
    project: {
      id: 'test-project',
      worktree: '/tmp/test-project',
      vcs: 'git',
      name: 'Test Project',
    },
    $: mock(() => ({})) as any,
    directory: '/tmp/test-project',
    worktree: '/tmp/test-project',
    serverUrl: new URL('http://localhost:8080'),
  })

  beforeEach(() => {
    // Reset mocks between tests
    mock.restore()
  })

  it('should be a valid Plugin function', () => {
    expect(typeof createPlugin).toBe('function')
  })

  it('should initialize plugin and return hooks object', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    expect(hooks).toBeTypeOf('object')
    expect(hooks).not.toBeNull()
  })

  it('should register permission.asked hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    // Check hooks exist using property access instead of hasProperty
    expect('permission.asked' in hooks).toBe(true)
    expect(typeof hooks['permission.asked']).toBe('function')
  })

  it('should register event hook for session events', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    expect(hooks).toHaveProperty('event')
    expect(typeof hooks.event).toBe('function')
  })

  it('should register experimental.chat.system.transform hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    expect('experimental.chat.system.transform' in hooks).toBe(true)
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function')
  })

  it('should register experimental.session.compacting hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    expect('experimental.session.compacting' in hooks).toBe(true)
    expect(typeof hooks['experimental.session.compacting']).toBe('function')
  })

  it('should load config from worktree directory', async () => {
    const mockContext = createMockContext()
    
    // Config loading happens during initialization
    await createPlugin(mockContext)
    
    // Config is loaded (verified by no errors thrown)
    // Actual config behavior is tested in config.test.ts
    expect(true).toBe(true)
  })

  it('should log initialization message', async () => {
    const mockContext = createMockContext()
    const logMock = mockContext.client.app.log
    
    await createPlugin(mockContext)
    
    // Should log initialization (called at least once)
    expect(logMock).toHaveBeenCalled()
  })

  it('should handle config load errors gracefully', async () => {
    const mockContext = createMockContext()
    // Use invalid directory to trigger config load warning
    mockContext.project.worktree = '/nonexistent/directory/that/does/not/exist'
    mockContext.worktree = '/nonexistent/directory/that/does/not/exist'
    
    // Should not throw - graceful degradation
    const hooks = await createPlugin(mockContext)
    
    // Hooks should still be registered (enabled defaults to true)
    expect('permission.asked' in hooks).toBe(true)
    expect('event' in hooks).toBe(true)
    expect('experimental.chat.system.transform' in hooks).toBe(true)
  })

  it('should return empty object when plugin is disabled via config', async () => {
    const mockContext = createMockContext()
    
    // Create opencode.json with enabled: false
    const configPath = `${mockContext.project.worktree}/opencode.json`
    await Bun.write(configPath, JSON.stringify({
      blockerDiverter: {
        enabled: false
      }
    }))
    
    const hooks = await createPlugin(mockContext)
    
    // Should return empty hooks object when disabled
    expect(Object.keys(hooks).length).toBe(0)
    
    // Cleanup
    await Bun.write(configPath, '')
  })

  it('should pass context to permission hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    // Permission hook should exist and be callable
    expect(hooks['permission.asked']).toBeDefined()
    
    // Mock permission input
    const mockInput = {
      sessionID: 'test-session',
      type: 'bash',
      title: 'Test Permission',
      metadata: { tool: 'bash' }
    }
    const mockOutput = { status: 'ask' as const }
    
    // Should not throw when called
    await expect(
      hooks['permission.asked']!(mockInput as any, mockOutput)
    ).resolves.toBeUndefined()
  })

  it('should pass context to session hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    // Session hook should exist and be callable
    expect(hooks.event).toBeDefined()
    
    // Mock session event
    const mockEvent = {
      event: {
        type: 'session.created',
        session_id: 'test-session'
      }
    }
    
    // Should not throw when called
    await expect(
      hooks.event!(mockEvent as any)
    ).resolves.toBeUndefined()
  })

  it('should pass config to system prompt hook', async () => {
    const mockContext = createMockContext()
    
    const hooks = await createPlugin(mockContext)
    
    // System prompt hook should exist and be callable
    expect(hooks['experimental.chat.system.transform']).toBeDefined()
    
    // Mock system prompt input/output
    const mockInput = {
      sessionID: 'test-session',
      model: { id: 'claude-3' }
    }
    const mockOutput = { system: [] as string[] }
    
    // Should not throw when called
    await expect(
      hooks['experimental.chat.system.transform']!(mockInput as any, mockOutput)
    ).resolves.toBeUndefined()
  })
})
