/**
 * Shared Test Fixtures for E2E Integration Tests
 * 
 * Provides mock context setup, type definitions, and helper utilities
 * for all E2E test suites.
 * 
 * @module tests/integration/fixtures
 */

import { mock, spyOn } from 'bun:test'
import type { Permission } from '@opencode-ai/sdk'
import * as blockersFile from '../../src/utils/blockers-file'
import * as configModule from '../../src/config'
import { resolve } from 'node:path'

// ============================================================================
// Type Definitions (NO any TYPES)
// ============================================================================

interface MockAppLog {
  log: ReturnType<typeof mock>
}

interface MockSessionPrompt {
  prompt: ReturnType<typeof mock>
}

interface MockClient {
  app: MockAppLog
  session: MockSessionPrompt
}

interface MockProject {
  id: string
  worktree: string
  vcs: string
  name: string
}

interface MockShell {
  text: ReturnType<typeof mock>
}

export interface MockPluginContext {
  client: MockClient
  project: MockProject
  $: ReturnType<typeof mock>
  directory: string
  worktree: string
}

export interface TestSpies {
  appendBlockerSpy: ReturnType<typeof spyOn>
  loadConfigSpy: ReturnType<typeof spyOn>
}

// ============================================================================
// Constants
// ============================================================================

export const TEST_PROJECT_DIR = '/test/project'
export const TEST_SESSION_ID = 'e2e-test-session'

// ============================================================================
// Mock Context Factory
// ============================================================================

/**
 * Creates a realistic mock context that mimics OpenCode SDK environment
 */
export function createMockContext(): MockPluginContext {
  return {
    client: {
      app: {
        log: mock(() => Promise.resolve()),
      },
      session: {
        prompt: mock(() => Promise.resolve()),
      },
    },
    project: {
      id: 'test-project',
      worktree: TEST_PROJECT_DIR,
      vcs: 'git',
      name: 'test-project',
    },
    $: mock(() => ({
      text: mock(() => Promise.resolve('')),
    })),
    directory: TEST_PROJECT_DIR,
    worktree: TEST_PROJECT_DIR,
  }
}

// ============================================================================
// Spy Setup
// ============================================================================

/**
 * Sets up required spies for filesystem and config operations
 */
export function setupSpies(): TestSpies {
  const appendBlockerSpy = spyOn(blockersFile, 'appendBlocker').mockResolvedValue(true)
  
  const loadConfigSpy = spyOn(configModule, 'loadConfig').mockResolvedValue({
    enabled: true,
    defaultDivertBlockers: true,
    blockersFile: resolve(TEST_PROJECT_DIR, './blockers.md'),
    maxBlockersPerRun: 50,
    cooldownMs: 30000,
    maxReprompts: 5,
    repromptWindowMs: 120000,
    completionMarker: 'BLOCKER_DIVERTER_DONE!',
  })

  return { appendBlockerSpy, loadConfigSpy }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a test Permission object with default values
 */
export function createPermission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: 'perm-test',
    type: 'bash',
    sessionID: TEST_SESSION_ID,
    messageID: 'msg-test',
    callID: 'call-test',
    title: 'Test permission',
    metadata: {
      tool: 'bash',
      args: { command: 'test' },
    },
    time: {
      created: Date.now(),
    },
    ...overrides,
  }
}

/**
 * Creates a permission output object for testing
 */
export function createPermissionOutput() {
  return { status: 'ask' as 'allow' | 'deny' | 'ask' }
}
