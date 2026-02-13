# Blocker Diverter Plugin - Technical Plan

**Version**: 1.0.0  
**Date**: 2026-02-12  
**Status**: Ready for Implementation

---

## Executive Summary

A meta-agent pattern plugin that empowers AI agents to self-triage blockers by providing a synthetic `blocker` tool. Instead of auto-approving permissions, we inject instructions that let the AI decide: "Can I continue without this? If yes, log it and move on."

**Core Innovation**: AI becomes autonomous decision-maker, not passive automation recipient.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Session (AI Agent Active)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                       │
│  │ System Prompt   │ ← Inject blocker tool definition      │
│  │ Transform Hook  │   + triage instructions               │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────┐                  │
│  │ AI Agent (with blocker tool)       │                  │
│  │ • Sees blocker tool in toolset     │                  │
│  │ • Knows triage process             │                  │
│  │ • Can research + decide            │                  │
│  └──────┬──────────────────────┬───────┘                  │
│         │                      │                           │
│    ┌────▼─────┐          ┌────▼──────┐                   │
│    │ Needs    │          │ Encounters│                   │
│    │ Permission│         │ Question  │                   │
│    └────┬─────┘          └────┬──────┘                   │
│         │                      │                           │
│         └──────────┬───────────┘                           │
│                    │                                        │
│           ┌────────▼──────────┐                           │
│           │ Triage Decision   │                           │
│           │ • Hard blocker?   │                           │
│           │ • Soft question?  │                           │
│           │ • Truly needed?   │                           │
│           └────────┬──────────┘                           │
│                    │                                        │
│         ┌──────────┴──────────┐                           │
│         ▼                      ▼                           │
│  ┌────────────┐        ┌──────────────┐                  │
│  │ Call       │        │ Continue     │                  │
│  │ blocker    │        │ with default │                  │
│  │ tool       │        │ choice       │                  │
│  └─────┬──────┘        └──────────────┘                  │
│        │                                                   │
│        ▼                                                   │
│  ┌──────────────────────┐                                │
│  │ Tool Intercept Hook  │                                │
│  │ (catch blocker calls)│                                │
│  └─────┬────────────────┘                                │
│        │                                                   │
│        ▼                                                   │
│  ┌──────────────────────┐                                │
│  │ Write blockers.md    │                                │
│  │ (markdown checklist) │                                │
│  └─────┬────────────────┘                                │
│        │                                                   │
│        ▼                                                   │
│  ┌──────────────────────┐                                │
│  │ Return next tasks    │                                │
│  │ (AI continues work)  │                                │
│  └──────────────────────┘                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘

User Control:
  /blockers on|off|status|list|export
  Ctrl+Shift+B (hotkey toggle)
```

---

## Technology Stack

### Core Runtime
- **Bun**: JavaScript runtime (built-in shell, fast I/O, native TypeScript)
- **TypeScript 5.x**: Strict mode, no `any` types
- **Zod**: Schema validation for configs and blocker data

### OpenCode Integration
- `@opencode-ai/plugin`: Plugin SDK with hook types
- `@opencode-ai/sdk`: Client API (session.prompt, app.log, etc.)

### Development Tools
- **Bun Test**: Built-in test runner with coverage
- **ESLint + Prettier**: Code quality + formatting
- **TypeScript Compiler**: Type checking only (no transpilation needed with Bun)

### Key Dependencies
```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.0.0",
    "@opencode-ai/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/bun": "^1.0.0",
    "typescript": "^5.3.0",
    "eslint": "^8.56.0",
    "prettier": "^3.2.0"
  }
}
```

---

## Module Structure

### Core Modules (Target: 300-400 lines, HARD LIMIT: 500)

#### 1. `index.ts` (50-100 lines)
**Purpose**: Plugin entry point, hook registration  
**Exports**: `BlockerDiverter: Plugin`  
**Responsibilities**:
- Destructure context: `async ({ client, $, project, directory, worktree }) => ...`
- Load config from `opencode.json`
- Initialize session state Map
- Register all hooks
- Return hook object

**Key Pattern**:
```typescript
export const BlockerDiverter: Plugin = async ({ client, $, project, directory, worktree }) => {
  const config = loadConfig(directory)
  const state = new Map<string, SessionState>()
  
  return {
    "experimental.chat.system.transform": createSystemPromptHook(client, config),
    "tool.execute.before": createToolInterceptHook(client, state, config),
    "permission.asked": createPermissionHook(client, state, config),
    "stop": createStopHook(client, state, config),
    "event": createEventHook(client, state, config),
    "tui.command.execute": createCommandHook(client, state, config)
  }
}
```

#### 2. `types.ts` (100-150 lines)
**Purpose**: TypeScript interfaces, no logic  
**Key Types**:
```typescript
interface Blocker {
  id: string
  timestamp: string
  sessionId: string
  category: "permission" | "architecture" | "security" | "destructive" | "question" | "other"
  question: string
  context: string
  blocksProgress: boolean
  options?: string[]           // For soft blockers
  chosenOption?: string        // AI's decision
  chosenReasoning?: string     // Why AI chose it
  metadata?: {
    tool?: string              // Which tool triggered this
    filePath?: string          // Relevant file
    args?: Record<string, any> // Tool arguments
  }
}

