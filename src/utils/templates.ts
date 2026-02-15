/**
 * Templates Utility
 * 
 * Generates synthetic user messages to inject into OpenCode sessions.
 * Used for autonomous operation by simulating user responses.
 * 
 * @module utils/templates
 */

import type { PluginConfig, SessionState } from '../types'

/**
 * Fixed response message for blocker acknowledgment (FR-009)
 */
export const BLOCKER_RESPONSE_MESSAGE = "Great, blocker registered, move on with the next non-blocking issues!"

/**
 * Default completion marker for stop prompt (FR-014)
 */
export const DEFAULT_COMPLETION_MARKER = "BLOCKER_DIVERTER_DONE!"

/**
 * Maximum allowed length for sanitized inputs (prevents bloat)
 */
const MAX_INPUT_LENGTH = 200

/**
 * Sanitize user input to prevent prompt injection
 * 
 * Defense-in-depth security measure:
 * - Strips control characters (newlines, tabs, carriage returns)
 * - Trims leading/trailing whitespace
 * - Limits length to prevent message bloat
 * 
 * @param input - Raw input string to sanitize
 * @returns Sanitized string safe for template interpolation
 * 
 * @example
 * ```typescript
 * sanitizeInput("bash\n\nmalicious") // => "bashmalicious"
 * sanitizeInput("  spaced  ") // => "spaced"
 * sanitizeInput("a".repeat(300)) // => "a".repeat(200)
 * ```
 */
export function sanitizeInput(input: string): string {
  // Strip control characters
  let sanitized = input
    .replace(/[\n\r\t]/g, '')
    .trim()
  
  // Limit length to prevent bloat
  if (sanitized.length > MAX_INPUT_LENGTH) {
    sanitized = sanitized.substring(0, MAX_INPUT_LENGTH)
  }
  
  return sanitized
}

/**
 * Sanitize blocker text to prevent markdown/markup injection
 * 
 * Multi-layer defense against prompt injection:
 * 1. Strips control characters (newlines, tabs, CR) to prevent instruction injection
 * 2. Removes Unicode zero-width and bidi override characters
 * 3. Removes HTML angle brackets to prevent tag injection
 * 4. Escapes markdown special characters
 * 5. Normalizes whitespace and truncates to prevent bloat
 * 
 * @param text - Raw blocker text (question, category, etc.)
 * @param maxLength - Maximum allowed length before truncation (default: 100)
 * @returns Sanitized and truncated string safe for system prompt injection
 * 
 * @example
 * ```typescript
 * sanitizeBlockerText("Line1\nLine2") // => "Line1 Line2"
 * sanitizeBlockerText("**bold** [link](url)") // => "\\*\\*bold\\*\\* \\[link\\]\\(url\\)"
 * sanitizeBlockerText("a".repeat(200)) // => "a".repeat(100) + "..."
 * sanitizeBlockerText("<script>alert('xss')</script>") // => "scriptalert('xss')/script"
 * ```
 */
