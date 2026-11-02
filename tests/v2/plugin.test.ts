/**
 * Unit tests for the OpenCode 2.x adapter (src/v2) against a fake v2 context.
 *
 * The fake records every registration and lets tests fire events. Config and log
 * paths are redirected into a temp directory so nothing touches the real HOME.
 *
 * @module tests/v2/plugin
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../../index'
import { setupV2, nextRetryDelay } from '../../src/v2/plugin'
import { loadConfigV2 } from '../../src/v2/config'
import type {
  V2CommandDefinition,
  V2Context,
  V2EventEnvelope,
  V2ExecuteBeforeEvent,
  V2ContextEvent,
  V2PermissionEvaluation,
  V2PromptEvent,
  V2ToolDefinition,
} from '../../src/v2/types'
import { getState, hasState, cleanupState } from '../../src/state'

type Hook<E> = (event: E) => void | Promise<void>

interface Registry {
  tools: V2ToolDefinition[]
  toolBefore: Hook<V2ExecuteBeforeEvent>[]
  permission: Hook<V2PermissionEvaluation>[]
  prompt: Hook<V2PromptEvent>[]
  context: Hook<V2ContextEvent>[]
  compaction: Hook<V2ContextEvent>[]
  commands: V2CommandDefinition[]
  prompts: { sessionID: string; text: string; delivery?: string }[]
  synthetics: { sessionID: string; text: string }[]
}

interface FakeHost {
  ctx: V2Context
  reg: Registry
  emit: (event: V2EventEnvelope) => void
  projectDir: string
}

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'bd-v2-test-'))
const ENV_KEYS = ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'OPENCODE_CONFIG_DIR'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  // Bun shares module spies across test files; earlier suites leave appendBlocker mocked.
  mock.restore()
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.XDG_CONFIG_HOME = join(TMP_ROOT, 'config')
  process.env.XDG_STATE_HOME = join(TMP_ROOT, 'state')
  delete process.env.OPENCODE_CONFIG_DIR
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  rmSync(TMP_ROOT, { recursive: true, force: true })
})

let fixtureCount = 0
const cleanups: Array<() => Promise<void> | void> = []

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function createFakeHost(options: Record<string, unknown> = {}): FakeHost {
  fixtureCount++
  const projectDir = join(TMP_ROOT, `project-${fixtureCount}`)
  mkdirSync(projectDir, { recursive: true })

  const reg: Registry = {
    tools: [],
    toolBefore: [],
    permission: [],
    prompt: [],
    context: [],
    compaction: [],
    commands: [],
    prompts: [],
    synthetics: [],
  }
  const listeners = new Set<(event: V2EventEnvelope) => void>()

  const subscribe = (subscription: { signal?: AbortSignal }): AsyncIterable<V2EventEnvelope> => {
    const buffer: V2EventEnvelope[] = []
    let wake: (() => void) | undefined
    const onEvent = (event: V2EventEnvelope) => {
      buffer.push(event)
      wake?.()
    }
    listeners.add(onEvent)
    subscription.signal?.addEventListener('abort', () => {
      listeners.delete(onEvent)
      wake?.()
    })
    return {
      async *[Symbol.asyncIterator]() {
        while (!subscription.signal?.aborted) {
          if (buffer.length === 0) await new Promise<void>((resolve) => (wake = resolve))
          while (buffer.length > 0) yield buffer.shift() as V2EventEnvelope
        }
      },
    }
  }

  const ctx = {
    options,
    location: { directory: projectDir, project: { directory: projectDir } },
    tool: {
      transform: async (callback: (editor: { add(tool: V2ToolDefinition): void }) => void) => {
        callback({ add: (tool) => reg.tools.push(tool) })
        return {}
      },
      hook: async (_name: 'execute.before', callback: Hook<V2ExecuteBeforeEvent>) => {
        reg.toolBefore.push(callback)
        return {}
      },
    },
    permission: {
      hook: async (_name: 'evaluate', callback: Hook<V2PermissionEvaluation>) => {
        reg.permission.push(callback)
        return {}
      },
    },
    session: {
      hook: async (name: 'prompt' | 'context' | 'compaction', callback: Hook<never>) => {
        reg[name].push(callback as never)
        return {}
      },
      prompt: async (input: { sessionID: string; text: string; delivery?: string }) => {
        reg.prompts.push(input)
        return {}
      },
      synthetic: async (input: { sessionID: string; text: string }) => {
        reg.synthetics.push(input)
        return {}
      },
    },
    command: {
      transform: async (callback: (editor: { add(command: V2CommandDefinition): void }) => void) => {
        callback({ add: (command) => reg.commands.push(command) })
        return {}
      },
    },
    event: { subscribe },
  } as unknown as V2Context

  return {
    ctx,
    reg,
    projectDir,
    emit: (event) => listeners.forEach((listener) => listener(event)),
  }
}

async function start(options: Record<string, unknown> = {}): Promise<FakeHost & { sessionID: string; cleanup: () => Promise<void> }> {
  const host = createFakeHost(options)
  const cleanup = await setupV2(host.ctx)
  if (!cleanup) throw new Error('setupV2 returned no cleanup')
  cleanups.push(cleanup)
  await settle()
  const sessionID = `ses-${fixtureCount}-${Math.random().toString(36).slice(2, 8)}`
  return { ...host, sessionID, cleanup }
}

function findHook<E>(hooks: Hook<E>[]): Hook<E> {
  const hook = hooks[0]
  if (!hook) throw new Error('hook not registered')
  return hook
}

/** Mirrors a real session: the created event applies the default before a test sets state. */
async function prime(emit: (event: V2EventEnvelope) => void, sessionID: string): Promise<void> {
  emit({ type: 'session.created', data: { sessionID } })
  await settle()
}

