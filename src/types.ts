/**
 * Type definitions for the Blocker Diverter plugin
 * 
 * Defines core interfaces for blocker tracking, session state management,
 * and plugin configuration following OpenCode plugin SDK patterns.
 * 
 * @module types
 */

import type { Plugin } from '@opencode-ai/plugin'
import { z } from 'zod'

// Re-export Plugin type from OpenCode SDK
export type { Plugin }

/**
 * Zod schema for blocker tool arguments
 * Validates arguments passed by AI agents when calling the blocker tool
 * 
 * Implements FR-003: Full blocker schema with soft blocker support
 */
export const BlockerToolArgsSchema = z.object({
  question: z.string().min(1, "Question cannot be empty"),
  category: z.enum(['architecture', 'security', 'destructive', 'permission', 'question', 'other']),
  context: z.string().optional().default(""),
  blocksProgress: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  chosenOption: z.string().optional(),
  chosenReasoning: z.string().optional()
}).refine(
  (data) => {
    // If it's a soft blocker (blocksProgress=false), require options
    if (data.blocksProgress === false && (!data.options || data.options.length === 0)) {
      return false
    }
    // If chosenOption is provided, it must be in options array
    if (data.chosenOption && data.options && !data.options.includes(data.chosenOption)) {
      return false
    }
    return true
  },
  {
    message: "Soft blockers (blocksProgress=false) must include options array. If chosenOption is provided, it must be in the options array."
  }
)

export type BlockerToolArgs = z.infer<typeof BlockerToolArgsSchema>

/**
 * Blocker category classification
 * 
 * Used to categorize different types of blockers for prioritization
 * and handling strategies.
 */
export type BlockerCategory = 
  | 'permission'    // Permission dialogs (bash, edit, external_directory)
  | 'architecture'  // High-level design decisions
  | 'security'      // Security-sensitive operations
  | 'destructive'   // Potentially destructive operations (delete, truncate)
  | 'deployment'    // Deployment configuration
  | 'question'      // General conversational questions
  | 'other'         // Uncategorized blockers

/**
 * Core blocker entity
 * 
 * Represents a single blocker event that requires user clarification
 * or decision-making during an autonomous session.
 */
export interface Blocker {
  /** 
   * Unique identifier
   * Format: `${timestamp}-${sessionId}-${hash}`
   */
  id: string

  /** 
   * ISO 8601 timestamp of when the blocker occurred
   * Example: "2026-02-12T10:00:00Z"
   */
  timestamp: string

  /** OpenCode session ID where this blocker originated */
  sessionId: string

  /** Categorization of the blocker type */
  category: BlockerCategory

  /** 
   * The exact question or decision text presented to the agent
   * Should be captured verbatim for user review
   */
  question: string

  /** 
   * Surrounding context for the blocker
   * Includes task description, file path, command args, etc.
   */
  context: string

  /** 
   * True if this blocker completely halts progress (hard blocker)
   * False if the agent can make a default choice (soft blocker)
   */
  blocksProgress: boolean

  /** 
   * Research options for soft blockers
   * Array of 3 potential choices the agent considered
   */
  options?: string[]

  /** 
   * The option chosen by the agent for soft blockers
   * Must be one of the values from `options` array
   */
  chosenOption?: string

  /** 
   * Reasoning for the chosen option
   * Explains why the agent selected this particular choice
   */
  chosenReasoning?: string

  /** 
   * Clarification status tracking
   * - pending: Awaiting user input
   * - clarified: User has provided guidance
   * - skipped: User chose to skip/ignore
   */
  clarified?: 'pending' | 'clarified' | 'skipped'

  /** 
   * User-provided resolution or guidance
   * Stored after user reviews the blocker
   */
  clarification?: string
}

/**
 * Per-session state management
 * 
 * Tracks all runtime state for a single OpenCode session,
 * including blockers, deduplication data, and reprompt tracking.
 */
export interface SessionState {
  /** Global plugin enabled state (from config) */
  enabled: boolean

  /** 
   * Per-session blocker diversion toggle
   * User can disable diversion for specific sessions via /blockers off
   */
  divertBlockers: boolean

  /** In-memory copy of blockers logged during this session */
  blockers: Blocker[]

  /** 
   * Cooldown hashes for deduplication with expiry tracking
   * Maps hash → expiry timestamp (ms since epoch)
   * Prevents logging the same blocker multiple times within cooldown window
   */
  cooldownHashes: Map<string, number>

  /** 
   * Timestamp (ms since epoch) of the last blocker event
   * Used for cooldown calculations
   */
  lastBlockerTime: number

  /** 
   * Counter for stop hook reprompts
   * Tracks how many times we've injected "continue" prompts
   */
  repromptCount: number

  /** 
   * Recent response hashes for loop detection
   * Stores hashes of agent responses to detect repeated outputs
   */
  recentResponseHashes: string[]

  /** 
   * Timestamp (ms since epoch) of the last reprompt
   * Used for reprompt window calculations
   */
  lastRepromptTime: number

  /** 
   * Recovery guard flag - prevents re-prompting immediately after errors
   * Set to true when session.error occurs, cleared on next session.idle
   * Allows the agent one idle cycle to stabilize before auto-continue resumes
   */
  isRecovering: boolean

  /**
   * Pending write queue for failed blocker writes (FR-024)
   * Blockers that failed to write to file are queued here for retry
   */
  pendingWrites: Blocker[]

  /**
   * Last assistant message content (for completion marker detection)
   * Updated by chat.message hook when agent sends messages
   * Used by session.idle handler to check if agent signaled completion
   */
  lastMessageContent: string
}

/**
 * Global plugin configuration
 * 
 * Loaded from opencode.json or defaults, validated with Zod.
 * Controls plugin behavior across all sessions.
 */
export interface PluginConfig {
  /** Global enable/disable toggle */
  enabled: boolean

  /** 
   * Default state for divertBlockers in new sessions
   * Individual sessions can override via commands
   */
  defaultDivertBlockers: boolean

  /** 
   * Path to the blockers log file (relative to project root)
   * Example: "blockers.md" or "logs/blockers.log"
   */
  blockersFile: string

  /** 
   * Maximum number of blockers to log per session
   * Prevents unbounded log growth
   */
  maxBlockersPerRun: number

  /** 
   * Deduplication cooldown window in milliseconds
   * Prevents logging identical blockers within this timeframe
   */
  cooldownMs: number

  /** 
   * Maximum reprompt attempts before allowing agent to stop
   * Prevents infinite loops while maintaining autonomous behavior
   */
  maxReprompts: number

  /** 
   * Time window (ms) for reprompt counting
   * Resets reprompt count after this duration
   */
  repromptWindowMs: number

  /** 
   * Marker string appended to blockers file on session completion
   * Used to demarcate session boundaries in the log
   */
  completionMarker: string

  /** 
   * Timeout for prompt injection API calls in milliseconds
   * Prevents hanging indefinitely when injecting continuation prompts
   */
  promptTimeoutMs: number
}
