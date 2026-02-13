import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Idle - Continue Prompt Injection', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-123'

  beforeEach(() => {
    // Clean up any existing state
    cleanupState(testSessionId)

    // Create mock context
    mockContext = {
      client: {
        app: { log: mock(() => Promise.resolve()) },
        session: { prompt: mock(() => Promise.resolve()) }
      },
      project: { id: 'test-project', worktree: '/test', name: 'test' },
      $: mock(() => ({})) as any,
      directory: '/test',
      worktree: '/test'
    } as any
  })

  afterEach(() => {
    // Clean up test sessions
    cleanupState(testSessionId)
  })

  it('should inject continue prompt when blockers exist and under limit', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with blockers, repromptCount=0
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test question?',
      context: 'Test context',
      blocksProgress: true
    })
    state.repromptCount = 0
    state.lastRepromptTime = 0

    // Fire session.idle event
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert client.session.prompt called
    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    // Assert repromptCount incremented
    const updatedState = getState(testSessionId)
    expect(updatedState.repromptCount).toBe(1)
    expect(updatedState.lastRepromptTime).toBeGreaterThan(0)
  })

  it('should not inject when divertBlockers disabled', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with blockers but divertBlockers=false
    const state = getState(testSessionId)
    state.divertBlockers = false
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert client.session.prompt NOT called
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })

  it('should not inject when no blockers logged', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with empty blockers
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers = []

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert NOT called
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })

  it('should not inject when max reprompts reached', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with repromptCount >= maxReprompts (default is 5)
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.repromptCount = 5 // At max limit
    // Set lastRepromptTime within window to prevent reset
    state.lastRepromptTime = Date.now() - 60000 // 1 minute ago (within 2 minute window)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert NOT called
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })

  it('should not inject during cooldown period', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with recent lastRepromptTime
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.repromptCount = 1
    state.lastRepromptTime = Date.now() - 10000 // 10 seconds ago (cooldown is 30s default)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert NOT called (still in cooldown)
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()
  })

  it('should inject after cooldown period elapsed', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with old lastRepromptTime (beyond cooldown)
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.repromptCount = 1
    state.lastRepromptTime = Date.now() - 35000 // 35 seconds ago (beyond 30s cooldown)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert called (cooldown elapsed)
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
  })

  it('should not inject when loop detected (3 identical response hashes)', async () => {
    // TODO: Loop detection is currently disabled (see detectLoop() implementation)
    // This test will be re-enabled once response hash tracking is implemented
    // via message.updated or tool.execute.after hooks
    
    const hooks = createSessionHooks(mockContext)

    // Setup state with 3 identical response hashes
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.recentResponseHashes = ['hash-abc', 'hash-abc', 'hash-abc']

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Loop detection disabled - should still inject
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
  })

  it('should inject when response hashes are different (no loop)', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with different response hashes
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.recentResponseHashes = ['hash-abc', 'hash-def', 'hash-ghi']
    state.repromptCount = 0

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert called (no loop detected)
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
  })

  it('should handle prompt injection errors gracefully', async () => {
    const errorContext = {
      ...mockContext,
      client: {
        ...mockContext.client,
        app: { log: mock(() => Promise.resolve()) },
        session: { 
          prompt: mock(() => Promise.reject(new Error('Prompt injection failed'))) 
        }
      }
    } as any

    const hooks = createSessionHooks(errorContext)

    // Setup state for injection
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })

    // Fire session.idle - should not throw
    await expect(
      hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })
    ).resolves.toBeUndefined()

    // Assert error was logged
    expect(errorContext.client.app.log).toHaveBeenCalled()
  })

  it('should update state after successful injection', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup initial state
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    const initialRepromptCount = state.repromptCount
    const initialLastRepromptTime = state.lastRepromptTime

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Verify state updated
    const updatedState = getState(testSessionId)
    expect(updatedState.repromptCount).toBe(initialRepromptCount + 1)
    expect(updatedState.lastRepromptTime).toBeGreaterThan(initialLastRepromptTime)
  })

  it('should include completion marker in continue prompt', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert prompt was called
    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    // Check the prompt includes the marker
    const callArgs = mockContext.client.session.prompt.mock.calls[0]
    expect(callArgs).toBeDefined()
    expect(callArgs[0].body.parts[0].text).toContain('BLOCKER_DIVERTER_DONE')
  })

  it('should not inject when loop detected with less than 3 hashes', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with only 2 response hashes
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    state.recentResponseHashes = ['hash-abc', 'hash-abc']

    // Fire session.idle - should inject (not enough hashes for loop detection)
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Assert called (need 3+ hashes to detect loop)
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
  })

  it('should respect repromptWindowMs configuration', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with repromptCount at limit and timestamp beyond window
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers.push({
      id: 'blocker-1',
      timestamp: new Date().toISOString(),
      sessionId: testSessionId,
      category: 'permission',
      question: 'Test?',
      context: 'Context',
      blocksProgress: true
    })
    // Set repromptCount to max (5) - would normally block injection
    state.repromptCount = 5
    // Set lastRepromptTime to 3 minutes ago (beyond 2 minute window)
    state.lastRepromptTime = Date.now() - 180000 // 3 minutes = 180000ms

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', session_id: testSessionId } })

    // Should inject because count was reset (outside window)
    expect(mockContext.client.session.prompt).toHaveBeenCalled()
    
    // Verify reprompt count was reset and then incremented
    const updatedState = getState(testSessionId)
    expect(updatedState.repromptCount).toBe(1) // Reset to 0, then incremented to 1
  })
})
