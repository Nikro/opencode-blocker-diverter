# Blocker Diverter Plugin - Implementation Tasks

**Version**: 1.0.0  
**Date**: 2026-02-12  
**Status**: Ready for Execution

---

## Task Breakdown Strategy

This task list follows **Test-Driven Development (TDD)** principles:
1. Write tests FIRST (they should fail)
2. Implement to pass tests
3. Refactor while keeping tests green

**Estimated Timeline**: 2-3 days for MVP (v0.1.0)

---

## Phase 1: Project Foundation (2-3 hours)

### Task 1.1: Initialize Project Structure
**Priority**: HIGH  
**Estimated Time**: 30 minutes  
**Dependencies**: None

**Acceptance Criteria**:
- [ ] Directory structure created: `.opencode/plugin/blocker-diverter/`
- [ ] Subdirectories: `hooks/`, `commands/`, `utils/`, `tests/`
- [ ] `package.json` created with dependencies
- [ ] `tsconfig.json` with strict mode enabled
- [ ] `.eslintrc.json` and `.prettierrc` configured
- [ ] `bun install` runs successfully

**Files to Create**:
```
.opencode/plugin/blocker-diverter/
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── hooks/
├── commands/
├── utils/
└── tests/
```

### Task 1.2: Set Up Testing Infrastructure
**Priority**: HIGH  
**Estimated Time**: 30 minutes  
**Dependencies**: Task 1.1

**Acceptance Criteria**:
- [ ] `bun test` command runs (even with no tests)
- [ ] Test utilities created: mock client, mock context
- [ ] Coverage reporting configured
- [ ] Test file naming convention established (`*.test.ts`)

**Files to Create**:
- `tests/setup.ts` — Test utilities
- `tests/mocks.ts` — Mock OpenCode client/context

### Task 1.3: Create Type Definitions
**Priority**: HIGH  
**Estimated Time**: 1 hour  
**Dependencies**: Task 1.1

**Acceptance Criteria**:
- [ ] `types.ts` created with all interfaces
- [ ] JSDoc comments for each interface
- [ ] No compilation errors (`bun run typecheck`)
- [ ] Interfaces match plan specification

**Files to Create**:
- `types.ts` (100-150 lines)

**Key Types**:
- `Blocker` interface
- `SessionState` interface
- `Config` interface
- `BlockerArgs` interface
- `ToolDefinition` interface

---

## Phase 2: Core Infrastructure (4-5 hours)

### Task 2.1: Implement Configuration Module (TDD)
**Priority**: HIGH  
**Estimated Time**: 1.5 hours  
**Dependencies**: Task 1.3

**Test-First Approach**:
1. Write `config.test.ts` FIRST:
   - Test default config loading
   - Test Zod validation (valid cases)
   - Test Zod validation (invalid cases)
   - Test opencode.json parsing
   - Test error handling (file not found)

2. Implement `config.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass (`bun test config.test.ts`)
- [ ] Zod schema validates correctly
- [ ] Default config values applied
- [ ] Error handling for missing/invalid config
- [ ] Module <200 lines

**Files to Create**:
- `tests/config.test.ts` (write FIRST)
- `config.ts` (implement SECOND)

### Task 2.2: Implement Session State Management (TDD)
**Priority**: HIGH  
**Estimated Time**: 1 hour  
**Dependencies**: Task 1.3

**Test-First Approach**:
1. Write `state.test.ts` FIRST:
   - Test state initialization
   - Test state retrieval
   - Test state cleanup
   - Test multiple sessions in parallel

2. Implement `state.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Session-keyed Map pattern implemented
- [ ] Defensive programming (auto-init if missing)
- [ ] Module <200 lines

**Files to Create**:
- `tests/state.test.ts` (write FIRST)
- `state.ts` (implement SECOND)

### Task 2.3: Implement Blocker File I/O (TDD)
**Priority**: HIGH  
**Estimated Time**: 2 hours  
**Dependencies**: Task 1.3