function findCommand(reg: Registry, name: string): V2CommandDefinition {
  const command = reg.commands.find((item) => item.name === name)
  if (!command) throw new Error(`command not registered: ${name}`)
  return command
}

function blockersFileOf(projectDir: string): string {
  return join(projectDir, 'BLOCKERS.md')
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    await cleanup?.()
  }
})

describe('v2 loader shape', () => {
  it('default export has id, setup and the v1 server entry', () => {
    expect(plugin.id).toBe('opencode-blocker-diverter')
    expect(typeof plugin.setup).toBe('function')
    expect(typeof plugin.server).toBe('function')
  })

  it('registers the blocker tool, hooks and commands', async () => {
    const { reg } = await start()
    expect(reg.tools.map((tool) => tool.name)).toEqual(['blocker'])
    expect(reg.toolBefore).toHaveLength(1)
    expect(reg.permission).toHaveLength(1)
    expect(reg.prompt).toHaveLength(1)
    expect(reg.context).toHaveLength(1)
    expect(reg.compaction).toHaveLength(1)
    expect(reg.commands.map((command) => command.name)).toEqual([
      'blockers.on',
      'blockers.off',
      'blockers.stop',
      'blockers.status',
    ])
  })

  it('registers nothing when disabled by options', async () => {
    const host = createFakeHost({ enabled: false })
    const cleanup = await setupV2(host.ctx)
    expect(cleanup).toBeUndefined()
    expect(host.reg.tools).toHaveLength(0)
    expect(host.reg.toolBefore).toHaveLength(0)
    expect(host.reg.commands).toHaveLength(0)
  })
})