interface SessionState {
  enabled: boolean
  blockers: Blocker[]
  lastBlockerTime: number
  cooldownHashes: Set<string>
  availableTasks: string[]
}

interface Config {
  enabled: boolean
  blockersFile: string
  maxBlockersPerRun: number
  cooldownMs: number
  hotkey: string
  softBlockerCategories: string[]
}
```

#### 3. `config.ts` (150-200 lines)
**Purpose**: Config loading, Zod validation  
**Functions**:
- `loadConfig(projectDir: string): Config`
- `validateConfig(raw: unknown): Config` (uses Zod)
- `getDefaultConfig(): Config`

**Zod Schema**:
```typescript
const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockersFile: z.string().default("blockers.md"),
  maxBlockersPerRun: z.number().int().positive().default(50),
  cooldownMs: z.number().int().positive().default(30000),
  hotkey: z.string().default("Ctrl+Shift+B"),
  softBlockerCategories: z.array(z.string()).default([
    "naming", "formatting", "style", "minor-refactor"
  ])
})
```

#### 4. `blocker-tool.ts` (200-300 lines)
**Purpose**: Synthetic tool definition + handler  
**Functions**:
- `getBlockerToolDefinition(): ToolDefinition` (returns tool schema)
- `handleBlockerToolCall(args: BlockerArgs, sessionId: string, state: SessionState): Promise<ToolResponse>`
- `generateNextTasksSuggestion(state: SessionState): string`

**Tool Definition**:
```typescript
export function getBlockerToolDefinition() {
  return {
    name: "blocker",
    description: "Log a blocker for user review. Use when you need human input to proceed with current task.",
    parameters: {
      type: "object",
      properties: {
        category: { 
          type: "string", 
          enum: ["permission", "architecture", "security", "destructive", "question", "other"]
        },
        question: { type: "string" },
        context: { type: "string" },
        blocksProgress: { type: "boolean" },
        options: { 
          type: "array", 
          items: { type: "string" },
          description: "For soft blockers: list 3 researched options"
        },
        chosenOption: { 
          type: "string",
          description: "For soft blockers: which option did you choose?"
        },
        chosenReasoning: {
          type: "string",
          description: "For soft blockers: why did you choose this option?"
        }
      },
      required: ["category", "question", "context", "blocksProgress"]
    }
  }
}
```

#### 5. `blockers-file.ts` (150-250 lines)
**Purpose**: File I/O for blockers.md  
**Functions**:
- `appendBlocker(blocker: Blocker, filePath: string): Promise<void>`
- `readBlockers(filePath: string): Promise<Blocker[]>`
- `formatBlockerMarkdown(blocker: Blocker): string`
- `initializeBlockersFile(filePath: string, sessionId: string): Promise<void>`

**Markdown Format**:
```markdown
## Session: abc123 — 2026-02-12 03:45:22

### Hard Blockers (require user decision)
- [ ] **[Architecture]** Which auth framework?
  - **Context**: Building login, need to choose Passport.js vs Auth0
  - **Blocks**: Yes — login feature blocked