**Test-First Approach**:
1. Write `blockers-file.test.ts` FIRST:
   - Test markdown formatting (hard blocker)
   - Test markdown formatting (soft blocker with choice)
   - Test file initialization
   - Test append operation
   - Test file reading/parsing
   - Test error handling (write failure)

2. Implement `blockers-file.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Markdown format matches specification
- [ ] Async file I/O (Bun shell API)
- [ ] Error handling (write failures)
- [ ] Module <250 lines

**Files to Create**:
- `tests/blockers-file.test.ts` (write FIRST)
- `blockers-file.ts` (implement SECOND)

---

## Phase 3: Blocker Tool System (3-4 hours)

### Task 3.1: Implement Blocker Tool Definition (TDD)
**Priority**: HIGH  
**Estimated Time**: 1.5 hours  
**Dependencies**: Task 2.1, 2.2, 2.3

**Test-First Approach**:
1. Write `blocker-tool.test.ts` FIRST:
   - Test tool definition schema
   - Test hard blocker handling
   - Test soft blocker handling (with chosenOption)
   - Test cooldown deduplication
   - Test next tasks suggestion

2. Implement `blocker-tool.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Tool definition valid JSON schema
- [ ] Handler writes to blockers.md
- [ ] Handler updates session state
- [ ] Cooldown hash prevents duplicates
- [ ] Module <300 lines

**Files to Create**:
- `tests/blocker-tool.test.ts` (write FIRST)
- `blocker-tool.ts` (implement SECOND)

### Task 3.2: Implement Prompt Templates (TDD)
**Priority**: MEDIUM  
**Estimated Time**: 1.5 hours  
**Dependencies**: Task 2.1

**Test-First Approach**:
1. Write `prompt-templates.test.ts` FIRST:
   - Test system prompt addition rendering
   - Test triage prompt rendering (permission)
   - Test triage prompt rendering (question)
   - Test soft blocker research prompt
   - Test variable substitution

2. Implement `prompt-templates.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Templates include blocker tool instructions
- [ ] Variable substitution works correctly
- [ ] Module <250 lines

**Files to Create**:
- `tests/prompt-templates.test.ts` (write FIRST)
- `utils/prompt-templates.ts` (implement SECOND)

### Task 3.3: Implement Task Tracker (TDD)
**Priority**: MEDIUM  
**Estimated Time**: 1 hour  
**Dependencies**: Task 1.3

**Test-First Approach**:
1. Write `task-tracker.test.ts` FIRST:
   - Test TODO extraction from text
   - Test numbered list parsing
   - Test task suggestion logic
   - Test empty state handling

2. Implement `task-tracker.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Heuristic-based task extraction works
- [ ] Fallback task suggestions provided
- [ ] Module <300 lines

**Files to Create**:
- `tests/task-tracker.test.ts` (write FIRST)
- `task-tracker.ts` (implement SECOND)

---

## Phase 4: Hook Implementations (4-5 hours)

### Task 4.1: Implement System Prompt Hook (TDD)
**Priority**: HIGH  
**Estimated Time**: 1 hour  
**Dependencies**: Task 3.1, 3.2

**Test-First Approach**:
1. Write `hooks/system-prompt.test.ts` FIRST:
   - Test blocker tool added to output.tools
   - Test system prompt addition appended
   - Test config.enabled flag respected
   - Test hook signature matches OpenCode API

