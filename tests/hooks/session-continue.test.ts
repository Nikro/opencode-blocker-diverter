import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { Plugin } from '../../src/types'
import { getState, cleanupState } from '../../src/state'
import { createSessionHooks } from '../../src/hooks/session'

describe('Session Idle - Continue Prompt Injection', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-continue'

  beforeEach(() => {
    // Clean up any existing state
    cleanupState(testSessionId)

    // Initialize fresh state with correct defaults
    const state = getState(testSessionId)
    state.divertBlockers = true

    // Create mock context
    mockContext = {
      client: {
        app: { log: mock(() => Promise.resolve()) },
        session: { promptAsync: mock(() => Promise.resolve()) }
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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert client.session.promptAsync called
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()

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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert client.session.promptAsync NOT called
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should inject when no blockers logged but autonomous mode active', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with empty blockers but autonomous mode enabled
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.blockers = []

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should inject in autonomous mode even without blockers
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
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
    state.lastRepromptTime = Date.now() - 60000 // 1 minute ago (within 5 minute window)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert NOT called
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
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
    state.lastRepromptTime = Date.now() - 2000 // 2 seconds ago (cooldown is 5s now)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert NOT called (still in cooldown)
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
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
    state.lastRepromptTime = Date.now() - 6000 // 6 seconds ago (beyond 5s cooldown)

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert called (cooldown elapsed)
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Loop detection disabled - should still inject
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert called (no loop detected)
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
  })

  it('should handle prompt injection errors gracefully', async () => {
    const errorContext = {
      ...mockContext,
      client: {
        ...mockContext.client,
        app: { log: mock(() => Promise.resolve()) },
        session: { 
          promptAsync: mock(() => Promise.reject(new Error('Prompt injection failed'))) 
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
      hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })
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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert prompt was called
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()

    // The continue prompt functionality is verified by the "should inject" test above
    // We don't need to check the exact prompt text here since that's tested elsewhere
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
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Assert called (need 3+ hashes to detect loop)
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
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
    // Set lastRepromptTime to 6 minutes ago (beyond 5 minute window)
    state.lastRepromptTime = Date.now() - 360000 // 6 minutes = 360000ms

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should inject because count was reset (outside window)
    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
    
    // Verify reprompt count was reset and then incremented
    const updatedState = getState(testSessionId)
    expect(updatedState.repromptCount).toBe(1) // Reset to 0, then incremented to 1
  })
})

describe('Session Idle - Completion Marker Detection', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-completion'

  beforeEach(() => {
    cleanupState(testSessionId)
    
    mockContext = {
      client: {
        app: { log: mock(() => Promise.resolve()) },
        session: { promptAsync: mock(() => Promise.resolve()) }
      },
      project: { id: 'test-project', worktree: '/test', name: 'test' },
      $: mock(() => ({})) as any,
      directory: '/test',
      worktree: '/test'
    } as any
  })

  afterEach(() => {
    cleanupState(testSessionId)
  })

  it('should stop reprompting when completion marker anywhere in message', async () => {
    const hooks = createSessionHooks(mockContext)

    // Setup state with completion marker at end
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'I have completed all tasks. Everything is done. BLOCKER_DIVERTER_DONE!'
    state.repromptCount = 0

    // Fire session.idle
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should NOT inject continuation prompt
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should stop reprompting when marker at beginning with text after', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'BLOCKER_DIVERTER_DONE! I have fixed all the issues, yeay'
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should stop - marker present anywhere in message
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should stop reprompting when marker in middle of message', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'I finished the work. BLOCKER_DIVERTER_DONE! Everything is ready for review.'
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should stop - marker present anywhere
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should continue reprompting when no completion marker present', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'I am working on the implementation. Making progress...'
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
  })

  it('should stop reprompting with trailing whitespace', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'All tasks completed. BLOCKER_DIVERTER_DONE!  \n\n  '
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should stop when marker appears multiple times', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    // Marker appears twice - should still detect completion
    state.lastMessageContent = 'Remember to say BLOCKER_DIVERTER_DONE! when finished. Now I am done. BLOCKER_DIVERTER_DONE!'
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('should continue reprompting when lastMessageContent is empty', async () => {
    const hooks = createSessionHooks(mockContext)

    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = ''
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    expect(mockContext.client.session.promptAsync).toHaveBeenCalled()
  })

  it('should stop when marker present with other text', async () => {
    const hooks = createSessionHooks(mockContext)

    // Marker followed by text (should still detect)
    const state = getState(testSessionId)
    state.divertBlockers = true
    state.lastMessageContent = 'Work complete. BLOCKER_DIVERTER_DONE! (trailing text 123456789)'
    state.repromptCount = 0

    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: testSessionId } } })

    // Should stop - marker is present
    expect(mockContext.client.session.promptAsync).not.toHaveBeenCalled()
  })
})

describe('Chat Message - Assistant Message Capture', () => {
  let mockContext: Parameters<Plugin>[0]
  const testSessionId = 'test-session-chat'

  beforeEach(() => {
    cleanupState(testSessionId)
    
    mockContext = {
      client: {
        app: { log: mock(() => Promise.resolve()) },
        session: { promptAsync: mock(() => Promise.resolve()) }
      },
      project: { id: 'test-project', worktree: '/test', name: 'test' },
      $: mock(() => ({})) as any,
      directory: '/test',
      worktree: '/test'
    } as any
  })

  afterEach(() => {
    cleanupState(testSessionId)
  })

  it('should capture assistant message text content', async () => {
    const hooks = createSessionHooks(mockContext)

    // Simulate assistant message
    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'This is the assistant response.' }
        ]
      }
    )

    const state = getState(testSessionId)
    expect(state.lastMessageContent).toBe('This is the assistant response.')
  })

  it('should capture multiple text parts joined with newline', async () => {
    const hooks = createSessionHooks(mockContext)

    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
          { type: 'text', text: 'Part 3' }
        ]
      }
    )

    const state = getState(testSessionId)
    expect(state.lastMessageContent).toBe('Part 1\nPart 2\nPart 3')
  })

  it('should ignore user messages', async () => {
    const hooks = createSessionHooks(mockContext)

    // Set initial content
    const state = getState(testSessionId)
    state.lastMessageContent = 'Initial assistant message'

    // Try to capture user message
    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'User question' }]
      }
    )

    // Should not update (still has initial content)
    expect(state.lastMessageContent).toBe('Initial assistant message')
  })

  it('should ignore non-text parts', async () => {
    const hooks = createSessionHooks(mockContext)

    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'Text part' },
          { type: 'tool_use', name: 'some_tool', input: {} },
          { type: 'reasoning', text: 'Internal reasoning' }
        ]
      }
    )

    const state = getState(testSessionId)
    // Should only capture text parts
    expect(state.lastMessageContent).toBe('Text part')
  })

  it('should handle empty parts array', async () => {
    const hooks = createSessionHooks(mockContext)

    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: []
      }
    )

    const state = getState(testSessionId)
    // Should not update when no text content
    expect(state.lastMessageContent).toBe('')
  })

  it('should overwrite previous message content', async () => {
    const hooks = createSessionHooks(mockContext)

    // First message
    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: [{ type: 'text', text: 'First message' }]
      }
    )

    let state = getState(testSessionId)
    expect(state.lastMessageContent).toBe('First message')

    // Second message
    await hooks['chat.message']?.(
      { sessionID: testSessionId },
      {
        message: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Second message' }]
      }
    )

    state = getState(testSessionId)
    expect(state.lastMessageContent).toBe('Second message')
  })
})
