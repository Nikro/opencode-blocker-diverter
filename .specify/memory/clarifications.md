# Blocker Diverter - Clarifications

**Date**: 2026-02-12  
**Status**: Approved by user

## Core Architecture Decision

### NOT Auto-Approve — Meta-Agent Pattern

The plugin does **NOT** auto-approve permissions or answer questions for the AI. Instead, it:

1. **Intercepts ALL interactive prompts** (permissions, questions, stop signals)
2. **Injects new instructions** via system prompt that give the AI a `blocker` tool
3. **Empowers the AI** to self-triage: "Can I continue without this? If yes, log blocker and move to next task."

**Analogy**: Like `/clarify` workflow — give the AI structured options to handle uncertainty autonomously.

---

## Design Decisions

### 1. Interception Scope
**Decision**: Intercept ALL interactive prompts  
**Includes**:
- `permission.asked` (bash, edit, external_directory, etc.)
- `question` tool invocations (AI asking user for input)
- `stop` hook (AI thinks it's done)
- Session idle (AI waiting for user prompt)

**Implementation Strategy**:
When any interrupt occurs, inject a prompt like:
```
It seems you're trying to [access external folder / ask a question / stop work].

Is this blocking your current task?
- If YES: Use the `blocker` tool to log it (include: what you need, why, does it block progress?)
- If NO: Make a reasonable choice OR move to the next independent task

Available independent tasks:
- [task 1]
- [task 2]
```

### 2. Classification Strategy
**Decision**: Use current session's model OR OpenCode's configured "small model"  
**No external LLM API calls** (no OpenAI/Anthropic dependencies)

**Approach**: Prompt-based self-classification
- AI decides: "Is this a hard blocker (architecture, security, destructive) or soft question (naming, formatting)?"
- Hard blocker → Log with `blocker` tool, move to next task
- Soft question → Research 3 options, pick one with explanation, log choice, continue

**Key Innovation**: We're not classifying externally — we're giving the AI a framework to classify its own blockers.

### 3. Blocker Tool Design
**Decision**: Add synthetic `blocker` tool to AI's available tools

**Tool Signature**:
```typescript
{
  name: "blocker",
  description: "Log a blocker for user review (use when you need human input to proceed with current task)",
  parameters: {
    type: "object",
    properties: {
      category: { 
        type: "string", 
        enum: ["permission", "architecture", "security", "destructive", "question", "other"],
        description: "Type of blocker"
      },
      question: {
        type: "string",
        description: "What do you need from the user?"
      },
      context: {
        type: "string",
        description: "What were you trying to do? Why is this needed?"
      },
      blocksProgress: {
        type: "boolean",
        description: "Does this block ALL work, or can you switch to another task?"
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "If soft blocker, list 3 researched options (you'll pick one)"
      },
      chosenOption: {
        type: "string",
        description: "If soft blocker, which option did you choose? Explain why."
      }
    },
    required: ["category", "question", "context", "blocksProgress"]
  }
}
```

**Tool Response**: 
```
✓ Blocker logged to blockers.md
Next steps: [list of other available tasks]
```

### 4. Blocker Log Format
**Decision**: Markdown checklist (user selected "Recommended")

**Template**:
```markdown
## Session: [session_id] — [timestamp]

### Hard Blockers (require user decision)
- [ ] **[Architecture]** Which framework for auth?
  - **Context**: Building login system, need to choose between Passport.js vs Auth0
  - **Why needed**: Affects database schema, security model
  - **Blocks**: Login feature implementation

### Soft Blockers (AI made default choice)
- [x] **[Naming]** Should function be `getUserData` or `fetchUserData`?
  - **Context**: Creating user API endpoint
  - **Options researched**: 
    1. `getUserData` - Matches existing controller pattern
    2. `fetchUserData` - More explicit about network call
    3. `retrieveUserData` - Generic, less common in codebase
  - **✓ Chosen**: `getUserData` (consistent with 8 existing controllers, team convention)

### Permissions Requested
- [ ] **[External Directory]** Access to `/mnt/backups`
  - **Context**: Running backup script
  - **Blocks**: No — switched to database migration task
```

### 5. Session State Management
**Decision**: In-memory only (MVP), leave compaction hook stubbed for future

**Rationale**: Simpler implementation, acceptable for overnight runs (state resets on restart is fine)

**Future Enhancement**: `experimental.session.compacting` hook to inject blocker summary into session context

### 6. User Controls
**Decision**: Both command + hotkey

**Command Interface**:
```
/blockers on         # Enable for current session
/blockers off        # Disable (AI will ask user normally)
/blockers status     # Show: enabled/disabled, blocker count, session state
/blockers list       # Print current session's blockers
/blockers export     # Write blockers.md to workspace root
```

**Hotkey**: `Ctrl+Shift+B` (toggle on/off)  
**Conflict Detection**: Check OpenCode's default bindings, warn if collision

### 7. Soft Blocker Handling
**Decision**: AI researches 3 options, picks one with explanation

**Prompt Pattern**:
```
This appears to be a soft question (naming, formatting, minor implementation detail).

Required process:
1. Research 3 viable options (check codebase patterns, docs, conventions)
2. List pros/cons for each
3. Pick the option you recommend most
4. Explain your reasoning (1-2 sentences)
5. Log your choice using `blocker` tool (with chosenOption field)
6. Continue with your chosen approach

Example:
- Option 1: camelCase (matches 90% of existing functions)
- Option 2: snake_case (Python style, inconsistent here)
- Option 3: PascalCase (for classes only)
✓ Chosen: camelCase — aligns with project convention
```

---

## Implementation Implications

### New Architecture Components

1. **System Prompt Injection** (`experimental.chat.system.transform` hook)
   - Add `blocker` tool definition
   - Add triage instructions
   - Add soft blocker research process

2. **Blocker Tool Handler** (synthetic tool, not real OpenCode tool)
   - Intercept tool calls in `tool.execute.before` hook
   - If `tool === "blocker"`, handle specially (write to blockers.md, return success)
   - Return synthetic response with next available tasks

3. **Task List Tracker** (new module: `task-tracker.ts`)
   - Parse session context for TODO items, unfinished work
   - When blocker logged, suggest: "Available tasks: [list]"

4. **Permission/Question Interceptor** (modified approach)
   - Don't auto-approve — inject "Use blocker tool if needed" prompt
   - Example: `permission.asked` → return synthetic user message: "Do you need external directory access to continue your CURRENT task? If not, log blocker and switch tasks."

5. **Stop Hook Handler** (prevent premature exit)
   - When AI tries to stop: "Check for incomplete tasks. If work remains, continue. If truly blocked, summarize blockers in final message."

### Removed Components
- ❌ External LLM classification (was: OpenAI API for hard/soft detection)
- ❌ Auto-approve logic (was: synthetic "allow" responses)
- ❌ Complex config for soft defaults (was: JSON map of rules)

### Key Files (Revised)
```
.opencode/plugin/blocker-diverter/
├── index.ts              # Hook registration
├── types.ts              # Blocker interface, Config schema
├── config.ts             # Load opencode.json settings
├── blocker-tool.ts       # Synthetic tool definition + handler
├── blockers-file.ts      # Write markdown checklist format
├── task-tracker.ts       # Parse session for available tasks
├── hooks/
│   ├── system-prompt.ts  # Inject blocker tool + triage instructions
│   ├── tool-intercept.ts # Catch blocker tool calls
│   ├── permission.ts     # Inject "use blocker tool?" prompt
│   ├── stop.ts           # Prevent exit, check remaining work
│   └── session.ts        # State init/cleanup, idle handling
├── commands/
│   └── blockers-cmd.ts   # /blockers [on|off|status|list|export]
└── utils/
    ├── prompt-templates.ts  # Triage prompt, soft blocker research prompt
    └── logging.ts           # Structured logging
```

---

## Open Questions (Deferred to Implementation)

1. **Task parsing strategy**: How to reliably extract "available tasks" from session context?
   - Option A: Parse todo lists, unfinished code sections
   - Option B: Ask AI to maintain explicit task list in working memory
   - Option C: Simple heuristic (files modified but not committed = tasks)

2. **Blocker tool discoverability**: How does AI know `blocker` tool exists?
   - Option A: System prompt injection (current plan)
   - Option B: Add to OpenCode's tool registry (requires SDK support)
   - Option C: Inject as initial user message when plugin enabled

3. **Hotkey implementation**: TUI integration unclear
   - Research: Does OpenCode plugin API expose key binding registration?
   - Fallback: Command-only for MVP, document hotkey as future enhancement

---

## Success Criteria (Revised)

### MVP (v0.1.0) must demonstrate:
1. ✅ AI can log blockers using synthetic `blocker` tool
2. ✅ Hard blockers logged → AI switches to different task
3. ✅ Soft questions → AI researches options, picks one, logs choice
4. ✅ Permission requests → AI decides if truly needed
5. ✅ Stop prevention → AI checks for remaining work before exiting
6. ✅ Blockers written to `blockers.md` in checklist format
7. ✅ `/blockers` command controls enable/disable

### Future Enhancements (v0.2.0+):
- Compaction hook integration (persist state)
- Hotkey implementation (if TUI API available)
- Task list auto-parsing (smart context analysis)
- Blocker analytics (which categories most common?)
- Multi-session blocker aggregation