2. Implement `hooks/system-prompt.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `experimental.chat.system.transform`
- [ ] Blocker tool definition injected
- [ ] Triage instructions injected
- [ ] Module <150 lines

**Files to Create**:
- `tests/hooks/system-prompt.test.ts` (write FIRST)
- `hooks/system-prompt.ts` (implement SECOND)

### Task 4.2: Implement Tool Intercept Hook (TDD)
**Priority**: HIGH  
**Estimated Time**: 1.5 hours  
**Dependencies**: Task 3.1, 2.2, 2.3

**Test-First Approach**:
1. Write `hooks/tool-intercept.test.ts` FIRST:
   - Test blocker tool call interception
   - Test other tools pass through
   - Test blocker written to file
   - Test session state updated
   - Test cooldown deduplication
   - Test response format

2. Implement `hooks/tool-intercept.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `tool.execute.before`
- [ ] Blocker tool calls intercepted
- [ ] File write + state update
- [ ] Module <300 lines

**Files to Create**:
- `tests/hooks/tool-intercept.test.ts` (write FIRST)
- `hooks/tool-intercept.ts` (implement SECOND)

### Task 4.3: Implement Permission Hook (TDD)
**Priority**: HIGH  
**Estimated Time**: 1 hour  
**Dependencies**: Task 3.2

**Test-First Approach**:
1. Write `hooks/permission.test.ts` FIRST:
   - Test triage prompt injection
   - Test "allow" status returned
   - Test config.enabled flag respected
   - Test different permission types

2. Implement `hooks/permission.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `permission.asked`
- [ ] Triage prompt injected via client.session.prompt
- [ ] Returns `output.status = "allow"`
- [ ] Module <250 lines

**Files to Create**:
- `tests/hooks/permission.test.ts` (write FIRST)
- `hooks/permission.ts` (implement SECOND)

### Task 4.4: Implement Stop Hook (TDD)
**Priority**: MEDIUM  
**Estimated Time**: 1 hour  
**Dependencies**: Task 2.2, 3.3

**Test-First Approach**:
1. Write `hooks/stop.test.ts` FIRST:
   - Test stop allowed when no work remains
   - Test continue prompt when work remains
   - Test uncommitted work detection
   - Test blocker presence check

2. Implement `hooks/stop.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `stop`
- [ ] Checks uncommitted work (via Bun shell)
- [ ] Injects continue prompt if needed
- [ ] Module <150 lines

**Files to Create**:
- `tests/hooks/stop.test.ts` (write FIRST)
- `hooks/stop.ts` (implement SECOND)

### Task 4.5: Implement Session Event Hook (TDD)
**Priority**: MEDIUM  
**Estimated Time**: 1 hour  
**Dependencies**: Task 2.2, 3.3

**Test-First Approach**:
1. Write `hooks/session.test.ts` FIRST:
   - Test session.created → state init
   - Test session.deleted → state cleanup
   - Test session.idle → continue prompt
   - Test message.updated → question detection

2. Implement `hooks/session.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `event`
- [ ] Handles multiple event types
- [ ] Session lifecycle managed correctly
- [ ] Module <200 lines

**Files to Create**:
- `tests/hooks/session.test.ts` (write FIRST)
- `hooks/session.ts` (implement SECOND)

---

## Phase 5: User Interface (2-3 hours)

### Task 5.1: Implement /blockers Command (TDD)
**Priority**: HIGH  
**Estimated Time**: 2 hours  
**Dependencies**: Task 2.2, 2.3

**Test-First Approach**:
1. Write `commands/blockers-cmd.test.ts` FIRST:
   - Test `/blockers on` → enables session
   - Test `/blockers off` → disables session
   - Test `/blockers status` → shows state
   - Test `/blockers list` → prints blockers
   - Test `/blockers export` → writes file
   - Test invalid subcommand → shows usage

2. Implement `commands/blockers-cmd.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] All subcommands implemented
- [ ] User-friendly output messages
- [ ] Module <300 lines

**Files to Create**:
- `tests/commands/blockers-cmd.test.ts` (write FIRST)
- `commands/blockers-cmd.ts` (implement SECOND)

### Task 5.2: Implement Command Hook (TDD)
**Priority**: HIGH  
**Estimated Time**: 30 minutes  
**Dependencies**: Task 5.1

