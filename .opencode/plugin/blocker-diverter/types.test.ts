import { describe, it, expect } from 'bun:test'
import type {
  BlockerCategory,
  Blocker,
  SessionState,
  PluginConfig,
  Plugin
} from './types'

describe('types.ts', () => {
  describe('BlockerCategory', () => {
    it('should allow valid category values', () => {
      const categories: BlockerCategory[] = [
        'permission',
        'architecture',
        'security',
        'destructive',
        'question',
        'other'
      ]
      
      expect(categories).toHaveLength(6)
      expect(categories).toContain('permission')
      expect(categories).toContain('architecture')
    })
  })

  describe('Blocker interface', () => {
    it('should accept a valid blocker object with required fields', () => {
      const blocker: Blocker = {
        id: 'blocker-123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-456',
        category: 'permission',
        question: 'Should I allow external directory access?',
        context: 'Task: Install dependencies',
        blocksProgress: true
      }

      expect(blocker.id).toBe('blocker-123')
      expect(blocker.category).toBe('permission')
      expect(blocker.blocksProgress).toBe(true)
    })

    it('should accept a blocker with optional fields', () => {
      const blocker: Blocker = {
        id: 'blocker-789',
        timestamp: '2026-02-12T10:05:00Z',
        sessionId: 'session-456',
        category: 'question',
        question: 'Which naming convention?',
        context: 'Creating new component',
        blocksProgress: false,
        options: ['camelCase', 'PascalCase', 'snake_case'],
        chosenOption: 'camelCase',
        chosenReasoning: 'Follows project convention',
        clarified: 'clarified',
        clarification: 'Use camelCase for consistency'
      }

      expect(blocker.options).toHaveLength(3)
      expect(blocker.chosenOption).toBe('camelCase')
      expect(blocker.clarified).toBe('clarified')
    })

    it('should validate clarified status values', () => {
      const statuses: Array<'pending' | 'clarified' | 'skipped'> = [
        'pending',
        'clarified',
        'skipped'
      ]

      const blocker: Blocker = {
        id: 'test',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'test',
        category: 'other',
        question: 'test',
        context: 'test',
        blocksProgress: false,
        clarified: statuses[0]
      }

      expect(blocker.clarified).toBe('pending')
    })
  })

  describe('SessionState interface', () => {
    it('should accept a valid session state object', () => {
      const state: SessionState = {
        enabled: true,
        divertBlockers: true,
        blockers: [],
        cooldownHashes: new Set<string>(),
        lastBlockerTime: Date.now(),
        repromptCount: 0,
        recentResponseHashes: [],
        lastRepromptTime: 0
      }

      expect(state.enabled).toBe(true)
      expect(state.divertBlockers).toBe(true)
      expect(state.blockers).toBeArray()
      expect(state.cooldownHashes).toBeInstanceOf(Set)
      expect(state.recentResponseHashes).toBeArray()
    })

    it('should accept session state with populated data', () => {
      const now = Date.now()
      const state: SessionState = {
        enabled: true,
        divertBlockers: false,
        blockers: [
          {
            id: 'b1',
            timestamp: '2026-02-12T10:00:00Z',
            sessionId: 's1',
            category: 'security',
            question: 'Should I proceed with deletion?',
            context: 'Deleting files',
            blocksProgress: true
          }
        ],
        cooldownHashes: new Set(['hash1', 'hash2']),
        lastBlockerTime: now,
        repromptCount: 3,
        recentResponseHashes: ['resp1', 'resp2'],
        lastRepromptTime: now - 5000
      }

      expect(state.blockers).toHaveLength(1)
      expect(state.cooldownHashes.size).toBe(2)
      expect(state.repromptCount).toBe(3)
      expect(state.recentResponseHashes).toHaveLength(2)
    })
  })

  describe('PluginConfig interface', () => {
    it('should accept a valid plugin configuration', () => {
      const config: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'blockers.md',
        maxBlockersPerRun: 20,
        cooldownMs: 30000,
        maxReprompts: 5,
        repromptWindowMs: 300000,
        completionMarker: '<!-- BLOCKER_SESSION_COMPLETE -->'
      }

      expect(config.enabled).toBe(true)
      expect(config.defaultDivertBlockers).toBe(true)
      expect(config.blockersFile).toBe('blockers.md')
      expect(config.maxBlockersPerRun).toBe(20)
      expect(config.cooldownMs).toBe(30000)
      expect(config.maxReprompts).toBe(5)
      expect(config.repromptWindowMs).toBe(300000)
      expect(config.completionMarker).toContain('BLOCKER')
    })

    it('should accept different configuration values', () => {
      const config: PluginConfig = {
        enabled: false,
        defaultDivertBlockers: false,
        blockersFile: 'custom/path/blockers.log',
        maxBlockersPerRun: 50,
        cooldownMs: 60000,
        maxReprompts: 10,
        repromptWindowMs: 600000,
        completionMarker: '<!-- DONE -->'
      }

      expect(config.enabled).toBe(false)
      expect(config.maxBlockersPerRun).toBe(50)
      expect(config.cooldownMs).toBe(60000)
    })
  })

  describe('Plugin type re-export', () => {
    it('should export Plugin type from @opencode-ai/plugin', () => {
      // Type test - this will fail at compile time if Plugin is not exported
      const pluginFactory: Plugin = async ({ client, project, $, directory, worktree }) => {
        return {}
      }

      expect(typeof pluginFactory).toBe('function')
    })
  })

  describe('Type exports', () => {
    it('should export all required types', () => {
      // This test verifies that all types are properly exported
      // by attempting to import and use them
      const category: BlockerCategory = 'permission'
      const blocker: Blocker = {
        id: 'test',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'test',
        category: 'other',
        question: 'test',
        context: 'test',
        blocksProgress: false
      }
      const state: SessionState = {
        enabled: true,
        divertBlockers: true,
        blockers: [],
        cooldownHashes: new Set(),
        lastBlockerTime: 0,
        repromptCount: 0,
        recentResponseHashes: [],
        lastRepromptTime: 0
      }
      const config: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'test.md',
        maxBlockersPerRun: 20,
        cooldownMs: 30000,
        maxReprompts: 5,
        repromptWindowMs: 300000,
        completionMarker: '<!-- TEST -->'
      }

      expect(category).toBe('permission')
      expect(blocker.id).toBe('test')
      expect(state.enabled).toBe(true)
      expect(config.enabled).toBe(true)
    })
  })

  describe('Type Safety (Compile-time validation)', () => {
    it('should verify TypeScript catches invalid BlockerCategory values', () => {
      // Valid category - should compile
      const validCategory: BlockerCategory = 'permission'
      expect(validCategory).toBe('permission')
      
      // Invalid category - TypeScript should reject this at compile time
      // @ts-expect-error - should not allow invalid category
      const invalidCategory: BlockerCategory = 'invalid'
      
      // @ts-expect-error - should not allow numeric values
      const numericCategory: BlockerCategory = 123
      
      // @ts-expect-error - should not allow empty string
      const emptyCategory: BlockerCategory = ''
    })

    it('should verify TypeScript catches missing required Blocker fields', () => {
      // @ts-expect-error - missing all required fields
      const emptyBlocker: Blocker = {}
      
      // @ts-expect-error - missing timestamp, sessionId, category, question, context, blocksProgress
      const partialBlocker1: Blocker = {
        id: '123'
      }
      
      // @ts-expect-error - missing blocksProgress
      const partialBlocker2: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test question',
        context: 'test context'
      }
      
      // Valid blocker for comparison
      const validBlocker: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test question',
        context: 'test context',
        blocksProgress: true
      }
      
      expect(validBlocker.id).toBe('123')
    })

    it('should verify TypeScript catches invalid clarified status values', () => {
      // @ts-expect-error - invalid clarified status
      const invalidStatus1: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test',
        context: 'test',
        blocksProgress: true,
        clarified: 'invalid'
      }
      
      // @ts-expect-error - numeric value not allowed
      const invalidStatus2: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test',
        context: 'test',
        blocksProgress: true,
        clarified: 1
      }
      
      // @ts-expect-error - boolean not allowed
      const invalidStatus3: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test',
        context: 'test',
        blocksProgress: true,
        clarified: true
      }
      
      // Valid clarified values
      const validPending: Blocker = {
        id: '123',
        timestamp: '2026-02-12T10:00:00Z',
        sessionId: 'session-1',
        category: 'permission',
        question: 'test',
        context: 'test',
        blocksProgress: true,
        clarified: 'pending'
      }
      
      expect(validPending.clarified).toBe('pending')
    })

    it('should verify TypeScript catches invalid SessionState fields', () => {
      // @ts-expect-error - enabled must be boolean
      const invalidEnabled: SessionState = {
        enabled: 'true',
        divertBlockers: true,
        blockers: [],
        cooldownHashes: new Set(),
        lastBlockerTime: 0,
        repromptCount: 0,
        recentResponseHashes: [],
        lastRepromptTime: 0
      }
      
      // @ts-expect-error - blockers must be array
      const invalidBlockers: SessionState = {
        enabled: true,
        divertBlockers: true,
        blockers: 'not an array',
        cooldownHashes: new Set(),
        lastBlockerTime: 0,
        repromptCount: 0,
        recentResponseHashes: [],
        lastRepromptTime: 0
      }
      
      // @ts-expect-error - cooldownHashes must be Set
      const invalidCooldown: SessionState = {
        enabled: true,
        divertBlockers: true,
        blockers: [],
        cooldownHashes: [],
        lastBlockerTime: 0,
        repromptCount: 0,
        recentResponseHashes: [],
        lastRepromptTime: 0
      }
    })

    it('should verify TypeScript catches invalid PluginConfig field types', () => {
      // @ts-expect-error - maxBlockersPerRun must be number
      const invalidMaxBlockers: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'test.md',
        maxBlockersPerRun: '20',
        cooldownMs: 30000,
        maxReprompts: 5,
        repromptWindowMs: 300000,
        completionMarker: '<!-- TEST -->'
      }
      
      // @ts-expect-error - blockersFile must be string
      const invalidFile: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 123,
        maxBlockersPerRun: 20,
        cooldownMs: 30000,
        maxReprompts: 5,
        repromptWindowMs: 300000,
        completionMarker: '<!-- TEST -->'
      }
      
      // @ts-expect-error - missing required fields
      const incomplete: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true
      }
    })
  })
})
