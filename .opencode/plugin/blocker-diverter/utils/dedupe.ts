/**
 * Deduplication utilities for blocker tracking
 * 
 * Provides hash-based deduplication with cooldown tracking to prevent
 * logging identical blockers within a configured time window.
 * 
 * Uses SHA-256 hashing via Web Crypto API for consistent, collision-resistant
 * identification of duplicate blockers.
 * 
 * @module utils/dedupe
 */

import type { SessionState, PluginConfig } from '../types'

/**
 * Generate SHA-256 hash for blocker deduplication
 * 
 * Combines question and context into a normalized string, then generates
 * a cryptographic hash for consistent duplicate detection.
 * 
 * Normalization rules:
 * - Trim leading/trailing whitespace
 * - Collapse multiple consecutive spaces into single space
 * - Preserve case (case-sensitive matching)
 * - Combine as: `question + '|' + context`
 * 
 * @param question - The blocker question text
 * @param context - Optional context string (defaults to empty)
 * @returns Promise resolving to hex-encoded hash string (64 chars)
 * 
 * @example
 * ```typescript
 * const hash = await generateBlockerHash(
 *   "Should I use Redux?",
 *   "Building state management"
 * )
 * // Returns: "a3f5e9..." (64-character hex string)
 * ```
 */
export async function generateBlockerHash(
  question: string,
  context: string = ''
): Promise<string> {
  // Normalize whitespace: trim and collapse multiple spaces
  const normalizedQuestion = question.trim().replace(/\s+/g, ' ')
  const normalizedContext = context.trim().replace(/\s+/g, ' ')
  
  // Combine using JSON serialization for unambiguous separation
  // Prevents collision when either field contains delimiter characters
  const combined = JSON.stringify([normalizedQuestion, normalizedContext])
  
  // Convert string to Uint8Array for crypto API
  const encoder = new TextEncoder()
  const data = encoder.encode(combined)
  
  // Generate SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  
  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('')
  
  return hashHex
}

/**
 * Check if blocker hash is within cooldown period
 * 
 * Determines if a blocker with the given hash has been logged recently
 * and is still within the cooldown window.
 * 
 * This is a read-only operation - it does not modify state or update
 * expiry timestamps.
 * 
 * @param hash - The blocker hash to check
 * @param state - Session state containing cooldownHashes Map
 * @returns true if hash exists and expiry > now (duplicate blocked), false otherwise
 * 
 * @example
 * ```typescript
 * const hash = await generateBlockerHash(question, context)
 * if (isInCooldown(hash, state)) {
 *   // Skip logging - duplicate within cooldown
 *   return
 * }
 * ```
 */
export function isInCooldown(
  hash: string,
  state: SessionState
): boolean {
  // Get current timestamp
  const now = Date.now()
  
  // Check if hash exists in cooldown map
  const expiry = state.cooldownHashes.get(hash)
  
  // If no entry exists, not in cooldown
  if (expiry === undefined) {
    return false
  }
  
  // Check if expiry timestamp is in the future
  return expiry > now
}

/**
 * Add blocker hash to cooldown tracking
 * 
 * Registers a blocker hash with an expiry timestamp to prevent duplicate
 * logging within the cooldown window.
 * 
 * If the hash already exists, this updates the expiry timestamp to the
 * new calculated value (extending the cooldown).
 * 
 * Expiry calculation: `Date.now() + config.cooldownMs`
 * 
 * @param hash - The blocker hash to track
 * @param state - Session state to update (mutates cooldownHashes Map)
 * @param config - Plugin config containing cooldownMs duration
 * 
 * @example
 * ```typescript
 * const hash = await generateBlockerHash(question, context)
 * if (!isInCooldown(hash, state)) {
 *   await logBlocker(blocker)
 *   addToCooldown(hash, state, config)
 * }
 * ```
 */
export function addToCooldown(
  hash: string,
  state: SessionState,
  config: PluginConfig
): void {
  // Calculate expiry timestamp
  const expiry = Date.now() + config.cooldownMs
  
  // Set in cooldown map (overwrites if exists)
  state.cooldownHashes.set(hash, expiry)
}