**Test-First Approach**:
1. Write `hooks/command.test.ts` FIRST:
   - Test `/blockers` command routing
   - Test other commands pass through
   - Test sessionID extraction

2. Implement `hooks/command.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Hook registered as `tui.command.execute`
- [ ] Routes to command handler
- [ ] Module <100 lines

**Files to Create**:
- `tests/hooks/command.test.ts` (write FIRST)
- `hooks/command.ts` (implement SECOND)

---

## Phase 6: Plugin Entry Point (1-2 hours)

### Task 6.1: Implement Plugin Index (Integration Test)
**Priority**: HIGH  
**Estimated Time**: 1.5 hours  
**Dependencies**: All previous tasks

**Test-First Approach**:
1. Write `tests/index.test.ts` FIRST:
   - Test plugin exports correct type
   - Test all hooks registered
   - Test config loaded
   - Test state Map initialized
   - Test context destructuring correct

2. Implement `index.ts` to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Plugin export: `export const BlockerDiverter: Plugin`
- [ ] Context destructured correctly: `async ({ client, $, project, directory, worktree }) => ...`
- [ ] All hooks wired up
- [ ] Module <100 lines

**Files to Create**:
- `tests/index.test.ts` (write FIRST)
- `index.ts` (implement SECOND)

---

## Phase 7: Quality & Polish (2-3 hours)

### Task 7.1: Add Utility Functions
**Priority**: MEDIUM  
**Estimated Time**: 1 hour  
**Dependencies**: None

**Files to Create**:
- `utils/logging.ts` — Structured logging helpers
- `utils/deduplication.ts` — Cooldown hash, dedupe logic
- `utils/validation.ts` — Path sanitization, input validation

**Test-First Approach**:
1. Write tests for each utility module
2. Implement to pass tests

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Each module <200 lines
- [ ] Functions are pure (no side effects)

### Task 7.2: Full Test Suite Execution
**Priority**: HIGH  
**Estimated Time**: 30 minutes  
**Dependencies**: All previous tasks

**Acceptance Criteria**:
- [ ] `bun test` passes (all tests green)
- [ ] `bun test --coverage` shows >80% coverage
- [ ] `bun run typecheck` passes (no TypeScript errors)
- [ ] `bun run lint` passes (no ESLint errors)
- [ ] `bun run format` passes (Prettier)

### Task 7.3: Manual Testing
**Priority**: HIGH  
**Estimated Time**: 1 hour  
**Dependencies**: Task 6.1

**Test Scenarios**:
1. Load plugin in OpenCode
2. Enable with `/blockers on`
3. Trigger permission request → verify triage prompt
4. Use blocker tool → verify markdown written
5. Test soft blocker → verify AI researches options
6. Test stop prevention → verify continue prompt
7. Check `blockers.md` format
8. Test `/blockers status`, `/blockers list`

**Acceptance Criteria**:
- [ ] All scenarios work as expected
- [ ] No runtime errors in OpenCode logs
- [ ] Blockers.md format correct

---

## Phase 8: Documentation (1-2 hours)

### Task 8.1: Update README with Examples
**Priority**: MEDIUM  
**Estimated Time**: 1 hour  
**Dependencies**: Task 7.3

**Content to Add**:
- Real-world examples (screenshots/text)
- Blocker tool usage examples
- Configuration examples
- Troubleshooting section updates

**Acceptance Criteria**:
- [ ] Examples clear and accurate
- [ ] Configuration documented
- [ ] Troubleshooting covers common issues

### Task 8.2: Create CHANGELOG.md
**Priority**: LOW  
**Estimated Time**: 30 minutes  
**Dependencies**: Task 7.3

**Content**:
```markdown
# Changelog

## [0.1.0] - 2026-02-12

### Added
- Core blocker tool system
- Permission, stop, session hooks
- /blockers command (on/off/status/list/export)
- Markdown checklist format for blockers.md
- Task tracking (heuristic-based)
- Soft blocker research workflow

