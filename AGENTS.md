# Blocker Diverter Plugin — Development Guide

**Project**: OpenCode plugin for autonomous session management  
**Type**: TypeScript plugin extending OpenCode's hook system  
**Status**: In development (v0.1.0 pre-release)

⚠️ **IMPORTANT**: If implementation deviates from this guide, update this file immediately to reflect reality.

## What We're Building

### The Problem

AI coding agents stop to ask questions. During an autonomous overnight session, an agent might encounter:
- Architecture decisions: "Which authentication framework should I use?"
- Security choices: "Should I hash passwords with bcrypt or argon2?"
- Destructive operations: "Should I delete this deprecated module?"
- Deployment config: "Which hosting provider should I deploy to?"

When any of these questions arise, the agent stops and waits for human input. The entire autonomous session grinds to a halt, defeating the purpose of overnight runs.

### The Solution

**Blocker Diverter** provides AI agents with a `blocker` tool they can actively call to log questions and continue working on independent tasks. Instead of stopping the session, blockers are written to `BLOCKERS.md` for human review in the morning.

#### How It Works

1. **Tool Registration**: Plugin registers a `blocker` tool that agents can call
2. **System Prompt Injection**: Plugin adds autonomous mode instructions to the agent's system prompt
3. **Agent Encounters Blocker**: Agent hits a decision point requiring human input
4. **Agent Calls Tool**: Agent explicitly calls `blocker` tool with structured context:
   ```typescript
   await use_tool("blocker", {
     question: "Which authentication framework should I use?",
     category: "architecture",
     context: "Task: #3 'Add user auth' | Action: Setting up auth middleware | Files: src/auth/index.ts:45 | Progress: Created route handlers",
     blocksProgress: true
   })
   ```
5. **Validation & Deduplication**: Plugin validates args, checks cooldown (prevents spam)
6. **Persistence**: Appends blocker to `BLOCKERS.md` with full context
7. **Response**: Returns fixed message: "Great, blocker registered, move on with the next non-blocking issues!"
8. **Agent Continues**: Agent moves to independent parallel work

#### Auto-Disable Safety

Plugin automatically disables when:
- User sends a manual message (detected via `chat.message` hook)
- User cancels AI response (abort detection via `message.updated` hook)
- User interrupts active generation

This prevents the plugin from interfering with interactive debugging sessions.

#### Stop Signal & Reprompts

When the agent tries to stop:
- **Stop Hook** checks if work remains (unresolved blockers, incomplete tasks)
- If blockers exist: injects "continue" prompt to keep agent working
- Rate limiting: max 5 reprompts per 5-minute window (prevents infinite loops)
- Agent signals completion: says `"BLOCKER_DIVERTER_DONE!"` when truly finished

#### Retry Mechanism

If file write fails (disk full, permissions):
- Blocker queued in `state.pendingWrites` array
- Next successful blocker write triggers retry for queued items
- Prevents losing blockers due to transient I/O errors

### What We've Built

**Core Components:**

1. **Blocker Tool** (`src/tools/blocker.ts`):
   - Primary interface for AI agents
   - Zod schema validation for args
   - Hash-based deduplication with configurable cooldown
   - Structured context requirements enforced via descriptions
   - Support for hard blockers (need human) and soft blockers (agent chooses default)

2. **System Prompt Transform** (`src/hooks/system-prompt.ts`):
   - Injects autonomous mode instructions
   - Provides decision framework (hard vs soft)
   - Includes structured context requirements
   - Shows recent blockers for session awareness

3. **Session Management** (`src/hooks/session.ts`):
   - Session lifecycle (created, deleted, idle, compacted)
   - Message hook for auto-disable on user input
   - Abort detection for cancellation handling
   - Compaction hook to preserve blocker state across session compression

4. **Stop Hook** (`src/hooks/session.ts`):
   - Prevents premature exit when work remains
   - Rate-limited reprompt injection
   - Timeout protection (30s default) to prevent hangs
   - Detects completion marker phrase

5. **Command Interface** (`src/commands/blockers-cmd.ts`):
   - `/blockers.on` - Enable autonomous mode (shows toast + dummy message)
   - `/blockers.off` - Disable (back to interactive mode)
   - `/blockers.status` - Show current state (enabled/disabled, blocker count)
   - `/blockers.list` - Display all logged blockers for session