### Soft Blockers (AI made choice)
- [x] **[Naming]** Function name: `getUserData` vs `fetchUserData`?
  - **Options**:
    1. getUserData (matches 8 existing controllers)
    2. fetchUserData (explicit about network call)
    3. retrieveUserData (less common)
  - **✓ Chosen**: getUserData
  - **Reasoning**: Consistent with existing codebase convention
```

#### 6. `task-tracker.ts` (200-300 lines)
**Purpose**: Track available tasks for AI  
**Functions**:
- `extractAvailableTasks(sessionContext: string): string[]`
- `updateTaskList(state: SessionState, newTasks: string[]): void`
- `suggestNextTask(state: SessionState): string | null`

**Strategy** (MVP: simple heuristics):
1. Parse TODO comments from modified files
2. Check uncommitted changes (files edited but not committed = tasks)
3. Extract numbered lists from recent messages
4. Fallback: "Review recent work, check for incomplete features"

#### 7. `prompt-templates.ts` (150-250 lines)
**Purpose**: Prompt text for system injection  
**Functions**:
- `getSystemPromptAddition(config: Config): string`
- `getTriagePrompt(triggerType: "permission" | "question" | "stop"): string`
- `getSoftBlockerResearchPrompt(): string`

**Example Template**:
```typescript
export function getSystemPromptAddition(config: Config): string {
  return `
<blocker-diverter-mode>
You have access to a special "blocker" tool for autonomous operation.

## When to use the blocker tool:
1. You need a permission (external directory, bash command, etc.)
2. You have a question that requires user input
3. You're blocked on an architectural decision
4. You need approval for destructive actions

## Triage Process:
1. Ask yourself: "Does this block my CURRENT task?"
   - If YES → Use blocker tool, then switch to different task
   - If NO → Make reasonable default choice OR skip this step

2. For soft questions (naming, formatting, minor details):
   - Research 3 options (check codebase patterns, docs)
   - Pick the best option
   - Log your choice with blocker tool (chosenOption field)
   - Continue with your choice

3. Available tasks (if blocked):
   ${config.availableTasks?.join('\n   ') || '- Check session context for TODOs'}

## Example blocker tool usage:
\`\`\`json
{
  "category": "permission",
  "question": "Need access to /mnt/backups directory",
  "context": "Running backup verification script",
  "blocksProgress": false,
  "options": ["Skip verification", "Use mock data", "Switch to database migration task"],
  "chosenOption": "Switch to database migration task",
  "chosenReasoning": "Migration is independent and high-priority"
}
\`\`\`
</blocker-diverter-mode>
`
}
```

---

## Hook Implementations

### Hook 1: System Prompt Transform
**File**: `hooks/system-prompt.ts`  
**Lines**: 100-150  
**Hook**: `experimental.chat.system.transform`

```typescript
export function createSystemPromptHook(client: Client, config: Config) {
  return async (input: any, output: any) => {
    if (!config.enabled) return
    
    const blockerToolDef = getBlockerToolDefinition()
    const promptAddition = getSystemPromptAddition(config)
    
    // Add blocker tool to available tools
    output.tools = output.tools || []
    output.tools.push(blockerToolDef)
    
    // Add triage instructions to system prompt
    output.system.push(promptAddition)
    
    await logInfo(client, "System prompt enhanced with blocker tool")
  }
}
```

### Hook 2: Tool Intercept
**File**: `hooks/tool-intercept.ts`  
**Lines**: 200-300  
**Hook**: `tool.execute.before`

```typescript
export function createToolInterceptHook(client: Client, state: Map<string, SessionState>, config: Config) {
  return async (input: any) => {
    if (input.tool !== "blocker") return // Let other tools pass through
    
    const sessionId = input.sessionID
    const sessionState = getState(state, sessionId)
    
    if (!sessionState.enabled) {
      await logInfo(client, "Blocker tool called but plugin disabled for session")
      return
    }
    
    // Validate blocker args with Zod
    const blocker: Blocker = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      sessionId,
      ...input.args
    }
    
    // Check cooldown (prevent spam)
    const hash = hashBlocker(blocker)
    if (sessionState.cooldownHashes.has(hash)) {
      await logInfo(client, "Duplicate blocker ignored (cooldown active)")
      return
    }
    
    // Write to blockers.md
    await appendBlocker(blocker, config.blockersFile)
    
    // Update session state
    sessionState.blockers.push(blocker)
    sessionState.cooldownHashes.add(hash)
    sessionState.lastBlockerTime = Date.now()
    
    // Return response to AI
    const nextTasks = generateNextTasksSuggestion(sessionState)
    return {
      type: "text",
      text: `✓ Blocker logged to ${config.blockersFile}\n\nNext steps:\n${nextTasks}`
    }
  }
}
```

### Hook 3: Permission Handler
**File**: `hooks/permission.ts`  
**Lines**: 150-250  
**Hook**: `permission.asked`

```typescript
export function createPermissionHook(client: Client, state: Map<string, SessionState>, config: Config) {
  return async (input: any, output: any) => {
    const sessionId = input.sessionID
    const sessionState = getState(state, sessionId)
    
    if (!sessionState.enabled) {
      return // Let normal permission flow happen
    }
    
    // Don't auto-approve — inject triage prompt
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{
          type: "text",
          text: getTriagePrompt("permission").replace(
            "{PERMISSION_TYPE}", input.permission
          ).replace(
            "{TOOL_NAME}", input.tool
          ).replace(
            "{TOOL_ARGS}", JSON.stringify(input.args, null, 2)
          )
        }]
      }
    })
    
    // Return "allow" so dialog doesn't block (AI will use blocker tool if needed)
    output.status = "allow"
  }
}
```

**Triage Prompt for Permissions**:
```
It seems you're trying to use the {TOOL_NAME} tool, which requires {PERMISSION_TYPE} permission.

