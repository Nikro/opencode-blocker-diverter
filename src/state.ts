import type { SessionState } from './types'

/**
 * Internal map storing session state
 * Key: OpenCode session ID
 * Value: Session state object
 */
const sessions = new Map<string, SessionState>()

/**
 * Get session state, creating with defaults if not present
 * 
 * This function implements lazy initialization - if the session ID doesn't exist
 * in the internal map, a new SessionState object is created with default values.
 * Subsequent calls with the same session ID will return the same state object.
 * 
 * @param sessionId - OpenCode session ID
 * @returns Session state object (same reference for subsequent calls)
 * 
 * @example
 * const state = getState('session-123')
 * state.blockers.push(newBlocker)
 */
export function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId)
  
  if (!state) {
    state = {
      enabled: true,
      divertBlockers: true,
      blockers: [],
      cooldownHashes: new Map<string, number>(),
      lastBlockerTime: Date.now(),
      repromptCount: 0,
      recentResponseHashes: [],
      lastRepromptTime: 0
    }
    sessions.set(sessionId, state)
  }
  
  return state
}

/**
 * Update session state using an updater function
 * 
 * This function retrieves the session state (auto-initializing if needed) and
 * passes it to the updater function. The updater should mutate the state object
 * in place. This pattern ensures state is always initialized before updates.
 * 
 * @param sessionId - OpenCode session ID
 * @param updater - Function that mutates state in place
 * 
 * @example
 * updateState('session-123', (state) => {
 *   state.repromptCount++
 *   state.cooldownHashes.set('hash-abc', Date.now() + 30000)
 * })
 */
export function updateState(
  sessionId: string,
  updater: (state: SessionState) => void
): void {
  const state = getState(sessionId)
  updater(state)
}

/**
 * Remove session state (cleanup on session.deleted)
 * 
 * This function removes the session state from the internal map, freeing memory.
 * It should be called when a session is deleted to prevent memory leaks.
 * If the session ID doesn't exist, this is a no-op (safe to call multiple times).
 * 
 * @param sessionId - OpenCode session ID
 * 
 * @example
 * // In session.deleted event handler
 * cleanupState(event.session_id)
 */
export function cleanupState(sessionId: string): void {
  sessions.delete(sessionId)
}