6. **File I/O** (`src/utils/blockers-file.ts`):
   - Async append to `BLOCKERS.md`
   - Path validation (prevent directory traversal)
   - Input sanitization (prevent injection attacks)
   - Retry queue for transient failures

7. **Configuration** (`src/config.ts`):
   - Loads from `.opencode/blocker-diverter.json` (project-specific)
   - Falls back to `~/.config/opencode/blocker-diverter.json` (user defaults)
   - Zod schema validation
   - Sensible defaults for all settings

**Test Coverage**: 355 tests across 22 files, covering unit, integration, and E2E scenarios.

### Source Code Organization

```
src/
├── core/plugin.ts       # Plugin factory - registers all hooks and tools
├── types.ts             # TypeScript interfaces (Blocker, SessionState, PluginConfig)
├── config.ts            # Config loading with Zod validation
├── state.ts             # Session-keyed state Map (no global variables)
├── tools/
│   └── blocker.ts       # Blocker tool definition (primary agent interface)
├── hooks/
│   ├── session.ts       # Session lifecycle, message, stop hooks (777 lines - needs splitting)
│   ├── system-prompt.ts # System prompt injection for autonomous mode
│   └── tool-intercept.ts # Legacy question tool interception (backward compat)
├── commands/
│   └── blockers-cmd.ts  # Command handlers (/blockers.on, .off, .status, .list)
└── utils/
    ├── templates.ts      # Prompt templates and system prompt generation
    ├── blockers-file.ts  # File I/O for BLOCKERS.md
    ├── dedupe.ts         # Hash-based deduplication with cooldown
    ├── logging.ts        # Structured logging via client.app.log()
    └── with-timeout.ts   # Promise timeout wrapper
```

**Note**: `src/hooks/session.ts` is 777 lines, violating the 500-line constitution limit. Future work should split into:
- `session-events.ts` - Session lifecycle handlers
- `session-messages.ts` - Message and abort detection
- `session-stop.ts` - Stop hook and reprompt logic

### Key Context for AI Agents

- **Runtime**: Bun (JavaScript runtime with built-in shell API)
  - **IMPORTANT**: OpenCode plugins ALWAYS run on Bun runtime, regardless of how the user installed OpenCode
  - OpenCode binary bundles Bun internally via `bun build --compile`
  - Plugin dependencies installed via `bun install` at OpenCode startup
  - Plugins receive Bun's `$` shell API for command execution
- **Language**: TypeScript with strict mode enabled
- **Architecture**: Modular plugin following OpenCode SDK patterns
- **Integration**: Hooks into OpenCode's permission, session, and stop events

## Development Standards (CRITICAL)

🔴 **ALL code written MUST comply with [.specify/memory/constitution.md](.specify/memory/constitution.md)**

### Non-Negotiable Rules

1. **Modular Architecture**: Target 300-400 lines per module. HARD LIMIT: 500 lines. Split if exceeded.
2. **Test-Driven Development**: Tests written BEFORE implementation. Minimum 80% coverage.
3. **TypeScript Strict**: No `any` types. Use Zod for validation.
4. **Performance**: All I/O async. Cache LLM calls. Debounce events.
5. **Security**: Validate paths. Sanitize inputs. Never log secrets.
6. **UX Consistency**: Structured logging. Clear commands. Helpful errors.
7. **OpenCode Integration**: Use correct hook signatures. Manage session state properly.

## Technology Stack

### Core Dependencies
- `@opencode-ai/plugin` — Plugin SDK with TypeScript types
- `@opencode-ai/sdk` — OpenCode client API
- `zod` — Runtime schema validation
- `bun` — Runtime and testing framework

### Development Tools
- TypeScript 5.x with strict mode
- ESLint + Prettier
- Bun test runner (built-in)

## Spec-Kit Workflow

This project uses **spec-kit** commands for structured development:

1. `/speckit.specify` → Define requirements
2. `/speckit.clarify` → Resolve ambiguities (do this before planning!)
3. `/speckit.plan` → Technical design
4. `/speckit.tasks` → Break down work
5. `/speckit.implement` → Execute with TDD