Tool arguments:
{TOOL_ARGS}

Questions to consider:
1. Is this permission needed to complete your CURRENT task?
2. Can you defer this action and work on something else?
3. Is this a destructive operation that needs user approval?

If you decide you need this permission:
- Use the blocker tool to log it
- Specify: blocksProgress (true if you can't continue, false if you can switch tasks)
- Then either continue with fallback approach OR switch to different task

If this is a soft question (e.g., file naming, minor path choice):
- Research 3 options
- Pick one with reasoning
- Log with blocker tool (include chosenOption field)
- Continue with your choice
```

### Hook 4: Stop Handler
**File**: `hooks/stop.ts`  
**Lines**: 100-150  
**Hook**: `stop`

```typescript
export function createStopHook(client: Client, state: Map<string, SessionState>, config: Config) {
  return async (input: any) => {
    const sessionId = input.sessionID
    const sessionState = getState(state, sessionId)
    
    if (!sessionState.enabled) return
    
    // Check if work remains
    const hasUncommittedWork = await checkUncommittedWork($)
    const hasOpenBlockers = sessionState.blockers.filter(b => b.blocksProgress).length > 0
    const availableTasks = sessionState.availableTasks
    
    if (!hasUncommittedWork && !hasOpenBlockers && availableTasks.length === 0) {
      await logInfo(client, "Stop allowed — no remaining work")
      return // Let agent stop
    }
    
    // Inject "continue" prompt
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{
          type: "text",
          text: `
Before stopping, verify:
- Uncommitted work: ${hasUncommittedWork ? 'YES' : 'NO'}
- Blocking issues logged: ${hasOpenBlockers}
- Available tasks: ${availableTasks.length}

If work remains:
1. Continue with next available task
2. If all tasks blocked, summarize blockers in your stop message
3. Commit any completed work before stopping

Available tasks:
${availableTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}
`
        }]
      }
    })
  }
}
```

### Hook 5: Session Event Handler
**File**: `hooks/session.ts`  
**Lines**: 150-200  
**Hook**: `event`

```typescript
export function createEventHook(client: Client, state: Map<string, SessionState>, config: Config) {
  return async ({ event }: any) => {
    switch (event.type) {
      case "session.created":
        initializeState(state, event.session_id, config)
        await logInfo(client, `Session ${event.session_id} initialized`)
        break
        
      case "session.deleted":
        cleanupState(state, event.session_id)
        await logInfo(client, `Session ${event.session_id} cleaned up`)
        break
        
      case "session.idle":
        await handleSessionIdle(client, state, event.session_id, config)
        break
        
      case "message.updated":
        await detectConversationalQuestions(client, state, event)
        break
    }
  }
}