export function sanitizeBlockerText(text: string, maxLength: number = 100): string {
  // Step 1: Strip control characters (ASCII 0-31, 127-159)
  // Replace newlines, CR, tabs with single space
  let sanitized = text
    .replace(/[\r\n\t]+/g, ' ')  // CRLF, LF, CR, tabs → space
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // Other control chars → removed
  
  // Step 2: Remove Unicode zero-width, bidi override, and smuggling characters
  // OWASP-flagged Unicode obfuscation/smuggling characters
  sanitized = sanitized
    .replace(/[\u200B-\u200F]/g, '')  // Zero-width spaces, joiners, etc.
    .replace(/[\u2060]/g, '')         // Word joiner (invisible)
    .replace(/[\u2066-\u2069]/g, '')  // Directional isolate controls (bidi)
    .replace(/[\u202A-\u202E]/g, '')  // Bidi override characters
    .replace(/[\uFEFF]/g, '')         // Zero-width no-break space (BOM)
  
  // Step 3: Remove angle brackets (HTML/XML tag prevention)
  sanitized = sanitized
    .replace(/[<>]/g, '')  // Remove entirely (simpler than escaping)
  
  // Step 4: Escape markdown special characters
  sanitized = sanitized
    .replace(/\*/g, '\\*')    // Escape asterisks (bold/italic)
    .replace(/_/g, '\\_')     // Escape underscores (italic)
    .replace(/\[/g, '\\[')    // Escape square brackets (links)
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')    // Escape parentheses (links)
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`')     // Escape backticks (code)
    .replace(/#/g, '\\#')     // Escape hashes (headings)
  
  // Step 5: Normalize multiple spaces to single space and trim
  sanitized = sanitized
    .replace(/\s+/g, ' ')
    .trim()
  
  // Step 6: Truncate if needed
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...'
  }
  
  return sanitized
}

/**
 * Message format for session.prompt() SDK call
 * Matches OpenCode's expected prompt structure
 */
export interface PromptMessage {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
  }
}

/**
 * Generate fake user response after blocker logged
 * 
 * Uses fixed message as specified in FR-009 to acknowledge blocker
 * registration and instruct agent to continue with non-blocking work.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @returns Formatted prompt message for session.prompt() injection
 * 
 * @example
 * ```typescript
 * const msg = getBlockerResponse('session-123')
 * await client.session.prompt(msg)
 * ```
 */
export function getBlockerResponse(sessionId: string): PromptMessage {
  return {
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: BLOCKER_RESPONSE_MESSAGE
        }
      ]
    }
  }
}

/**
 * Generate fake user prompt to prevent premature stop
 * 
 * Instructs agent to check progress and signal completion with a
 * configurable marker phrase (FR-014). Used by stop hook to keep
 * autonomous session running until all work is done.
 * 
 * @param sessionId - Current OpenCode session identifier
 * @param config - Plugin configuration containing completionMarker
 * @returns Formatted prompt message for session.prompt() injection
 * 
 * @example
 * ```typescript
 * const msg = getStopPrompt('session-456', config)
 * await client.session.prompt(msg)
 * // Agent will respond with progress check and say marker when done
 * ```
 */
export function getStopPrompt(
  sessionId: string,
  config: PluginConfig
): PromptMessage {
  const marker = sanitizeInput(config.completionMarker || DEFAULT_COMPLETION_MARKER)
  
  return {
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: `Check the progress on current tasks. If there's more non-blocking work to do, continue. When all work is complete, say '${marker}'!`
        }
      ]
    }
  }
}

/**
 * Generate system prompt instructions for autonomous mode
 * 
 * Creates structured instructions that guide the agent's blocker handling
 * behavior during autonomous sessions. Includes:
 * - HARD vs SOFT blocker distinction
 * - Decision framework with examples
 * - Completion protocol
 * - Current session context (blockers logged)
 * 
 * @param state - Current session state
 * @param config - Plugin configuration
 * @returns Formatted system prompt text with XML tags
 * 
 * @example
 * ```typescript
 * const prompt = getSystemPromptTemplate(state, config)
 * output.system.push(prompt)
 * ```
 */