⚠️ **Always run `/speckit.clarify` BEFORE `/speckit.plan`** to prevent rework.

📚 **Resources**: [Constitution](.specify/memory/constitution.md) · [Spec-Kit Docs](https://github.com/github/spec-kit)

## Project Structure

```
opencode-blocker-diverter/
├── index.ts              # Root entry point (export default createPlugin)
├── src/
│   ├── core/
│   │   └── plugin.ts     # Plugin factory (hook registration)
│   ├── types.ts          # Interfaces: Blocker, Config, SessionState
│   ├── config.ts         # Config loading, Zod schemas, validation
│   ├── state.ts          # Session state Map management
│   ├── utils/
│   │   ├── logging.ts    # Structured logging helpers
│   │   ├── dedupe.ts     # Cooldown hash, dedupe logic
│   │   ├── templates.ts  # Prompt template generation
│   │   ├── blockers-file.ts  # File I/O for BLOCKERS.md
│   │   └── with-timeout.ts   # Async timeout wrapper utility
│   ├── hooks/
│   │   ├── session.ts        # Session lifecycle and message hooks
│   │   ├── tool-intercept.ts # Legacy question tool interception
│   │   └── system-prompt.ts  # System prompt injection hook
│   ├── tools/
│   │   └── blocker.ts    # Blocker tool definition (primary interface)
│   └── commands/
│       └── blockers-cmd.ts  # Command handlers (/blockers.*)
├── tests/               # Comprehensive test suite (355 tests)
│   ├── config.test.ts
│   ├── state.test.ts
│   ├── core/
│   │   └── plugin.test.ts
│   ├── hooks/
│   │   ├── session-events.test.ts
│   │   ├── system-prompt.test.ts
│   │   └── tool-intercept.test.ts
│   ├── utils/
│   │   ├── logging.test.ts
│   │   ├── dedupe.test.ts
│   │   ├── templates.test.ts
│   │   ├── blockers-file.test.ts
│   │   └── with-timeout.test.ts
│   ├── commands/
│   │   └── blockers-cmd.test.ts
│   ├── tools/
│   │   └── blocker.test.ts
│   └── integration/
│       ├── e2e-command-flow.test.ts
│       └── e2e-complete-scenario.test.ts
├── dist/                 # Build output (gitignored)
│   ├── index.js         # Bundled plugin
│   ├── index.d.ts       # TypeScript declarations
│   └── src/             # Type definition modules
├── .opencode/
│   └── commands/        # Blocker command templates (committed)
│       ├── blockers.on.md
│       ├── blockers.off.md
│       ├── blockers.status.md
│       └── blockers.list.md
├── package.json          # NPM package manifest
├── tsconfig.json         # TypeScript configuration
├── .npmignore            # Files excluded from npm package
└── BLOCKERS.md          # Plugin output (gitignored)
```

### File Responsibilities (MUST NOT VIOLATE)

| File | Target Lines | Hard Limit | Purpose |
|------|--------------|------------|---------|
| `index.ts` | 10-20 | 30 | Entry point: export default createPlugin |
| `src/core/plugin.ts` | 50-150 | 200 | Plugin factory, hook registration |
| `src/types.ts` | 100-150 | 200 | All interfaces, no logic |
| `src/config.ts` | 150-200 | 300 | Load config, Zod validation |
| `src/state.ts` | 100-150 | 200 | Session Map CRUD operations |
| `src/utils/*.ts` | 100-250 each | 300 | Pure utility functions |
| `src/hooks/*.ts` | 150-300 each | 400 | One hook per file |
| `src/tools/*.ts` | 100-200 each | 250 | Tool definitions and handlers |
| `src/commands/*.ts` | 150-250 each | 350 | Command parsing + execution |

**General Rule:** Target 300-400 lines for complex modules. If approaching hard limit, split into sub-modules.

**Build Process:**
- `bun build index.ts --outdir dist --target bun --format esm` — Bundle source
- `tsc --emitDeclarationOnly` — Generate .d.ts files
- Result: `dist/index.js` (entry point for OpenCode)

## Plugin Context API

```typescript
import type { Plugin } from "@opencode-ai/plugin"

// Correct pattern - destructure context object
export const createPlugin: Plugin = async ({ client, project, $, directory, worktree }) => {
  // Setup code runs ONCE on plugin load
  
  // Available context:
  // - client: OpenCode SDK client (session.prompt, app.log, etc.)
  // - project: { id, worktree, vcs, name }
  // - $: Bun shell API for commands (await $`git status`.text())
  // - directory: Current working directory
  // - worktree: Git worktree root
  
  return {
    // Hooks go here (see Hook Reference below)
  }
}
```

### ⚠️ CRITICAL PATTERN

```typescript
// ✅ CORRECT — destructure context object
export const BlockerDiverter: Plugin = async ({ client, $, project }) => {
  await client.session.prompt({ ... })
}

// ❌ WRONG — treating context as client directly
export const BlockerDiverter: Plugin = async (client) => {
  await client.session.prompt({ ... })  // FAILS at runtime!
}
```

## Hook Reference

### Primary Interface: Blocker Tool

The plugin provides a `blocker` tool that AI agents call directly to log blocking questions:

```typescript
// From src/tools/blocker.ts
tool({
  description: "Log a blocker question to blockers.md and continue with independent tasks...",
  args: {
    question: tool.schema.string().min(1).describe("The exact blocking question..."),
    category: tool.schema.enum(["architecture", "security", "destructive", "permission", "question", "other"]),
    context: tool.schema.string().optional().describe("STRUCTURED context with task reference, action, file paths, progress..."),
    blocksProgress: tool.schema.boolean().optional().default(true),
    options: tool.schema.array(tool.schema.string()).optional(),
    chosenOption: tool.schema.string().optional(),
    chosenReasoning: tool.schema.string().optional()
  },
  async execute(args, context) {
    // Validation, deduplication, persistence, state management
    return BLOCKER_RESPONSE_MESSAGE
  }
})
```

### Primary Hooks (CURRENTLY IMPLEMENTED)

#### 1. Tool Registration
```typescript
"tool": {
  blocker: createBlockerTool(logClient, config, worktree)
}
```

#### 2. System Prompt Transform
```typescript
"experimental.chat.system.transform": async (input, output) => {
  output.system.push(getSystemPromptTemplate(state, config))
  output.system.push(getBlockerToolDefinition())
}
```

#### 3. Session Event Hook
```typescript
"event": async ({ event }) => {
  if (event.type === "session.created") {
    // Initialize session state
  }
  if (event.type === "session.deleted") {
    // Cleanup state
  }
  if (event.type === "session.idle") {
    // Detect idle state, potentially reprompt
  }
}
```

#### 4. Message Hook (Auto-disable on User Input)
```typescript
"chat.message": async (input) => {
  // Auto-disable divertBlockers when user sends manual message
  // Shows toast: "🛑 Blocker diverter auto-disabled (user input detected)"
}
```

#### 5. Compaction Hook
```typescript
"experimental.session.compacting": async (input, output) => {
  // Preserve blocker state across compaction
  output.context.push(`<active-blockers>...</active-blockers>`)
}
```

#### 6. Stop Hook
```typescript
"stop": async (input) => {
  // Check if work remains, inject "continue" prompt if needed
  // Prevents premature exit
}
```

#### 7. Command Hook
```typescript
"tui.command.execute": async (input) => {
  if (input.command === "/blockers") {
    // Handle /blockers.on, .off, .status, .list
  }
}
```

### Secondary Hooks (LEGACY/DEPRECATED)

#### Tool Intercept Hook (Legacy)
```typescript
"tool.execute.before": async (input) => {
  // Legacy: intercepts "question" tool from old OpenCode versions
  // Kept for backward compatibility but not primary interface
}
```

### Event Types Reference

```typescript
// Session events
"session.created"   // Initialize session state
"session.deleted"   // Cleanup state Map
"session.idle"      // Agent waiting for input
"session.compacted" // Session history compressed

// Message events
"message.updated"   // New message (analyze for questions)
"message.removed"

// Tool events
"tool.execute.before"  // Before tool runs
"tool.execute.after"   // After tool completes

// Permission events
"permission.asked"     // Before user approval dialog
"permission.replied"   // After user responds

// File events
"file.edited"          // File modification detected
```

## State Management Pattern

```typescript
// types.ts
interface SessionState {
  blockers: Blocker[]
  filesModified: string[]
  enabled: boolean
  cooldownHashes: Set<string>
}

// state.ts
const sessions = new Map<string, SessionState>()

export function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId)
  if (!state) {
    state = { blockers: [], filesModified: [], enabled: true, cooldownHashes: new Set() }
    sessions.set(sessionId, state)
  }
  return state
}

export function cleanupState(sessionId: string): void {
  sessions.delete(sessionId)
}

// hooks/session.ts
event: async ({ event }) => {
  if (event.type === "session.created") {
    const sessionId = event.session_id
    getState(sessionId)  // Initialize
  }
  
  if (event.type === "session.deleted") {
    cleanupState(event.session_id)
  }
}
```

## Testing Requirements

### Unit Test Pattern

```typescript
// classifier.test.ts
import { describe, it, expect } from 'bun:test'
import { classifyBlocker } from './classifier'

describe('classifyBlocker', () => {
  it('should classify architecture questions as hard blockers', async () => {
    const result = await classifyBlocker(
      "Which framework should I use?",
      "Building new API service"
    )
    expect(result).toBe("hard")
  })
  
  it('should classify naming questions as soft', async () => {
    const result = await classifyBlocker(
      "Should I name this getUserData or fetchUserData?",
      "Adding user endpoint"
    )
    expect(result).toBe("soft")
  })
})
```

### Integration Test Pattern

```typescript
// integration.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { BlockerDiverter } from './index'

describe('BlockerDiverter Plugin', () => {
  it('should register all required hooks', async () => {
    const mockContext = {
      client: mock(() => ({})),
      project: { id: "test", worktree: "/test" },
      $: mock(() => ({})),
      directory: "/test",
      worktree: "/test"
    }
    
    const hooks = await BlockerDiverter(mockContext)
    
    expect(hooks).toHaveProperty("permission.asked")
    expect(hooks).toHaveProperty("event")
    expect(hooks).toHaveProperty("stop")
  })
})
```

### Coverage Requirements
- Minimum 80% line coverage
- 100% coverage for critical paths (classifier, permission hook)
- Run: `bun test --coverage`

## Command Implementation

```typescript
// commands/blockers-cmd.ts
export async function handleBlockersCommand(
  args: string[],
  sessionId: string,
  client: any
): Promise<void> {
  const subcommand = args[0]
  
  switch (subcommand) {
    case "on":
      // Enable for session
      break
    case "off":
      // Disable for session
      break
    case "status":
      // Show current state
      break
    case "list":
      // Print blocker summary
      break
    default:
      await client.app.log({
        level: "info",
        message: "Usage: /blockers [on|off|status|list]"
      })
  }
}

// index.ts (hook registration)
return {
  "tui.command.execute": async (input, output) => {
    if (input.command === "/blockers") {
      await handleBlockersCommand(input.args || [], sessionId, client)
    }
  }
}
```

## Configuration Schema

```typescript
// config.ts
import { z } from 'zod'

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockersFile: z.string().default("BLOCKERS.md"),
  maxBlockersPerRun: z.number().int().positive().default(20),
  cooldown: z.number().int().positive().default(60000),
  useLLMClassification: z.boolean().default(true),
  hardBlockerRules: z.object({
    keywords: z.array(z.string()).default([
      "framework", "auth", "deploy", "migration", "delete", "security"
    ]),
    patterns: z.array(z.string()).default([]),
    categories: z.array(z.string()).default([
      "architecture", "security", "destructive", "deployment"
    ])
  }),
  softDefaults: z.record(z.string()).default({
    naming: "use descriptive camelCase",
    formatting: "follow project Prettier config"
  })
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(projectDir: string): Config {
  // Read opencode.json, parse blockerDiverter section, validate with Zod
  // Return validated config or throw detailed error
}
```

## Logging Standards

```typescript
// utils/logging.ts
export async function logInfo(client: any, message: string, extra?: Record<string, any>) {
  await client.app.log({
    service: "blocker-diverter",
    level: "info",
    message,
    extra
  })
}

export async function logError(client: any, message: string, error: Error) {
  await client.app.log({
    service: "blocker-diverter",
    level: "error",
    message,
    extra: {
      error: error.message,
      stack: error.stack
    }
  })
}

// Usage
await logInfo(client, "Blocker recorded", { blockerId: blocker.id, category: "architecture" })
```

## Common Patterns & Anti-Patterns

### ✅ DO

```typescript
// Async operations
await $`echo "content" >> ${blockersFile}`

// Session-keyed state
const state = getState(sessionId)

// Proper error handling
try {
  await appendBlocker(blocker)
} catch (error) {
  await logError(client, "Failed to write blocker", error)
}

// Structured logging
await client.app.log({ level: "info", message: "...", extra: { ... } })
```

### ❌ DON'T

```typescript
// Global state
let globalBlockerCount = 0  // WRONG: loses state on session switch

// Synchronous I/O
fs.writeFileSync(file, data)  // WRONG: blocks event loop

// Console logging
console.log("Blocker recorded")  // WRONG: not structured, not queryable

// Any types
function classify(input: any): any  // WRONG: no type safety
```

## Security Checklist

- [ ] Validate all file paths (no directory traversal)
- [ ] Sanitize LLM responses before writing to files
- [ ] Never log sensitive data (API keys, tokens, credentials)
- [ ] Implement rate limiting (maxBlockersPerRun)
- [ ] Deduplicate to prevent spam (cooldown mechanism)
- [ ] Handle errors gracefully without exposing internals
- [ ] Respect OpenCode's permission system (no bypasses)

## Performance Checklist

- [ ] All I/O operations are async
- [ ] LLM classification results are cached
- [ ] Event handlers are debounced/throttled
- [ ] File size limits implemented (blocker log rotation)
- [ ] Lazy evaluation for expensive operations
- [ ] No blocking code in hot paths (event hooks)

## Code Review Checklist

Before submitting PR:

- [ ] All tests passing (`bun test`)
- [ ] Type check passing (`tsc --noEmit`)
- [ ] Linting passing (`eslint src/`)
- [ ] Coverage >80% (`bun test --coverage`)
- [ ] No files exceed 500 lines (hard limit)
- [ ] All functions have JSDoc comments
- [ ] README updated with new features
- [ ] CHANGELOG.md updated
- [ ] Constitution principles verified

## Common Issues & Solutions

### Plugin Not Loading
**Symptom**: Plugin doesn't appear to run  
**Check**:
1. TypeScript errors (syntax errors prevent loading)
2. Plugin export name matches: `export const BlockerDiverter: Plugin`
3. opencode.json plugin array correct: `["opencode-blocker-diverter"]`

### Hooks Not Firing
**Symptom**: Expected behavior not happening  
**Check**:
1. Hook name exact match (case-sensitive): `"permission.asked"` not `"permission.ask"`
2. Context object destructured correctly: `async ({ client }) =>` not `async (client) =>`
3. Session ID extraction correct: `event.session_id` or `input.sessionID` (varies by hook)

### State Not Persisting
**Symptom**: State resets unexpectedly  
**Check**:
1. Using session-keyed Map (not global variables)
2. Cleanup on `session.deleted` implemented
3. Compaction hook preserves critical state

## Resources

- **OpenCode Plugin Docs**: https://opencode.ai/docs/plugins/
- **Plugin SDK Types**: `node_modules/@opencode-ai/plugin/dist/index.d.ts`
- **Bun Shell API**: https://bun.com/docs/runtime/shell
- **Bun Test Runner**: https://bun.com/docs/cli/test
- **Community Examples**: https://opencode.ai/docs/ecosystem#plugins

## Development Commands

```bash
# Testing
bun test                    # Run all tests
bun test --watch            # Watch mode
bun test --coverage         # With coverage report
bun test classifier.test.ts # Single file

# Code Quality
bun run lint                # ESLint
bun run typecheck           # TypeScript compiler
bun run format              # Prettier

# Development
bun install                 # Install dependencies
bun run build               # Build (if applicable)
```

## Next Steps

1. Read [.specify/memory/constitution.md](.specify/memory/constitution.md) thoroughly
2. Review project structure and file responsibilities
3. Implement TDD: Write tests for the module you're working on FIRST
4. Keep modules small (<150 lines)
5. Ask questions if architecture unclear

---

**Remember**: Quality over speed. Every line of code will be maintained by others. Write code you'd be proud to review in 6 months.