async function handleSessionIdle(client: Client, state: Map<string, SessionState>, sessionId: string, config: Config) {
  const sessionState = getState(state, sessionId)
  if (!sessionState.enabled) return
  
  // Agent finished turn, check if waiting unnecessarily
  if (sessionState.availableTasks.length > 0) {
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{
          type: "text",
          text: `You have ${sessionState.availableTasks.length} available tasks. Continue working:\n${sessionState.availableTasks.map((t, i) => `${i+1}. ${t}`).join('\n')}`
        }]
      }
    })
  }
}
```

### Hook 6: Command Handler
**File**: `hooks/command.ts`  
**Lines**: 200-300  
**Hook**: `tui.command.execute`

```typescript
export function createCommandHook(client: Client, state: Map<string, SessionState>, config: Config) {
  return async (input: any, output: any) => {
    if (input.command !== "/blockers") return
    
    const sessionId = input.sessionID
    const args = input.args || []
    const subcommand = args[0]
    
    switch (subcommand) {
      case "on":
        await handleBlockersOn(client, state, sessionId)
        break
      case "off":
        await handleBlockersOff(client, state, sessionId)
        break
      case "status":
        await handleBlockersStatus(client, state, sessionId, config)
        break
      case "list":
        await handleBlockersList(client, state, sessionId)
        break
      case "export":
        await handleBlockersExport(client, state, sessionId, config)
        break
      default:
        await client.app.log({
          level: "info",
          message: "Usage: /blockers [on|off|status|list|export]"
        })
    }
  }
}
```

---

## State Management

**Pattern**: Session-keyed Map (NOT global variables)

```typescript
// State initialization
export function initializeState(
  state: Map<string, SessionState>,
  sessionId: string,
  config: Config
): void {
  if (state.has(sessionId)) return
  
  state.set(sessionId, {
    enabled: config.enabled,
    blockers: [],
    lastBlockerTime: 0,
    cooldownHashes: new Set(),
    availableTasks: []
  })
}

// State cleanup
export function cleanupState(
  state: Map<string, SessionState>,
  sessionId: string
): void {
  state.delete(sessionId)
}