### Known Limitations
- No hotkey implementation (TUI API unclear)
- No compaction hook (deferred to v0.2.0)
- Task parsing is heuristic-based (not AI-powered)
```

**Acceptance Criteria**:
- [ ] All features documented
- [ ] Known limitations listed
- [ ] Version number matches package.json

---

## Task Execution Order (Critical Path)

**Day 1** (Focus: Foundation + Core Infrastructure):
1. Task 1.1 → Task 1.2 → Task 1.3 (Project setup)
2. Task 2.1 → Task 2.2 → Task 2.3 (Config, state, file I/O)

**Day 2** (Focus: Blocker Tool + Hooks):
3. Task 3.1 → Task 3.2 → Task 3.3 (Blocker tool, templates, task tracker)
4. Task 4.1 → Task 4.2 → Task 4.3 (Critical hooks)

**Day 3** (Focus: Remaining Hooks + Integration):
5. Task 4.4 → Task 4.5 (Stop, session hooks)
6. Task 5.1 → Task 5.2 (Commands)
7. Task 6.1 (Plugin entry point)
8. Task 7.1 → Task 7.2 → Task 7.3 (Quality & testing)
9. Task 8.1 → Task 8.2 (Documentation)

---

## Dependencies Graph

```
Task 1.1 (Project Setup)
  ├── Task 1.2 (Testing Infrastructure)
  └── Task 1.3 (Type Definitions)
       ├── Task 2.1 (Config Module)
       ├── Task 2.2 (State Management)
       └── Task 2.3 (File I/O)
            ├── Task 3.1 (Blocker Tool)
            │    ├── Task 4.1 (System Prompt Hook)
            │    └── Task 4.2 (Tool Intercept Hook)
            ├── Task 3.2 (Prompt Templates)
            │    ├── Task 4.1 (System Prompt Hook)
            │    └── Task 4.3 (Permission Hook)
            └── Task 3.3 (Task Tracker)
                 ├── Task 4.4 (Stop Hook)
                 └── Task 4.5 (Session Hook)

Task 4.x (All Hooks)
  ├── Task 5.1 (Command Implementation)
  │    └── Task 5.2 (Command Hook)
  └── Task 6.1 (Plugin Entry)
       └── Task 7.x (Quality & Docs)
```

---

## Risk Mitigation

### High-Risk Tasks
1. **Task 4.2 (Tool Intercept Hook)** — Most complex hook, handles blocker tool calls
   - Mitigation: Extensive unit tests, manual testing priority
   - Fallback: Simplified version (no cooldown) if issues

2. **Task 4.3 (Permission Hook)** — Injection pattern might not work as expected
   - Mitigation: Test with real OpenCode early (Task 7.3)
   - Fallback: Simpler approach (auto-approve with logging)

3. **Task 3.3 (Task Tracker)** — Heuristic parsing might be unreliable
   - Mitigation: Simple fallback suggestions
   - Fallback: Return generic "check recent work" message

### Blockers to Watch
- **OpenCode SDK API changes**: If plugin SDK differs from docs
  - Mitigation: Check `node_modules/@opencode-ai/plugin/dist/index.d.ts`
- **TUI integration**: Hotkey implementation might not be possible
  - Mitigation: Defer to v0.2.0, focus on command interface

---

## Definition of Done (Per Task)

Each task is "done" when:
- [ ] Tests written FIRST (TDD principle)
- [ ] Tests pass (`bun test <test-file>`)
- [ ] Implementation matches specification
- [ ] TypeScript type check passes (no errors)
- [ ] ESLint passes (no warnings)
- [ ] Module under line limit (target met)
- [ ] JSDoc comments added
- [ ] Code reviewed (self-review checklist)

---

## Next Command

Run `/speckit.implement` to begin execution with:
- Task 1.1: Initialize Project Structure

**Ready to start implementation!** 🚀
