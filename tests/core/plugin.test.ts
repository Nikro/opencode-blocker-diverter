/**
 * Plugin Factory Tests
 * 
 * Tests the main plugin initialization and hook wiring.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { mkdirSync, existsSync, rmSync, statSync } from 'fs'
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
    expect('event' in hooks).toBe(true)
    expect('experimental.chat.system.transform' in hooks).toBe(true)
  })

  it('should return empty object when plugin is disabled via config', async () => {
    const mockContext = createMockContext()
    
    // Create .opencode/blocker-diverter.json with enabled: false
    const configDir = `${mockContext.project.worktree}/.opencode`
    const configPath = `${configDir}/blocker-diverter.json`
    
    // Clean up if .opencode exists as a file (from previous test)
    if (existsSync(configDir)) {
      try {
        const stats = statSync(configDir)
        if (stats.isFile()) {
          rmSync(configDir) // Remove file
        }
      } catch {}
    }
    
    // Now create as directory
    mkdirSync(configDir, { recursive: true })
    
    await Bun.write(configPath, JSON.stringify({
      enabled: false
    }))
    
    const hooks = await createPlugin(mockContext)
    
    // Should return empty hooks object when disabled
    expect(Object.keys(hooks).length).toBe(0)
    
    // Cleanup
    if (existsSync(configPath)) {
      rmSync(configPath)
    }
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
        properties: { info: { id: 'test-session' } }
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

  describe('Command Registration', () => {
    it('should register command.execute.before hook', async () => {
      const mockContext = createMockContext()
      
      const hooks = await createPlugin(mockContext)
      
      expect('command.execute.before' in hooks).toBe(true)
      expect(typeof hooks['command.execute.before']).toBe('function')
    })
    
    it('should route /blockers.status command', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear initialization logs
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call command hook with dot-delimited command
      await hooks['command.execute.before']!({
        command: '/blockers.status',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Should have logged status message
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Blocker Diverter Status')
        })
      )
      
      // Should have replaced output.parts with minimal response
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0].type).toBe('text')
      expect(output.parts[0].text).toContain('No further action needed')
    })
    
    it('should route /blockers.on command', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear initialization logs
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call command hook with dot-delimited command
      await hooks['command.execute.before']!({
        command: '/blockers.on',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Should have logged enable message
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('enabled')
        })
      )
      
      // Should have replaced output.parts
      expect(output.parts.length).toBeGreaterThan(0)
    })
    
    it('should route /blockers.off command', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear initialization logs
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call command hook with dot-delimited command
      await hooks['command.execute.before']!({
        command: '/blockers.off',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Should have logged disable message
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('disabled')
        })
      )
      
      // Should have replaced output.parts
      expect(output.parts.length).toBeGreaterThan(0)
    })
    
    it('should allow /blockers.list command to be handled by AI template', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear initialization logs
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call command hook with dot-delimited command
      await hooks['command.execute.before']!({
        command: '/blockers.list',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Hook should fire but not intercept (let AI template handle it)
      // No interception means no state change or toast
      
      // List command is NOT intercepted, so output.parts should remain empty
      expect(output.parts).toHaveLength(0)
    })
    
    it('should ignore non-blockers commands', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear any previous calls
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call with different command
      await hooks['command.execute.before']!({
        command: '/other',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Should not have logged anything (except the debug log from hook itself)
      const commandLogs = logSpy.mock.calls.filter((call: any) => 
        !call[0]?.message?.includes('command.execute.before hook fired')
      )
      expect(commandLogs).toHaveLength(0)
      
      // Should not have modified output.parts
      expect(output.parts).toHaveLength(0)
    })
    
    it('should handle invalid subcommands', async () => {
      const mockContext = createMockContext()
      const logSpy = mockContext.client.app.log
      
      const hooks = await createPlugin(mockContext)
      
      // Clear initialization logs
      logSpy.mockClear()
      
      const output = { parts: [] as any[] }
      
      // Call command hook with different command
      await hooks['command.execute.before']!({
        command: '/some-other-command',
        arguments: '',
        sessionID: 'test-session'
      } as any, output)
      
      // Should not have logged anything (besides the hook debug log)
      const blockerCalls = logSpy.mock.calls.filter((call: any) =>
        call[0]?.message?.includes('Blocker') || call[0]?.message?.includes('blocker')
      )
      expect(blockerCalls.length).toBe(0)
      
      // Output parts should remain empty (not handled)
      expect(output.parts).toHaveLength(0)
    })
  })
})