export function getSystemPromptTemplate(
  state: SessionState,
  config: PluginConfig
): string {
  const { blockers } = state
  const marker = sanitizeBlockerText(config.completionMarker || DEFAULT_COMPLETION_MARKER)
  
  // Show last 3 blockers only
  const recentBlockers = blockers.slice(-3)
  
  return `<blocker-diverter-mode enabled>
You are operating in AUTONOMOUS MODE with the Blocker Diverter plugin active.

## Core Responsibilities

1. **HARD BLOCKERS** (Architecture, Security, Destructive, Deployment):
   - DO NOT ask the user
   - Log to blockers.md with STRUCTURED CONTEXT (see below)
   - Continue with independent parallel tasks
   - Examples: "Which framework?", "Should I delete X?", "Deploy where?"

2. **SOFT QUESTIONS** (Naming, Formatting, Minor Choices):
   - Make reasonable default choices
   - Follow project conventions
   - Log your choice and reasoning with STRUCTURED CONTEXT
   - Examples: "Name this function?", "Format as JSON or YAML?"

## Blocker Context Requirements

When logging blockers, ALWAYS include structured context:

**Required Elements**:
- **Task Reference**: Task ID, todo item number, or brief task description
- **What You Were Doing**: Specific action/operation being attempted
- **Where You Got Stuck**: Exact file path(s), line numbers, or command
- **Progress Made**: What was completed before hitting the blocker

**Good Context Example**:
\`\`\`
Task: #3 "Implement user authentication"
Action: Setting up JWT token validation middleware
Files: src/middleware/auth.ts:45, src/config/jwt.ts
Progress: Created auth middleware skeleton, installed jsonwebtoken package
Blocker: Need to decide between RS256 (asymmetric) vs HS256 (symmetric) signing
\`\`\`

**Bad Context Example** (too vague):
\`\`\`
Working on auth stuff
\`\`\`

## Decision Framework

**HARD (Log & Continue)**:
- Framework/library selection
- Authentication/authorization strategy
- Database schema changes
- Destructive operations (delete, drop, truncate)
- Deployment configuration
- Security settings

**SOFT (Choose & Log)**:
- Function/variable naming (use descriptive camelCase)
- Code formatting (follow project Prettier/ESLint)
- File organization (follow existing patterns)
- Comment style (match surrounding code)

## Completion Protocol

Before stopping:
1. Check if blockers remain unresolved
2. If blockers exist, address those you can or log remaining
3. Only say "${marker}" when truly complete (no more work)

## Examples

**Hard Blocker:**
\`\`\`
User: Build a user authentication system
You: Which framework should I use? → LOG BLOCKER
Action: Log to blockers.md: "Framework choice for auth system?"
Continue: Work on database schema design instead
\`\`\`

**Soft Question:**
\`\`\`
User: Add a function to fetch user data
You: Name it? → MAKE DEFAULT CHOICE
Action: Name it \`getUserData\` (descriptive, follows convention)
Log: "Named function getUserData for clarity"
\`\`\`
${recentBlockers.length > 0 ? `
## Current Session Context

**Blockers Logged**: ${blockers.length}
${recentBlockers.map(b => `- ${sanitizeBlockerText(b.category)}: ${sanitizeBlockerText(b.question)}`).join('\n')}

Review these before stopping.
` : ''}
</blocker-diverter-mode>`
}

/**
 * Generate blocker tool XML definition for system prompt injection
 * 
 * Returns Anthropic-compatible tool definition with JSON schema for arguments.
 * Only injected when divertBlockers is enabled.
 * 
 * Format follows: <tools><tool><name>...</name><description>...</description><input_schema><json_schema>...</json_schema></input_schema></tool></tools>
 * 
 * @returns XML string containing blocker tool definition
 * 
 * @example
 * ```typescript
 * const toolXML = getBlockerToolDefinition()
 * output.system.push(toolXML)
 * ```
 */
export function getBlockerToolDefinition(): string {
  return `<tools>
<tool>
  <name>blocker</name>
  <description>Log a hard blocker question that needs human input to blockers.md and continue with independent tasks. Use this when you hit architecture decisions, security choices, destructive operations, or deployment configurations that block progress. DO NOT use for soft questions (naming, formatting) - make reasonable defaults for those.

IMPORTANT: Provide STRUCTURED CONTEXT in the 'context' field:
- Task Reference: Task ID, todo item, or task description
- What You Were Doing: Specific action/operation attempted
- Where You Got Stuck: File paths (e.g., src/auth.ts:45), commands, or function names
- Progress Made: What was completed before hitting the blocker

Example context:
"Task: #3 'Implement JWT auth' | Action: Setting up token validation | Files: src/middleware/auth.ts:45, src/config/jwt.ts | Progress: Created middleware skeleton, installed jsonwebtoken | Blocker: Need to decide RS256 vs HS256 signing algorithm"
</description>
  <input_schema>
    <json_schema>
      {
        "type": "object",
        "properties": {
          "question": {
            "type": "string",
            "description": "The exact blocking question you need answered"
          },
          "category": {
            "type": "string",
            "enum": ["architecture", "security", "destructive", "deployment", "question", "other"],
            "description": "Category of the blocker"
          },
          "context": {
            "type": "string",
            "description": "Additional context: what you were doing, file paths, command args, etc."
          }
        },
        "required": ["question", "category"]
      }
    </json_schema>
  </input_schema>
</tool>
</tools>`
}
