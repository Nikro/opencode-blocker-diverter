# Blocker Diverter Plugin — Development Guide

**Project**: OpenCode plugin for autonomous session management  
**Type**: TypeScript plugin extending OpenCode's hook system  
**Status**: In development (v0.1.0 pre-release)

## Project Overview

This is an **OpenCode plugin** that enables autonomous overnight coding sessions by intercepting blocker questions and allowing the AI agent to continue working on independent tasks.

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

## Spec-Kit Workflow (FOR AI AGENTS)

This project uses **spec-kit** commands for structured development. Follow this workflow:

```
╔══════════════════════════════════════════════════════════════╗
║  🤖 Spec-Kit Development Workflow (CORRECT ORDER)            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  0️⃣ /speckit.constitution → PROJECT PRINCIPLES (ONCE)       ║
║     • Define code quality standards                         ║
║     • Establish testing discipline                          ║
║     • Set architectural constraints                         ║
║     OUTPUT: constitution.md created                         ║
║                                                              ║
║  1️⃣ /speckit.specify → WHAT & WHY (requirements)            ║
║     • User stories with acceptance criteria                 ║
║     • Functional requirements (technology-agnostic)         ║
║     • Success criteria (measurable outcomes)                ║
║     OUTPUT: specs/###-feature-name/spec.md                  ║
║                                                              ║
║  2️⃣ /speckit.clarify → RESOLVE AMBIGUITIES (before plan!)   ║
║     • Structured Q&A for underspecified areas               ║
║     • Edge case clarification                               ║
║     • Scope boundary definition                             ║
║     OUTPUT: Updated spec.md with clarifications             ║
║                                                              ║
║  3️⃣ /speckit.plan → HOW (technical implementation)          ║
║     • Choose tech stack (TypeScript, Bun, Zod, etc.)        ║
║     • Define module structure                               ║
║     • Architecture decisions & tradeoffs                    ║
║     OUTPUT: plan.md, research.md, data-model.md             ║
║                                                              ║
║  4️⃣ /speckit.tasks → ACTIONABLE BREAKDOWN                   ║
║     • Task-by-task implementation plan                      ║
║     • Dependency ordering                                   ║
║     • Parallel execution markers                            ║
║     OUTPUT: tasks.md with ordered work items                ║
║                                                              ║
║  5️⃣ /speckit.implement → EXECUTE TASKS                      ║
║     • TDD: Write tests FIRST                                ║
║     • Implement to pass tests                               ║
║     • Refactor while keeping tests green                    ║
║     OUTPUT: Working code with 80%+ coverage                 ║
║                                                              ║
║  🔄 ITERATE: Use /speckit.clarify anytime specs unclear     ║
╚══════════════════════════════════════════════════════════════╝
```

### Critical Rules for AI Agents

⚠️ **ALWAYS run `/speckit.clarify` BEFORE `/speckit.plan`**:
- Prevents rework downstream
- Resolves ambiguous requirements
- Documents architectural decisions
- Establishes scope boundaries

⚠️ **NEVER skip constitution** on new projects:
- First command should be `/speckit.constitution`
- All subsequent work is governed by these principles
- Constitution guides planning and implementation decisions

⚠️ **The correct order is STRICT**:
1. Constitution (once) → 2. Specify → 3. Clarify → 4. Plan → 5. Tasks → 6. Implement

⚠️ **ALWAYS write tests first** (`/speckit.implement` step):
```typescript
// ❌ WRONG: Implementing without tests
export function classifyBlocker(q: string) { ... }

// ✅ CORRECT: Tests first
describe('classifyBlocker', () => {
  it('should detect hard blocker keywords', async () => {
    expect(await classifyBlocker("Which framework?")).toBe("hard")
  })
})
// NOW implement classifyBlocker
```

### When to Use Each Command

| Situation | Command | Action |
|-----------|---------|--------|
| User says "build authentication hook" but doesn't specify which permission | `/speckit.clarify` | Ask: "Which permissions should this hook intercept? (bash, edit, external_directory, all?)" |
| Starting new module (e.g., classifier.ts) | `/speckit.plan` | Design: interfaces, dependencies, module boundaries |
| Plan approved, need implementation details | `/speckit.tasks` | Break down: ordered tasks with file paths, dependencies |
| Spec approved, ready to code | `/speckit.implement` | Implement: TDD cycle (test → code → refactor) |

📚 **Spec-Kit Resources:**
- [Constitution](.specify/memory/constitution.md) — Project governance
- [Spec-Kit Docs](https://github.com/github/spec-kit) — Command reference
- [TDD Guide](https://bun.sh/docs/cli/test) — Bun test runner

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
│   │   └── templates.ts  # Prompt template generation
│   ├── hooks/            # (Phase 4 - not yet implemented)
│   │   ├── permission.ts
│   │   ├── session.ts
│   │   ├── stop.ts
│   │   ├── compaction.ts
│   │   └── system-prompt.ts
│   └── commands/         # (Phase 5 - not yet implemented)
│       └── blockers-cmd.ts
├── tests/
│   ├── config.test.ts
│   ├── state.test.ts
│   └── utils/
│       ├── logging.test.ts
│       ├── dedupe.test.ts
│       └── templates.test.ts
├── dist/                 # Build output (gitignored)
│   ├── index.js         # Bundled plugin
│   ├── index.d.ts       # TypeScript declarations
│   └── src/             # Type definition modules
├── package.json          # NPM package manifest
├── tsconfig.json         # TypeScript configuration
└── .npmignore            # Files excluded from npm package
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

### Primary Hooks (MUST IMPLEMENT)

#### 1. Permission Hook
```typescript
"permission.asked": async (input, output) => {
  // input: { permission, sessionID, tool, args, patterns }
  // output: { status: "allow" | "deny" | "ask" }
  
  // Intercepts BEFORE user sees "Allow/Deny" dialog
  // Classify blocker, log if hard, return synthetic response
}
```

#### 2. Session Idle Hook
```typescript
event: async ({ event }) => {
  if (event.type === "session.idle") {
    // Agent finished turn, waiting for input
    // Detect conversational questions, inject "continue" prompt
  }
}
```

#### 3. Stop Hook
```typescript
stop: async (input) => {
  // Agent tries to stop
  // Check if work remains, inject "continue" prompt if needed
  
  await client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text: "Continue with next task" }] }
  })
}
```

### Secondary Hooks (RECOMMENDED)

#### 4. System Prompt Transform
```typescript
"experimental.chat.system.transform": async (input, output) => {
  output.system.push(`<blocker-diverter-mode>
    Autonomous mode active. Log hard blockers, make default choices for soft questions.
  </blocker-diverter-mode>`)
}
```

#### 5. Compaction Hook
```typescript
"experimental.session.compacting": async (input, output) => {
  // Preserve blocker state across compaction
  output.context.push(`<active-blockers>${blockerSummary}</active-blockers>`)
}
```

#### 6. Tool Execution Hook
```typescript
"tool.execute.after": async (input) => {
  // Track progress (files modified, commits made)
  if (input.tool === "edit") {
    state.filesModified.push(input.args.filePath)
  }
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
  blockersFile: z.string().default("blockers.md"),
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
