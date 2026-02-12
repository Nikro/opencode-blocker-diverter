/**
 * Tests for config.ts - Configuration loading and validation
 * 
 * Following TDD: Tests written BEFORE implementation
 * Tests cover: schema validation, defaults, error handling, path resolution
 * 
 * @module tests/config
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { resolve } from 'path'

// Import will be available after implementation
import { ConfigSchema, loadConfig } from '../config'

describe('ConfigSchema', () => {
  it('should validate a complete valid config', () => {
    const validConfig = {
      enabled: true,
      defaultDivertBlockers: false,
      blockersFile: './logs/blockers.md',
      maxBlockersPerRun: 25,
      cooldownMs: 60000,
      maxReprompts: 3,
      repromptWindowMs: 180000,
      completionMarker: 'DONE!',
    }

    const result = ConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validConfig)
    }
  })

  it('should apply default values for missing fields', () => {
    const partialConfig = {
      enabled: false,
    }

    const result = ConfigSchema.parse(partialConfig)
    expect(result.enabled).toBe(false) // User-provided
    expect(result.defaultDivertBlockers).toBe(true) // Default
    expect(result.blockersFile).toBe('./blockers.md') // Default
    expect(result.maxBlockersPerRun).toBe(50) // Default
    expect(result.cooldownMs).toBe(30000) // Default
    expect(result.maxReprompts).toBe(5) // Default
    expect(result.repromptWindowMs).toBe(120000) // Default
    expect(result.completionMarker).toBe('BLOCKER_DIVERTER_DONE!') // Default
  })

  it('should apply all defaults when given empty object', () => {
    const result = ConfigSchema.parse({})
    
    expect(result).toEqual({
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: './blockers.md',
      maxBlockersPerRun: 50,
      cooldownMs: 30000,
      maxReprompts: 5,
      repromptWindowMs: 120000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
    })
  })

  it('should reject maxBlockersPerRun below minimum (1)', () => {
    const invalidConfig = {
      maxBlockersPerRun: 0,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject maxBlockersPerRun above maximum (100)', () => {
    const invalidConfig = {
      maxBlockersPerRun: 101,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject cooldownMs below minimum (1000)', () => {
    const invalidConfig = {
      cooldownMs: 500,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject maxReprompts below minimum (1)', () => {
    const invalidConfig = {
      maxReprompts: 0,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject repromptWindowMs below minimum (60000)', () => {
    const invalidConfig = {
      repromptWindowMs: 30000,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject invalid types', () => {
    const invalidConfig = {
      enabled: 'yes', // Should be boolean
      maxBlockersPerRun: '50', // Should be number
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should accept valid boundary values', () => {
    const boundaryConfig = {
      maxBlockersPerRun: 1, // Min
      cooldownMs: 1000, // Min
      maxReprompts: 1, // Min
      repromptWindowMs: 60000, // Min
    }

    const result = ConfigSchema.safeParse(boundaryConfig)
    expect(result.success).toBe(true)
  })

  it('should accept maximum boundary values', () => {
    const boundaryConfig = {
      maxBlockersPerRun: 100, // Max
    }

    const result = ConfigSchema.safeParse(boundaryConfig)
    expect(result.success).toBe(true)
  })
})

describe('loadConfig', () => {
  const mockProjectDir = '/test/project'

  beforeEach(() => {
    // Clear any mocks between tests
  })

  it('should load valid config from opencode.json', async () => {
    // Mock Bun.file to return valid config
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          enabled: false,
          maxBlockersPerRun: 25,
        }
      }))),
    }

    // Use globalThis to mock Bun.file
    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.enabled).toBe(false)
    expect(config.maxBlockersPerRun).toBe(25)
    expect(config.defaultDivertBlockers).toBe(true) // Default applied

    // Restore
    globalThis.Bun.file = originalBunFile
  })

  it('should return defaults when opencode.json does not exist', async () => {
    // Mock Bun.file to return non-existent file
    const mockFile = {
      exists: mock(() => Promise.resolve(false)),
      text: mock(() => Promise.reject(new Error('ENOENT'))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    // Should return all defaults
    expect(config).toEqual({
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: resolve(mockProjectDir, './blockers.md'),
      maxBlockersPerRun: 50,
      cooldownMs: 30000,
      maxReprompts: 5,
      repromptWindowMs: 120000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
    })

    globalThis.Bun.file = originalBunFile
  })

  it('should return defaults when opencode.json has no blockerDiverter section', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        someOtherPlugin: { foo: 'bar' }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.enabled).toBe(true)
    expect(config.maxBlockersPerRun).toBe(50)

    globalThis.Bun.file = originalBunFile
  })

  it('should return defaults and log warning on invalid JSON', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve('{ invalid json }')),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    const config = await loadConfig(mockProjectDir, mockClient)

    // Should return defaults
    expect(config.enabled).toBe(true)

    // Should have logged warning
    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        service: 'blocker-diverter',
        message: expect.stringContaining('Invalid JSON'),
      })
    )

    globalThis.Bun.file = originalBunFile
  })

  it('should return defaults and log warning on Zod validation failure', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          maxBlockersPerRun: 500, // Exceeds max (100)
          cooldownMs: 100, // Below min (1000)
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    const config = await loadConfig(mockProjectDir, mockClient)

    // Should return defaults
    expect(config.maxBlockersPerRun).toBe(50)
    expect(config.cooldownMs).toBe(30000)

    // Should have logged validation errors
    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        service: 'blocker-diverter',
        message: expect.stringContaining('validation failed'),
      })
    )

    globalThis.Bun.file = originalBunFile
  })

  it('should resolve relative blockersFile path against projectDir', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          blockersFile: './logs/blockers.md',
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.blockersFile).toBe(resolve(mockProjectDir, './logs/blockers.md'))

    globalThis.Bun.file = originalBunFile
  })

  it('should keep absolute blockersFile path unchanged', async () => {
    const absolutePath = '/test/project/logs/opencode-blockers.md' // Within project
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          blockersFile: absolutePath,
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.blockersFile).toBe(absolutePath)

    globalThis.Bun.file = originalBunFile
  })

  it('should handle empty blockerDiverter object with defaults', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {}
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config).toEqual({
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: resolve(mockProjectDir, './blockers.md'),
      maxBlockersPerRun: 50,
      cooldownMs: 30000,
      maxReprompts: 5,
      repromptWindowMs: 120000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
    })

    globalThis.Bun.file = originalBunFile
  })

  it('should not throw when client is not provided', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve('{ invalid }')),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    // Should not throw even with invalid JSON and no client
    const config = await loadConfig(mockProjectDir)
    expect(config.enabled).toBe(true)

    globalThis.Bun.file = originalBunFile
  })

  it('should log info when file does not exist (with client)', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(false)),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    await loadConfig(mockProjectDir, mockClient)

    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        service: 'blocker-diverter',
        message: expect.stringContaining('not found'),
      })
    )

    globalThis.Bun.file = originalBunFile
  })

  it('should handle partial valid config with defaults', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          enabled: false,
          completionMarker: 'CUSTOM_MARKER',
          // Other fields should get defaults
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.enabled).toBe(false)
    expect(config.completionMarker).toBe('CUSTOM_MARKER')
    expect(config.maxBlockersPerRun).toBe(50) // Default
    expect(config.cooldownMs).toBe(30000) // Default

    globalThis.Bun.file = originalBunFile
  })

  it('should prevent path traversal with relative paths', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          blockersFile: '../../../etc/passwd', // Path traversal attempt
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    // Should fallback to default path within project
    expect(config.blockersFile).toBe(resolve(mockProjectDir, './blockers.md'))
    expect(config.blockersFile.startsWith(mockProjectDir)).toBe(true)

    globalThis.Bun.file = originalBunFile
  })

  it('should prevent path traversal with absolute paths outside project', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          blockersFile: '/etc/passwd', // Absolute path outside project
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    // Should fallback to default path within project
    expect(config.blockersFile).toBe(resolve(mockProjectDir, './blockers.md'))
    expect(config.blockersFile.startsWith(mockProjectDir)).toBe(true)

    globalThis.Bun.file = originalBunFile
  })

  it('should allow absolute path within project directory', async () => {
    const validAbsolutePath = '/test/project/logs/blockers.md'
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.resolve(JSON.stringify({
        blockerDiverter: {
          blockersFile: validAbsolutePath,
        }
      }))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const config = await loadConfig(mockProjectDir)

    // Should keep the valid absolute path
    expect(config.blockersFile).toBe(validAbsolutePath)

    globalThis.Bun.file = originalBunFile
  })

  it('should handle filesystem errors gracefully', async () => {
    const mockFile = {
      exists: mock(() => Promise.reject(new Error('Permission denied'))),
      text: mock(() => Promise.reject(new Error('Cannot read'))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    // Should not throw and return defaults
    const config = await loadConfig(mockProjectDir, mockClient)
    expect(config.enabled).toBe(true)
    expect(config.maxBlockersPerRun).toBe(50)

    // Should have logged warning
    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('Failed to load config'),
      })
    )

    globalThis.Bun.file = originalBunFile
  })

  it('should handle logger throwing errors gracefully', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(false)),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.reject(new Error('Logging service down'))),
      }
    }

    // Should not throw even if logger fails
    const config = await loadConfig(mockProjectDir, mockClient)
    expect(config.enabled).toBe(true)

    globalThis.Bun.file = originalBunFile
  })

  it('should handle text() method throwing error after exists check', async () => {
    const mockFile = {
      exists: mock(() => Promise.resolve(true)),
      text: mock(() => Promise.reject(new Error('Read error'))),
    }

    const originalBunFile = globalThis.Bun.file
    globalThis.Bun.file = mock(() => mockFile) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    // Should catch error and return defaults
    const config = await loadConfig(mockProjectDir, mockClient)
    expect(config.enabled).toBe(true)

    // Should have logged warning
    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('Failed to load config'),
      })
    )

    globalThis.Bun.file = originalBunFile
  })
})