// State retrieval
export function getState(
  state: Map<string, SessionState>,
  sessionId: string
): SessionState {
  const sessionState = state.get(sessionId)
  if (!sessionState) {
    throw new Error(`Session ${sessionId} not initialized`)
  }
  return sessionState
}
```

---

## Testing Strategy

### Unit Tests (Target: 80%+ coverage)

**Test Files**:
- `blocker-tool.test.ts` — Tool definition, handler, response formatting
- `blockers-file.test.ts` — File I/O, markdown formatting, parsing
- `task-tracker.test.ts` — Task extraction, suggestion logic
- `prompt-templates.test.ts` — Template rendering, variable substitution
- `config.test.ts` — Zod validation, default values, error handling

**Example Test**:
```typescript
describe('blocker-tool', () => {
  it('should generate valid tool definition', () => {
    const def = getBlockerToolDefinition()
    expect(def.name).toBe("blocker")
    expect(def.parameters.required).toContain("category")
  })
  
  it('should handle soft blocker with chosen option', async () => {
    const args = {
      category: "naming",
      question: "Function name?",
      context: "Adding user endpoint",
      blocksProgress: false,
      options: ["getUserData", "fetchUserData", "retrieveUserData"],
      chosenOption: "getUserData",
      chosenReasoning: "Matches existing convention"
    }
    
    const response = await handleBlockerToolCall(args, "session123", mockState)
    expect(response.text).toContain("✓ Blocker logged")
    expect(mockState.blockers).toHaveLength(1)
    expect(mockState.blockers[0].chosenOption).toBe("getUserData")
  })
})
```

### Integration Tests

**Test Files**:
- `hooks-integration.test.ts` — End-to-end hook behavior
- `plugin-lifecycle.test.ts` — Plugin load, state init, cleanup

**Example Test**:
```typescript
describe('Plugin Integration', () => {
  it('should inject system prompt and handle blocker tool call', async () => {
    const mockClient = createMockClient()
    const plugin = await BlockerDiverter({ client: mockClient, ... })
    
    // Simulate system prompt transform
    const systemOutput = { system: [], tools: [] }
    await plugin["experimental.chat.system.transform"]({}, systemOutput)
    
    expect(systemOutput.tools).toHaveLength(1)
    expect(systemOutput.tools[0].name).toBe("blocker")
    expect(systemOutput.system[0]).toContain("blocker-diverter-mode")
    
    // Simulate blocker tool call
    const toolInput = { tool: "blocker", sessionID: "test", args: { ... } }
    const response = await plugin["tool.execute.before"](toolInput)
    
    expect(response.text).toContain("✓ Blocker logged")
  })
})
```

---

## Security Considerations

### Input Validation
- ✅ Validate blocker tool args with Zod (prevent malformed data)
- ✅ Sanitize file paths (no directory traversal: `../../etc/passwd`)
- ✅ Limit blocker file size (rotate after 10MB or 1000 entries)
- ✅ Rate limit blocker tool calls (cooldown hash, max per session)

### Secrets Protection
- ✅ Never log sensitive tool args (bash commands with tokens, API keys)
- ✅ Redact patterns: `password=`, `token=`, `apiKey=`, `secret=`
- ✅ Config validation: warn if blockersFile path is outside project directory

### Permission Model
- ✅ Respect OpenCode's permission system (no bypasses)
- ✅ Inject triage prompts, don't auto-approve silently
- ✅ Log all permission decisions for audit trail

---

## Performance Requirements

### Latency Targets
- System prompt injection: <5ms (synchronous operation)
- Blocker tool call handling: <50ms (file append + response generation)
- Permission hook: <10ms (prompt injection only)
- Task extraction: <100ms (parse session context)

### Resource Limits
- Max blockers per session: 50 (configurable)
- Blocker file max size: 10MB (auto-rotate)
- Cooldown duration: 30 seconds (prevent duplicate logging)
- Session state memory: <1MB per session

### Optimization Strategies
- Debounce duplicate blocker detection (hash-based cooldown)
- Lazy task parsing (only when blocker tool called)
- Async file I/O (never block event loop)
- Structured logging (avoid expensive string formatting)

---

## Error Handling

### Failure Modes
1. **Blocker file write fails** → Log error, keep in-memory state, retry on next call
2. **Session state not found** → Auto-initialize (defensive programming)
3. **Invalid blocker tool args** → Return error message to AI, suggest correct format
4. **Config load fails** → Use default config, log warning
5. **Permission hook crashes** → Fail safe (allow permission to avoid blocking user)

### Error Recovery
```typescript
try {
  await appendBlocker(blocker, config.blockersFile)
} catch (error) {
  await logError(client, "Failed to write blocker to file", error)
  // Keep in-memory state, will retry on next blocker
  return {
    type: "text",
    text: "⚠️ Blocker logged to memory (file write failed). Will retry on next blocker."
  }
}
```

---

## Configuration Schema

### opencode.json Example
```json
{
  "plugins": ["opencode-blocker-diverter"],
  "blockerDiverter": {
    "enabled": true,
    "blockersFile": "blockers.md",
    "maxBlockersPerRun": 50,
    "cooldownMs": 30000,
    "hotkey": "Ctrl+Shift+B",
    "softBlockerCategories": ["naming", "formatting", "style"]
  }
}
```

### Zod Schema (Full)
```typescript
const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockersFile: z.string().default("blockers.md"),
  maxBlockersPerRun: z.number().int().positive().default(50),
  cooldownMs: z.number().int().positive().default(30000),
  hotkey: z.string().default("Ctrl+Shift+B"),
  softBlockerCategories: z.array(z.string()).default([
    "naming", "formatting", "style", "minor-refactor"
  ])
}).strict()
```

---

## Deployment Plan

### Phase 1: MVP (v0.1.0)
**Timeline**: 2-3 days  
**Scope**:
- ✅ Core hook implementations (system prompt, tool intercept, permission, stop)
- ✅ Blocker tool definition + handler
- ✅ Markdown file writing
- ✅ `/blockers` command (on/off/status/list)
- ✅ Basic task tracking (heuristic-based)
- ✅ Unit tests (80%+ coverage)

**Out of Scope**:
- Hotkey implementation (TUI API unclear)
- Compaction hook (deferred to v0.2.0)
- Advanced task parsing (smart context analysis)

### Phase 2: Polish (v0.2.0)
**Timeline**: 1 week  
**Scope**:
- Hotkey implementation (research TUI API)
- Compaction hook (preserve state across session compression)
- Advanced task parsing (parse TODOs, extract structured lists)
- Blocker analytics (which categories most common?)
- Performance benchmarks

### Phase 3: Ecosystem (v1.0.0)
**Timeline**: 2 weeks  
**Scope**:
- NPM package publishing
- OpenCode plugin marketplace submission
- Documentation site (examples, tutorials)
- Community feedback integration
- Multi-session blocker aggregation

---

## Success Metrics

### Functional Requirements (Must-Have)
- [ ] AI can log blockers using synthetic `blocker` tool
- [ ] Hard blockers → AI switches to different task
- [ ] Soft questions → AI researches options, picks one, logs choice
- [ ] Permission requests → AI decides if truly needed
- [ ] Stop prevention → AI checks for remaining work
- [ ] Blockers written to `blockers.md` in checklist format
- [ ] `/blockers` command works (on/off/status/list)

### Quality Requirements (Must-Have)
- [ ] 80%+ test coverage
- [ ] All TypeScript strict mode (no `any`)
- [ ] All modules <500 lines (hard limit)
- [ ] ESLint + Prettier passing
- [ ] No security warnings (file path validation, secrets redaction)

### UX Requirements (Nice-to-Have)
- [ ] Hotkey implementation (Ctrl+Shift+B toggle)
- [ ] Rich blocker format (tables, code blocks)
- [ ] Blocker analytics dashboard
- [ ] Multi-session aggregation

---

## Open Questions (Track in Implementation)

1. **Task parsing reliability**: How accurately can we extract "available tasks"?
   - Measure: % of sessions where AI successfully switches tasks when blocked
   - Target: >70% task switch success rate

2. **Blocker categorization accuracy**: Do AI agents correctly classify hard vs soft?
   - Measure: Manual review of 100 logged blockers
   - Target: <10% miscategorization rate

3. **TUI hotkey API**: Does OpenCode expose key binding registration?
   - Research: Check plugin SDK types, community examples
   - Fallback: Command-only for MVP

4. **Compaction state preservation**: Does injecting context work reliably?
   - Test: Trigger compaction, verify blockers survive
   - Alternative: Persist to .opencode/state.json

---

## Next Steps (Implementation)

1. **Create project structure** (directories, package.json, tsconfig.json)
2. **Implement core types** (`types.ts`, `config.ts`) — TDD: write tests first
3. **Build blocker tool** (`blocker-tool.ts`) — TDD: test tool definition, handler
4. **Implement file I/O** (`blockers-file.ts`) — TDD: test markdown formatting
5. **Create hook implementations** (`hooks/*.ts`) — TDD: test each hook in isolation
6. **Wire up plugin entry** (`index.ts`) — Integration tests
7. **Add command handler** (`commands/blockers-cmd.ts`) — TDD: test each subcommand
8. **Build task tracker** (`task-tracker.ts`) — TDD: test task extraction
9. **Create prompt templates** (`prompt-templates.ts`) — Test rendering
10. **Run full test suite** (`bun test --coverage`) — Verify 80%+ coverage
11. **Manual testing** (load plugin in OpenCode, trigger blockers)
12. **Documentation** (update README with examples)

---

**Status**: Plan approved ✅  
**Next Command**: `/speckit.tasks` to generate actionable task breakdown
