import { describe, it, expect, afterEach, mock, spyOn } from 'bun:test'
import { createBlockerTool } from '../../src/tools/blocker'
import * as blockersFile from '../../src/utils/blockers-file'
import { getState, cleanupState } from '../../src/state'
import { BLOCKER_RESPONSE_MESSAGE } from '../../src/utils/templates'

const sessionID = 'test-blocker-tool-session'

const config = {
  enabled: true,
  defaultDivertBlockers: false,
  blockersFile: '/tmp/BLOCKERS.md',
  maxBlockersPerRun: 50,
  cooldownMs: 5000,
  maxReprompts: 5,
  repromptWindowMs: 300000,
  completionMarker: 'BLOCKER_DIVERTER_DONE!',
  promptTimeoutMs: 30000,
}

const logClient = {
  app: {
    log: mock(() => Promise.resolve()),
  },
}

describe('tools/blocker', () => {
  afterEach(() => {
    cleanupState(sessionID)
    mock.restore()
  })

  it('retries write once before queuing pending blocker', async () => {
    const appendSpy = spyOn(blockersFile, 'appendBlocker')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const state = getState(sessionID)
    state.divertBlockers = true

    const blockerTool = createBlockerTool(logClient as any, config as any, '/tmp')

    const result = await blockerTool.execute(
      {
        question: 'Need decision on dependency majors',
        category: 'question',
      },
      { sessionID } as any,
    )

    expect(result).toBe(BLOCKER_RESPONSE_MESSAGE)
    expect(appendSpy).toHaveBeenCalledTimes(2)
    expect(state.blockers).toHaveLength(1)
    expect(state.pendingWrites).toHaveLength(0)
  })

  it('logs blockers even when divertBlockers is false', async () => {
    const appendSpy = spyOn(blockersFile, 'appendBlocker').mockResolvedValue(true)

    const state = getState(sessionID)
    state.divertBlockers = false

    const blockerTool = createBlockerTool(logClient as any, config as any, '/tmp')

    const result = await blockerTool.execute(
      {
        question: 'Can still log when diverter is off',
        category: 'question',
      },
      { sessionID } as any,
    )

    expect(result).toBe(BLOCKER_RESPONSE_MESSAGE)
    expect(appendSpy).toHaveBeenCalledTimes(1)
    expect(state.blockers).toHaveLength(1)
  })

  it('flushes queued pending blockers after a successful write', async () => {
    const appendSpy = spyOn(blockersFile, 'appendBlocker').mockResolvedValue(true)

    const state = getState(sessionID)
    state.divertBlockers = true
    state.pendingWrites.push({
      id: 'queued-1',
      timestamp: new Date().toISOString(),
      sessionId: sessionID,
      category: 'question',
      question: 'Queued blocker',
      context: 'queued context',
      blocksProgress: true,
    })

    const blockerTool = createBlockerTool(logClient as any, config as any, '/tmp')

    const result = await blockerTool.execute(
      {
        question: 'Current blocker write',
        category: 'question',
      },
      { sessionID } as any,
    )

    expect(result).toBe(BLOCKER_RESPONSE_MESSAGE)
    expect(appendSpy).toHaveBeenCalledTimes(2)
    expect(state.pendingWrites).toHaveLength(0)
    expect(state.blockers).toHaveLength(1)
  })
})
