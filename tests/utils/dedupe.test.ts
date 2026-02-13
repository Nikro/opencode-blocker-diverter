/**
 * Test suite for deduplication utilities
 * 
 * Tests hash generation, cooldown tracking, and edge case handling
 * for the blocker deduplication system.
 * 
 * @module tests/utils/dedupe
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { generateBlockerHash, isInCooldown, addToCooldown } from '../../src/utils/dedupe'
import type { SessionState, PluginConfig } from '../../src/types'

describe('generateBlockerHash', () => {
  describe('hash generation', () => {
    it('should generate same hash for identical inputs', async () => {
      const hash1 = await generateBlockerHash('Should I use Redux?', 'Building state management')
      const hash2 = await generateBlockerHash('Should I use Redux?', 'Building state management')
      
      expect(hash1).toBe(hash2)
      expect(typeof hash1).toBe('string')
      expect(hash1.length).toBe(64) // SHA-256 produces 64 hex chars
    })

    it('should generate different hashes for different questions', async () => {
      const hash1 = await generateBlockerHash('Should I use Redux?', 'state management')
      const hash2 = await generateBlockerHash('Should I use MobX?', 'state management')
      
      expect(hash1).not.toBe(hash2)
    })

    it('should generate different hashes for different contexts', async () => {
      const hash1 = await generateBlockerHash('Should I use Redux?', 'frontend app')
      const hash2 = await generateBlockerHash('Should I use Redux?', 'backend API')
      
      expect(hash1).not.toBe(hash2)
    })

    it('should normalize whitespace correctly', async () => {
      const hash1 = await generateBlockerHash('  Should I   use   Redux?  ', '  state   management  ')
      const hash2 = await generateBlockerHash('Should I use Redux?', 'state management')
      
      expect(hash1).toBe(hash2)
    })

    it('should preserve case sensitivity', async () => {
      const hash1 = await generateBlockerHash('Should I use REDUX?', 'context')
      const hash2 = await generateBlockerHash('Should I use redux?', 'context')
      
      expect(hash1).not.toBe(hash2)
    })

    it('should allow empty context', async () => {
      const hash1 = await generateBlockerHash('Should I use Redux?')
      const hash2 = await generateBlockerHash('Should I use Redux?', '')
      
      expect(hash1).toBe(hash2)
      expect(typeof hash1).toBe('string')
      expect(hash1.length).toBe(64)
    })

    it('should handle special characters correctly', async () => {
      const question = 'Should I use @decorators or #pragmas?'
      const context = 'TypeScript: {config: "strict", module: "ESNext"}'
      
      const hash = await generateBlockerHash(question, context)
      
      expect(typeof hash).toBe('string')
      expect(hash.length).toBe(64)
    })

    it('should handle very long strings', async () => {
      const longQuestion = 'A'.repeat(1000)
      const longContext = 'B'.repeat(1000)
      
      const hash = await generateBlockerHash(longQuestion, longContext)
      
      expect(typeof hash).toBe('string')
      expect(hash.length).toBe(64)
    })

    it('should prevent delimiter ambiguity using JSON serialization', async () => {
      // Test case from critique: ("a|b", "c") vs ("a", "b|c")
      // These should produce DIFFERENT hashes with JSON serialization
      const hash1 = await generateBlockerHash('a|b', 'c')
      const hash2 = await generateBlockerHash('a', 'b|c')
      
      expect(hash1).not.toBe(hash2)
    })

    it('should normalize newlines and tabs consistently', async () => {
      const questionWithWhitespace = 'Should I\n\tuse\n\tRedux?'
      const normalizedQuestion = 'Should I use Redux?'
      
      const hash1 = await generateBlockerHash(questionWithWhitespace, 'context')
      const hash2 = await generateBlockerHash(normalizedQuestion, 'context')
      
      expect(hash1).toBe(hash2)
    })
  })
})

describe('isInCooldown', () => {
  let mockState: SessionState
  
  beforeEach(() => {
    mockState = {
      enabled: true,
      divertBlockers: true,
      blockers: [],
      cooldownHashes: new Map<string, number>(),
      lastBlockerTime: 0,
      repromptCount: 0,
      recentResponseHashes: [],
      lastRepromptTime: 0,
    }
  })

  it('should return false for hash not in cooldown map', () => {
    const result = isInCooldown('abc123', mockState)
    
    expect(result).toBe(false)
  })

  it('should return true for hash within cooldown period', () => {
    const now = Date.now()
    const hash = 'abc123'
    const expiry = now + 10000 // expires in 10 seconds
    
    mockState.cooldownHashes.set(hash, expiry)
    
    const result = isInCooldown(hash, mockState)
    
    expect(result).toBe(true)
  })

  it('should return false for hash past cooldown expiry', () => {
    const now = Date.now()
    const hash = 'abc123'
    const expiry = now - 1000 // expired 1 second ago
    
    mockState.cooldownHashes.set(hash, expiry)
    
    const result = isInCooldown(hash, mockState)
    
    expect(result).toBe(false)
  })

  it('should not modify state when checking cooldown', () => {
    const hash = 'abc123'
    const expiry = Date.now() + 10000
    mockState.cooldownHashes.set(hash, expiry)
    
    const initialSize = mockState.cooldownHashes.size
    const initialExpiry = mockState.cooldownHashes.get(hash)
    
    isInCooldown(hash, mockState)
    
    expect(mockState.cooldownHashes.size).toBe(initialSize)
    expect(mockState.cooldownHashes.get(hash)).toBe(initialExpiry)
  })

  it('should handle multiple different hashes independently', () => {
    const now = Date.now()
    
    mockState.cooldownHashes.set('hash1', now + 10000) // in cooldown
    mockState.cooldownHashes.set('hash2', now - 1000)  // expired
    
    expect(isInCooldown('hash1', mockState)).toBe(true)
    expect(isInCooldown('hash2', mockState)).toBe(false)
    expect(isInCooldown('hash3', mockState)).toBe(false)
  })

  it('should return false when expiry exactly equals current time (boundary case)', () => {
    const now = Date.now()
    const hash = 'abc123'
    const expiry = now // exactly at boundary
    
    mockState.cooldownHashes.set(hash, expiry)
    
    // expiry > now is false when they're equal, so should NOT be in cooldown
    const result = isInCooldown(hash, mockState)
    
    expect(result).toBe(false)
  })
})

describe('addToCooldown', () => {
  let mockState: SessionState
  let mockConfig: PluginConfig
  
  beforeEach(() => {
    mockState = {
      enabled: true,
      divertBlockers: true,
      blockers: [],
      cooldownHashes: new Map<string, number>(),
      lastBlockerTime: 0,
      repromptCount: 0,
      recentResponseHashes: [],
      lastRepromptTime: 0,
    }
    
    mockConfig = {
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: 'blockers.md',
      maxBlockersPerRun: 20,
      cooldownMs: 30000, // 30 seconds
      maxReprompts: 3,
      repromptWindowMs: 300000,
      completionMarker: '---',
    }
  })

  it('should add hash with correct expiry timestamp', () => {
    const hash = 'abc123'
    const beforeAdd = Date.now()
    
    addToCooldown(hash, mockState, mockConfig)
    
    const afterAdd = Date.now()
    const expiry = mockState.cooldownHashes.get(hash)
    
    expect(expiry).toBeDefined()
    expect(expiry!).toBeGreaterThanOrEqual(beforeAdd + mockConfig.cooldownMs)
    expect(expiry!).toBeLessThanOrEqual(afterAdd + mockConfig.cooldownMs)
  })

  it('should update existing hash with new expiry', () => {
    const hash = 'abc123'
    const oldExpiry = Date.now() + 5000
    
    mockState.cooldownHashes.set(hash, oldExpiry)
    
    addToCooldown(hash, mockState, mockConfig)
    
    const newExpiry = mockState.cooldownHashes.get(hash)
    
    expect(newExpiry).toBeDefined()
    expect(newExpiry!).toBeGreaterThan(oldExpiry)
  })

  it('should respect configured cooldown duration', () => {
    const hash = 'abc123'
    const customCooldown = 60000 // 1 minute
    mockConfig.cooldownMs = customCooldown
    
    const beforeAdd = Date.now()
    addToCooldown(hash, mockState, mockConfig)
    const expiry = mockState.cooldownHashes.get(hash)
    
    const expectedExpiry = beforeAdd + customCooldown
    
    expect(expiry).toBeDefined()
    expect(expiry!).toBeGreaterThanOrEqual(expectedExpiry)
    expect(expiry!).toBeLessThanOrEqual(expectedExpiry + 100) // 100ms tolerance
  })

  it('should handle multiple hashes correctly', () => {
    addToCooldown('hash1', mockState, mockConfig)
    addToCooldown('hash2', mockState, mockConfig)
    addToCooldown('hash3', mockState, mockConfig)
    
    expect(mockState.cooldownHashes.size).toBe(3)
    expect(mockState.cooldownHashes.has('hash1')).toBe(true)
    expect(mockState.cooldownHashes.has('hash2')).toBe(true)
    expect(mockState.cooldownHashes.has('hash3')).toBe(true)
  })
})

describe('dedupe integration', () => {
  let mockState: SessionState
  let mockConfig: PluginConfig
  
  beforeEach(() => {
    mockState = {
      enabled: true,
      divertBlockers: true,
      blockers: [],
      cooldownHashes: new Map<string, number>(),
      lastBlockerTime: 0,
      repromptCount: 0,
      recentResponseHashes: [],
      lastRepromptTime: 0,
    }
    
    mockConfig = {
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: 'blockers.md',
      maxBlockersPerRun: 20,
      cooldownMs: 30000,
      maxReprompts: 3,
      repromptWindowMs: 300000,
      completionMarker: '---',
    }
  })

  it('should allow first blocker and add to cooldown', async () => {
    const question = 'Should I use Redux?'
    const context = 'state management'
    
    const hash = await generateBlockerHash(question, context)
    
    // First check - should not be in cooldown
    expect(isInCooldown(hash, mockState)).toBe(false)
    
    // Add to cooldown
    addToCooldown(hash, mockState, mockConfig)
    
    // Second check - should now be in cooldown
    expect(isInCooldown(hash, mockState)).toBe(true)
  })

  it('should block duplicate within cooldown period', async () => {
    const question = 'Should I use Redux?'
    const context = 'state management'
    
    const hash = await generateBlockerHash(question, context)
    
    // Add first blocker
    addToCooldown(hash, mockState, mockConfig)
    expect(isInCooldown(hash, mockState)).toBe(true)
    
    // Try to add duplicate immediately
    const duplicateHash = await generateBlockerHash(question, context)
    expect(duplicateHash).toBe(hash)
    expect(isInCooldown(duplicateHash, mockState)).toBe(true)
  })

  it('should allow duplicate after cooldown expires', async () => {
    const question = 'Should I use Redux?'
    const context = 'state management'
    
    const hash = await generateBlockerHash(question, context)
    
    // Add with past expiry
    const pastExpiry = Date.now() - 1000
    mockState.cooldownHashes.set(hash, pastExpiry)
    
    // Should not be in cooldown anymore
    expect(isInCooldown(hash, mockState)).toBe(false)
    
    // Can add again
    addToCooldown(hash, mockState, mockConfig)
    expect(isInCooldown(hash, mockState)).toBe(true)
  })
})
