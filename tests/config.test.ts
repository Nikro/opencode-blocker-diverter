/**
 * Tests for config.ts - Configuration loading and validation
 * 
 * Following TDD: Tests written BEFORE implementation
 * Tests cover: schema validation, defaults, error handling, path resolution
 * 
 * Updated for new config loading pattern:
 * - User: ~/.config/opencode/blocker-diverter.json
 * - Project: .opencode/blocker-diverter.json
 * 
 * @module tests/config
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { resolve, join } from 'path'
import { homedir } from 'os'

// Import will be available after implementation
import { ConfigSchema, loadConfig } from '../src/config'

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
      promptTimeoutMs: 45000,
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
    expect(result.repromptWindowMs).toBe(300000) // Default (5 minutes)
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
      repromptWindowMs: 300000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
      promptTimeoutMs: 30000,
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

  it('should reject non-integer maxBlockersPerRun', () => {
    const invalidConfig = {
      maxBlockersPerRun: 25.5,
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject wrong type for enabled', () => {
    const invalidConfig = {
      enabled: 'true', // String instead of boolean
    }

    const result = ConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false) // Should fail validation
  })
})

describe('loadConfig', () => {
  const mockProjectDir = '/test/project'
  const projectConfigPath = join(mockProjectDir, '.opencode', 'blocker-diverter.json')
  const userConfigPath = join(homedir(), '.config', 'opencode', 'blocker-diverter.json')

  beforeEach(() => {
    // Clear any mocks between tests
  })

  it('should load valid config from project .opencode directory', async () => {
    // Mock Bun.file to return valid config for project path
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            enabled: false,
            maxBlockersPerRun: 25,
          })),
        }
      }
      // User config doesn't exist
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.enabled).toBe(false)
    expect(config.maxBlockersPerRun).toBe(25)
    expect(config.defaultDivertBlockers).toBe(true) // Default applied

    // Restore
    globalThis.Bun.file = originalBunFile
  })

  it('should fall back to user config when project config missing', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === userConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            enabled: true,
            maxBlockersPerRun: 15,
          })),
        }
      }
      // Project config doesn't exist
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.enabled).toBe(true)
    expect(config.maxBlockersPerRun).toBe(15)

    globalThis.Bun.file = originalBunFile
  })

  it('should return defaults when no config files exist', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = (() => ({
      exists: () => Promise.resolve(false),
      text: () => Promise.reject(new Error('ENOENT')),
    })) as any

    const config = await loadConfig(mockProjectDir)

    // Should return all defaults
    expect(config).toEqual({
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: resolve(mockProjectDir, './blockers.md'),
      maxBlockersPerRun: 50,
      cooldownMs: 30000,
      maxReprompts: 5,
      repromptWindowMs: 300000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!',
      promptTimeoutMs: 30000,
    })

    globalThis.Bun.file = originalBunFile
  })

  it('should resolve relative blockersFile path against projectDir', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            blockersFile: './logs/blockers.md',
          })),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.blockersFile).toBe(resolve(mockProjectDir, './logs/blockers.md'))

    globalThis.Bun.file = originalBunFile
  })

  it('should keep absolute blockersFile path unchanged if within project', async () => {
    const absolutePath = join(mockProjectDir, 'logs', 'opencode-blockers.md')
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            blockersFile: absolutePath,
          })),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    expect(config.blockersFile).toBe(absolutePath)

    globalThis.Bun.file = originalBunFile
  })

  it('should reject absolute path outside project directory', async () => {
    const outsidePath = '/etc/passwd'
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            blockersFile: outsidePath,
          })),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    // Should fallback to default due to security check
    expect(config.blockersFile).toBe(resolve(mockProjectDir, './blockers.md'))

    globalThis.Bun.file = originalBunFile
  })

  it('should log info when config loaded successfully', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({ enabled: true })),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const mockClient = {
      app: {
        log: mock(() => Promise.resolve()),
      }
    }

    await loadConfig(mockProjectDir, mockClient)

    expect(mockClient.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: expect.stringContaining('Loaded config from'),
        service: 'blocker-diverter',
      })
    )

    globalThis.Bun.file = originalBunFile
  })

  it('should handle invalid JSON gracefully', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve('{ invalid json }'),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    // Should return defaults
    expect(config.enabled).toBe(true)
    expect(config.maxBlockersPerRun).toBe(50)

    globalThis.Bun.file = originalBunFile
  })

  it('should handle Zod validation failure gracefully', async () => {
    const originalBunFile = globalThis.Bun.file
    
    globalThis.Bun.file = ((path: string) => {
      if (path === projectConfigPath) {
        return {
          exists: () => Promise.resolve(true),
          text: () => Promise.resolve(JSON.stringify({
            maxBlockersPerRun: 999, // Invalid: exceeds max of 100
          })),
        }
      }
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('ENOENT')),
      }
    }) as any

    const config = await loadConfig(mockProjectDir)

    // Should return defaults
    expect(config.maxBlockersPerRun).toBe(50)
    expect(config.cooldownMs).toBe(30000)

    globalThis.Bun.file = originalBunFile
  })
})