describe('question interception (execute.before)', () => {
  it('lets the question tool through when divert is off', async () => {
    const { reg, sessionID } = await start()
    const hook = findHook(reg.toolBefore)
    await expect(
      hook({ tool: 'question', sessionID, agent: 'build', messageID: 'm', id: 'c1', input: {} })
    ).resolves.toBeUndefined()
  })

  it('blocks the question tool when divert is on and logs a blocker', async () => {
    const { reg, sessionID, projectDir, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    const hook = findHook(reg.toolBefore)
    await expect(
      hook({ tool: 'question', sessionID, agent: 'build', messageID: 'm', id: 'c2', input: {} })
    ).rejects.toThrow('Autonomous mode is active')
    expect(getState(sessionID).blockers).toHaveLength(1)
    expect(existsSync(blockersFileOf(projectDir))).toBe(true)
  })

  it('never blocks other tools', async () => {
    const { reg, sessionID } = await start()
    getState(sessionID).divertBlockers = true
    const hook = findHook(reg.toolBefore)
    await expect(
      hook({ tool: 'shell', sessionID, agent: 'build', messageID: 'm', id: 'c3', input: {} })
    ).resolves.toBeUndefined()
  })
})

describe('permission hook (ask to allow, never deny)', () => {
  it('allows ask while divert is on', async () => {
    const { reg, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    const event: V2PermissionEvaluation = { sessionID, action: 'shell', effect: 'ask' }
    await findHook(reg.permission)(event)
    expect(event.effect).toBe('allow')
  })

  it('keeps ask while divert is off', async () => {
    const { reg, sessionID } = await start()
    const event: V2PermissionEvaluation = { sessionID, action: 'shell', effect: 'ask' }
    await findHook(reg.permission)(event)
    expect(event.effect).toBe('ask')
  })

  it('never overrides deny, even with divert on', async () => {
    const { reg, sessionID } = await start()
    getState(sessionID).divertBlockers = true
    const event: V2PermissionEvaluation = { sessionID, action: 'shell', effect: 'deny' }
    await findHook(reg.permission)(event)
    expect(event.effect).toBe('deny')
  })

  it('leaves allow untouched', async () => {
    const { reg, sessionID } = await start()
    getState(sessionID).divertBlockers = false
    const event: V2PermissionEvaluation = { sessionID, action: 'read', effect: 'allow' }
    await findHook(reg.permission)(event)
    expect(event.effect).toBe('allow')
  })

  it('keeps ask for unattended calls even while divert is on', async () => {
    const { reg, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    const event: V2PermissionEvaluation = { sessionID, action: 'shell', effect: 'ask', metadata: { unattended: true } }
    await findHook(reg.permission)(event)
    expect(event.effect).toBe('ask')
  })
})

describe('user prompt auto-disable (v1 chat.message parity)', () => {
  const prompt = (sessionID: string): V2PromptEvent => ({
    sessionID,
    messageID: 'msg',
    prompt: { text: 'hello' },
    delivery: 'steer',
  })

  it('keeps divert on for the first prompt of a fresh session', async () => {
    const { reg, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    await findHook(reg.prompt)(prompt(sessionID))
    expect(getState(sessionID).divertBlockers).toBe(true)
  })

  it('auto-disables divert once the assistant has produced text', async () => {
    const { reg, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.text.ended', data: { sessionID, text: 'working on it', assistantMessageID: 'a1' } })
    await settle()
    await findHook(reg.prompt)(prompt(sessionID))
    expect(getState(sessionID).divertBlockers).toBe(false)
    expect(getState(sessionID).repromptCount).toBe(0)
  })

  it('absorbs the command reply once (ignoreNextUserMessage)', async () => {
    const { reg, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.text.ended', data: { sessionID, text: 'working', assistantMessageID: 'a1' } })
    await settle()
    getState(sessionID).ignoreNextUserMessage = true
    await findHook(reg.prompt)(prompt(sessionID))
    expect(getState(sessionID).divertBlockers).toBe(true)
    expect(getState(sessionID).ignoreNextUserMessage).toBe(false)
  })
})

describe('system prompt and compaction', () => {
  it('injects blocker instructions only while divert is on', async () => {
    const { reg, sessionID } = await start()
    const off: V2ContextEvent = { sessionID, system: [] }
    await findHook(reg.context)(off)
    expect(off.system).toHaveLength(0)

    getState(sessionID).divertBlockers = true
    const on: V2ContextEvent = { sessionID, system: [] }
    await findHook(reg.context)(on)
    expect(on.system).toHaveLength(2)
    expect(on.system[0]?.text).toContain('blocker-diverter-mode enabled')
    expect(on.system[1]?.text).toContain('<tools>')
  })

  it('applies defaultDivertBlockers to a session whose created event was missed', async () => {
    const { reg } = await start({ defaultDivertBlockers: true })
    const event: V2ContextEvent = { sessionID: `missed-created-${fixtureCount}`, system: [] }
    await findHook(reg.context)(event)
    expect(event.system).toHaveLength(2)
  })

  it('adds the blocker summary to compaction', async () => {
    const { reg, sessionID } = await start()
    const event: V2ContextEvent = { sessionID, system: [] }
    await findHook(reg.compaction)(event)
    expect(event.system[0]?.text).toContain('<active-blockers>')
  })
})

describe('blocker tool', () => {
  it('writes the blockers file and records the blocker in state', async () => {
    const { reg, sessionID, projectDir } = await start()
    const tool = reg.tools[0]
    if (!tool) throw new Error('blocker tool missing')
    const result = await tool.execute(
      {
        question: 'Use RS256 or HS256 for JWT?',
        category: 'architecture',
        context: 'Task: #3 | Files: src/auth.ts:45',
        blocksProgress: true,
      },
      { sessionID }
    )
    expect(result.content).toContain('blocker registered')
    expect(getState(sessionID).blockers).toHaveLength(1)
    expect(readFileSync(blockersFileOf(projectDir), 'utf8')).toContain('Use RS256 or HS256 for JWT?')
  })

  it('rejects invalid arguments', async () => {
    const { reg, sessionID } = await start()
    const tool = reg.tools[0]
    if (!tool) throw new Error('blocker tool missing')
    await expect(tool.execute({ question: '', category: 'other' }, { sessionID })).rejects.toThrow()
  })
})

describe('commands', () => {
  it('/blockers.on enables divert and replies through a prompt', async () => {
    const { reg, sessionID } = await start()
    await findCommand(reg, 'blockers.on').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    expect(getState(sessionID).divertBlockers).toBe(true)
    expect(reg.prompts.at(-1)?.text).toBe('Blocker diverter enabled. No further action needed.')
  })

  it('the reply to /blockers.on does not turn divert off', async () => {
    const { reg, sessionID, emit } = await start()
    emit({ type: 'session.text.ended', data: { sessionID, text: 'earlier answer', assistantMessageID: 'a0' } })
    await settle()
    await findCommand(reg, 'blockers.on').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    await findHook(reg.prompt)({ sessionID, messageID: 'm', prompt: { text: 'reply' }, delivery: 'steer' })
    expect(getState(sessionID).divertBlockers).toBe(true)
  })

  it('/blockers.off and /blockers.stop disable divert', async () => {
    const { reg, sessionID } = await start()
    getState(sessionID).divertBlockers = true
    await findCommand(reg, 'blockers.off').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    expect(getState(sessionID).divertBlockers).toBe(false)

    getState(sessionID).divertBlockers = true
    await findCommand(reg, 'blockers.stop').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    expect(getState(sessionID).divertBlockers).toBe(false)
  })

  it('/blockers.status reports the current state', async () => {
    const { reg, sessionID } = await start()
    await findCommand(reg, 'blockers.status').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    expect(reg.prompts.at(-1)?.text).toContain('disabled')
  })

  it('a failed reply clears ignoreNextUserMessage so the next real prompt is not absorbed', async () => {
    const { reg, ctx, sessionID, emit } = await start()
    await prime(emit, sessionID)
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.text.ended', data: { sessionID, text: 'working', assistantMessageID: 'a1' } })
    await settle()
    ctx.session.prompt = async () => {
      throw new Error('reply rejected')
    }
    await expect(
      findCommand(reg, 'blockers.on').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    ).rejects.toThrow('reply rejected')
    expect(getState(sessionID).ignoreNextUserMessage).toBe(false)

    await findHook(reg.prompt)({ sessionID, messageID: 'm', prompt: { text: 'real' }, delivery: 'steer' })
    expect(getState(sessionID).divertBlockers).toBe(false)
  })
})

describe('session lifecycle and continue prompts', () => {
  it('session.created inherits divert from a parent session', async () => {
    const { sessionID, emit } = await start()
    const parentID = `parent-${sessionID}`
    getState(parentID).divertBlockers = true
    const childID = `child-${sessionID}`
    emit({ type: 'session.created', data: { sessionID: childID, parentID } })
    await settle()
    expect(getState(childID).divertBlockers).toBe(true)
    cleanupState(parentID)
    cleanupState(childID)
  })

  it('session.deleted clears that session state', async () => {
    const { sessionID, emit } = await start()
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.deleted', data: { sessionID } })
    await settle()
    expect(hasState(sessionID)).toBe(false)
  })

  it('execution.succeeded injects a continue prompt, bounded by maxReprompts', async () => {
    const { reg, sessionID, emit } = await start({ maxReprompts: 1, cooldownMs: 1000 })
    getState(sessionID).divertBlockers = true

    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(1)
    expect(reg.synthetics[0]?.text).toContain('BLOCKER_DIVERTER_DONE!')

    getState(sessionID).lastRepromptTime = Date.now() - 60_000
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(1)
  })

  it('a reply inside the cooldown after a real continue prompt is retried, not dropped', async () => {
    const { reg, sessionID, emit } = await start({ maxReprompts: 5, cooldownMs: 1000 })
    getState(sessionID).divertBlockers = true

    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(1)

    // The model answers fast: the next idle arrives well inside the 1s cooldown.
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(reg.synthetics).toHaveLength(2)
  })

  it('a turn that starts during the cooldown wait cancels the retry', async () => {
    const { reg, sessionID, emit } = await start({ maxReprompts: 5, cooldownMs: 1000 })
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    emit({ type: 'session.text.ended', data: { sessionID, text: 'still working on it', assistantMessageID: 'a2' } })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(reg.synthetics).toHaveLength(1)
  })

  it('the idle right after /blockers.on is re-prompted once the cooldown is over', async () => {
    const { reg, sessionID, emit } = await start({ maxReprompts: 5, cooldownMs: 1000 })
    await findCommand(reg, 'blockers.on').execute({ sessionID, prompt: { text: '' }, delivery: 'steer' })
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(reg.synthetics).toHaveLength(1)
  })

  it('does not inject a continue prompt when divert is off', async () => {
    const { reg, sessionID, emit } = await start()
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(0)
  })

  it('completion marker in the last text stops the session without a continue prompt', async () => {
    const { reg, sessionID, emit } = await start()
    getState(sessionID).divertBlockers = true
    emit({
      type: 'session.text.ended',
      data: { sessionID, text: 'All done. BLOCKER_DIVERTER_DONE!', assistantMessageID: 'a1' },
    })
    await settle()
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(getState(sessionID).divertBlockers).toBe(false)
    expect(reg.synthetics).toHaveLength(0)
  })

  it('a failed execution skips the next idle reprompt', async () => {
    const { reg, sessionID, emit } = await start()
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.execution.failed', data: { sessionID, error: {} } })
    await settle()
    emit({ type: 'session.execution.succeeded', data: { sessionID } })
    await settle()
    expect(reg.synthetics).toHaveLength(0)
    expect(getState(sessionID).isRecovering).toBe(false)
  })

  it('a user interrupt disables divert, but a shutdown does not', async () => {
    const { sessionID, emit } = await start()
    getState(sessionID).divertBlockers = true
    emit({ type: 'session.execution.interrupted', data: { sessionID, reason: 'shutdown' } })
    await settle()
    expect(getState(sessionID).divertBlockers).toBe(true)

    emit({ type: 'session.execution.interrupted', data: { sessionID, reason: 'user' } })
    await settle()
    expect(getState(sessionID).divertBlockers).toBe(false)
  })
})

describe('child sessions', () => {
  it('turning divert off with /blockers.off clears every descendant', async () => {
    const { reg, sessionID: parent, emit } = await start()
    await prime(emit, parent)
    getState(parent).divertBlockers = true
    const child = `${parent}-child`
    const grandchild = `${parent}-grandchild`
    emit({ type: 'session.created', data: { sessionID: child, parentID: parent } })
    emit({ type: 'session.created', data: { sessionID: grandchild, parentID: child } })
    await settle()
    expect(getState(child).divertBlockers).toBe(true)
    expect(getState(grandchild).divertBlockers).toBe(true)

    await findCommand(reg, 'blockers.off').execute({ sessionID: parent, prompt: { text: '' }, delivery: 'steer' })
    expect(getState(parent).divertBlockers).toBe(false)
    expect(getState(child).divertBlockers).toBe(false)
    expect(getState(grandchild).divertBlockers).toBe(false)
  })

  it('a guard-style stop on a child clears only that child', async () => {
    const { sessionID: parent, emit } = await start()
    await prime(emit, parent)
    getState(parent).divertBlockers = true
    const child = `${parent}-child`
    emit({ type: 'session.created', data: { sessionID: child, parentID: parent } })
    await settle()
    emit({
      type: 'session.text.ended',
      data: { sessionID: child, text: 'All done. BLOCKER_DIVERTER_DONE!', assistantMessageID: 'a1' },
    })
    await settle()
    emit({ type: 'session.execution.succeeded', data: { sessionID: child } })
    await settle()
    expect(getState(child).divertBlockers).toBe(false)
    expect(getState(parent).divertBlockers).toBe(true)
  })

  it('a manual prompt on the parent clears its descendants', async () => {
    const { reg, sessionID: parent, emit } = await start()
    await prime(emit, parent)
    getState(parent).divertBlockers = true
    const child = `${parent}-child`
    emit({ type: 'session.created', data: { sessionID: child, parentID: parent } })
    emit({ type: 'session.text.ended', data: { sessionID: parent, text: 'working', assistantMessageID: 'a1' } })
    await settle()
    expect(getState(child).divertBlockers).toBe(true)

    await findHook(reg.prompt)({ sessionID: parent, messageID: 'm', prompt: { text: 'hi' }, delivery: 'steer' })
    expect(getState(parent).divertBlockers).toBe(false)
    expect(getState(child).divertBlockers).toBe(false)
  })

  it('a user interrupt on the parent clears its descendants', async () => {
    const { sessionID: parent, emit } = await start()
    await prime(emit, parent)
    getState(parent).divertBlockers = true
    const child = `${parent}-child`
    emit({ type: 'session.created', data: { sessionID: child, parentID: parent } })
    await settle()

    emit({ type: 'session.execution.interrupted', data: { sessionID: parent, reason: 'user' } })
    await settle()
    expect(getState(parent).divertBlockers).toBe(false)
    expect(getState(child).divertBlockers).toBe(false)
  })

  it('a deleted child is no longer a descendant', async () => {
    const { reg, sessionID: parent, emit } = await start()
    await prime(emit, parent)
    getState(parent).divertBlockers = true
    const child = `${parent}-child`
    emit({ type: 'session.created', data: { sessionID: child, parentID: parent } })
    await settle()
    emit({ type: 'session.deleted', data: { sessionID: child } })
    await settle()
    emit({ type: 'session.created', data: { sessionID: child } })
    await settle()
    getState(child).divertBlockers = true

    await findCommand(reg, 'blockers.off').execute({ sessionID: parent, prompt: { text: '' }, delivery: 'steer' })
    expect(getState(child).divertBlockers).toBe(true)
  })
})

describe('event stream failure (fail closed)', () => {
  it('turns divert off for tracked sessions, then resubscribes after the backoff', async () => {
    const host = createFakeHost()
    const subscribe = host.ctx.event.subscribe
    let subscriptions = 0
    let failStream: () => void = () => {}
    const gate = new Promise<void>((resolve) => (failStream = resolve))
    host.ctx.event.subscribe = (options) => {
      subscriptions++
      if (subscriptions > 1) return subscribe(options)
      return (async function* () {
        yield { type: 'session.created', data: { sessionID: 'fc-session' } }
        await gate
        throw new Error('connection reset')
      })()
    }
    const cleanup = await setupV2(host.ctx)
    if (!cleanup) throw new Error('no cleanup')
    cleanups.push(cleanup)
    await settle()

    getState('fc-session').divertBlockers = true
    failStream()
    await settle()
    expect(getState('fc-session').divertBlockers).toBe(false)
    expect(subscriptions).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(subscriptions).toBe(2)
    host.emit({ type: 'session.created', data: { sessionID: 'fc-after-resubscribe' } })
    await settle()
    expect(hasState('fc-after-resubscribe')).toBe(true)
  })

  it('treats a stream that ends without an abort as a failure', async () => {
    const host = createFakeHost()
    const subscribe = host.ctx.event.subscribe
    let subscriptions = 0
    let endStream: () => void = () => {}
    const gate = new Promise<void>((resolve) => (endStream = resolve))
    host.ctx.event.subscribe = (options) => {
      subscriptions++
      if (subscriptions > 1) return subscribe(options)
      return (async function* () {
        yield { type: 'session.created', data: { sessionID: 'end-session' } }
        await gate
      })()
    }
    const cleanup = await setupV2(host.ctx)
    if (!cleanup) throw new Error('no cleanup')
    cleanups.push(cleanup)
    await settle()

    getState('end-session').divertBlockers = true
    endStream()
    await settle()
    expect(getState('end-session').divertBlockers).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(subscriptions).toBe(2)
  })

  it('stops resubscribing once the plugin is disposed', async () => {
    const host = createFakeHost()
    let subscriptions = 0
    host.ctx.event.subscribe = () => {
      subscriptions++
      return (async function* () {
        throw new Error('connection reset')
      })()
    }
    const cleanup = await setupV2(host.ctx)
    if (!cleanup) throw new Error('no cleanup')
    await settle()
    await cleanup()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(subscriptions).toBe(1)
  })

  it('doubles the retry delay from 1s and caps it at 30s', () => {
    expect(nextRetryDelay(1_000)).toBe(2_000)
    expect(nextRetryDelay(16_000)).toBe(30_000)
    expect(nextRetryDelay(30_000)).toBe(30_000)
  })
})

describe('hooks ignore events without a string session ID', () => {
  it('neither acts nor creates session state', async () => {
    const { reg } = await start()
    const missing = undefined as unknown as string

    const permission: V2PermissionEvaluation = { sessionID: missing, action: 'shell', effect: 'ask' }
    await findHook(reg.permission)(permission)
    expect(permission.effect).toBe('ask')

    await expect(
      findHook(reg.toolBefore)({ tool: 'question', sessionID: '', agent: 'build', messageID: 'm', id: 'c4', input: {} })
    ).resolves.toBeUndefined()

    const context: V2ContextEvent = { sessionID: missing, system: [] }
    await findHook(reg.context)(context)
    expect(context.system).toHaveLength(0)

    await findHook(reg.compaction)({ sessionID: missing, system: [] })
    await findHook(reg.prompt)({ sessionID: missing, messageID: 'm', prompt: { text: 'hi' }, delivery: 'steer' })

    expect(hasState(missing)).toBe(false)
    expect(hasState('')).toBe(false)
  })
})

describe('cleanup', () => {
  it('clears all session state on unload', async () => {
    const host = createFakeHost()
    const cleanup = await setupV2(host.ctx)
    if (!cleanup) throw new Error('no cleanup')
    getState('cleanup-session').divertBlockers = true
    expect(hasState('cleanup-session')).toBe(true)
    await cleanup()
    expect(hasState('cleanup-session')).toBe(false)
  })
})

describe('config loading (v2 sources)', () => {
  it('defaults keep defaultDivertBlockers false', async () => {
    const dir = join(TMP_ROOT, `cfg-default-${++fixtureCount}`)
    mkdirSync(dir, { recursive: true })
    const config = await loadConfigV2(dir, {}, { app: { log: async () => {} } }, { XDG_CONFIG_HOME: join(dir, 'none') })
    expect(config.defaultDivertBlockers).toBe(false)
    expect(config.enabled).toBe(true)
  })

  it('reads the global file from OPENCODE_CONFIG_DIR and lets options override it', async () => {
    const dir = join(TMP_ROOT, `cfg-global-${++fixtureCount}`)
    const configDir = join(dir, 'opencode')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'blocker-diverter.json'), JSON.stringify({ maxBlockersPerRun: 7, cooldownMs: 2000 }))
    const config = await loadConfigV2(
      join(dir, 'project'),
      { cooldownMs: 3000 },
      { app: { log: async () => {} } },
      { OPENCODE_CONFIG_DIR: configDir }
    )
    expect(config.maxBlockersPerRun).toBe(7)
    expect(config.cooldownMs).toBe(3000)
  })

  it('falls back to defaults when the options are invalid', async () => {
    const dir = join(TMP_ROOT, `cfg-invalid-${++fixtureCount}`)
    mkdirSync(dir, { recursive: true })
    const config = await loadConfigV2(dir, { maxBlockersPerRun: 0 }, { app: { log: async () => {} } }, {
      XDG_CONFIG_HOME: join(dir, 'none'),
    })
    expect(config.maxBlockersPerRun).toBe(50)
  })
})
