# Blocker Diverter MVP - Implementation Tasks

## Status
- **Spec**: ✅ [spec.md](./spec.md)
- **Plan**: ✅ [plan.md](./plan.md)
- **Data Model**: ✅ [data-model.md](./data-model.md)
- **Research**: ✅ [research.md](./research.md)
- **Tasks**: 📋 This file
- **Progress**: 2/16 tasks complete

## Principles
- **TDD Strict**: Write `.test.ts` **BEFORE** source file for every module.
- **Dependencies**: Sequential for foundations → utils → core → integration.
- **Granularity**: 1-2 files per task (test + impl), 30-60 min each.
- **Coverage**: 80%+ per module, 100% critical paths.
- **Limits**: <400 lines/module, HARD 500.
- **Base Path**: `.opencode/plugin/blocker-diverter/`
- **References**: FR# from spec.md (e.g., FR-001: Plugin enabled toggle).

## Task Legend
- **🔴 Sequential**: Must wait for deps.
- **🟢 Parallel**: Independent, run concurrently.
- **✅ Done**: Marked after tests pass + code reviewed.
- **AC**: Acceptance criteria.

## Ordered Tasks

### Phase 1: Foundation (Types, Config, State)
**Goal**: Core data structures and validation. No logic yet.

**TASK-001** ✅ **types.ts** (15 min)
- Files: `.opencode/plugin/blocker-diverter/types.test.ts`, `types.ts`
- Impl: Define interfaces `Blocker`, `Config`, `SessionState` per data-model.md.
- TDD: Test TypeScript compilation (`bun tsc --noEmit`), Zod inference.
- AC:
  - Exports match data-model.md exactly (FR-002, FR-003).
  - No `any` types, strict null checks.
  - `bun test types.test.ts` passes 100%.
- Deps: None.

**TASK-002** ✅ **config.ts** (45 min)
- Files: `.opencode/plugin/blocker-diverter/config.test.ts`, `config.ts`
- Impl: `ConfigSchema` Zod + `loadConfig()` reading `opencode.json`.
- TDD: Mock `Bun.file()`, validate defaults, error cases.
- AC:
  - Parses/validates config per schema (FR-001, FR-009).
  - Throws detailed Zod errors on invalid JSON.
  - Tests cover happy path + 3 error cases, 90% coverage.
- Deps: TASK-001.

**TASK-003** 🔴 **state.ts** (30 min)
- Files: `.opencode/plugin/blocker-diverter/state.test.ts`, `state.ts`
- Impl: `Map<string, SessionState>`, `getState()`, `updateState()`, `cleanupState()`.
- TDD: Test init, get, update, delete, edge (missing session).
- AC:
  - Session state persists/isolated (FR-006, FR-020).
  - No leaks on cleanup.
  - 100% coverage.
- Deps: TASK-001, TASK-002.

### Phase 2: Utils (Pure Functions)
**Goal**: Reusable helpers. 🟢 Parallel after Phase 1.

**TASK-004** 🟢 **utils/logging.ts** (20 min)
- Files: `.opencode/plugin/blocker-diverter/utils/logging.test.ts`, `utils/logging.ts`
- Impl: `logInfo()`, `logError()` wrappers for `client.app.log`.
- TDD: Mock `client.app.log`, test structured payloads.
- AC: Matches logging standards (FR-022), 100% coverage.
- Deps: TASK-001.

**TASK-005** 🟢 **utils/dedupe.ts** (25 min)
- Files: `.opencode/plugin/blocker-diverter/utils/dedupe.test.ts`, `utils/dedupe.ts`
- Impl: `generateHash()`, `isDuplicate()` with cooldown Set.
- TDD: Test hash generation, dedupe logic, cooldown expiry.
- AC: Prevents spam (FR-019), 95% coverage.
- Deps: TASK-001.

**TASK-006** 🟢 **utils/templates.ts** (20 min)
- Files: `.opencode/plugin/blocker-diverter/utils/templates.test.ts`, `utils/templates.ts`
- Impl: Template strings for fake user messages, tool responses, completion marker.
- TDD: Test template rendering with variable substitution.
- AC: No LLM needed for messages (FR-008, FR-014), 100% coverage.
- Deps: TASK-001.

### Phase 3: Core I/O
**TASK-007** 🔴 **blockers-file.ts** (50 min)
- Files: `.opencode/plugin/blocker-diverter/blockers-file.test.ts`, `blockers-file.ts`
- Impl: `appendBlocker()`, `readBlockers()`, `rotateFile()` async Bun.file.
- TDD: Mock files, test append/read/rotate, path validation.
- AC:
  - Secure file ops (no traversal, FR-005).
  - Rotation at maxBlockersPerRun.
  - 90% coverage, handles ENOENT.
- Deps: TASK-001..006.

### Phase 4: Hooks (🟢 Mostly Parallel)
**Goal**: Event handlers. Depend on core.

**TASK-008** 🟢 **hooks/system-prompt.ts** (30 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/system-prompt.test.ts`, `hooks/system-prompt.ts`
- Impl: `experimental.chat.system.transform` hook injects blocker tool definition.
- TDD: Mock input/output, test tool XML injection when toggle ON.
- AC: Tool available when divert-blockers ON (FR-002, FR-011), 100% coverage.
- Deps: TASK-001..007.

**TASK-009** 🟢 **hooks/session.ts** (40 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/session.test.ts`, `hooks/session.ts`
- Impl: `event` handler for `session.created/deleted`, init/cleanup state.
- TDD: Mock events, test state lifecycle.
- AC: State mgmt on session events (FR-020), 95% coverage.
- Deps: TASK-001..007.

**TASK-010** 🟢 **hooks/compaction.ts** (25 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/compaction.test.ts`, `hooks/compaction.ts`
- Impl: `experimental.session.compacting` preserves blocker summary context.
- TDD: Mock input/output, test context append.
- AC: State survives compaction (FR-021), 100% coverage.
- Deps: TASK-001..007.

**TASK-011** 🔴 **hooks/tool.ts** (60 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/tool.test.ts`, `hooks/tool.ts`
- Impl: `tool.execute.before` intercepts `blocker` tool calls, validates, logs, responds.
- TDD: Mock tool calls, test validation, dedupe, file append, response.
- AC: Core blocker tool handling (FR-004, FR-007), 100% critical path.
- Deps: TASK-001..007.

**TASK-012** 🔴 **hooks/permission.ts** (50 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/permission.test.ts`, `hooks/permission.ts`
- Impl: `permission.asked` injects fake user message template.
- TDD: Mock permission event, test message injection.
- AC: Intercepts permissions with template (FR-007, FR-008), 95% coverage.
- Deps: TASK-001..007, TASK-011.

**TASK-013** 🟢 **hooks/stop.ts** (50 min)
- Files: `.opencode/plugin/blocker-diverter/hooks/stop.test.ts`, `hooks/stop.ts`
- Impl: `stop` hook checks reprompt threshold, injects continuation template, monitors marker.
- TDD: Mock state, test threshold logic, marker detection.
- AC: Prevents premature stop (FR-014, FR-015, FR-016, FR-017, FR-018), 95% coverage.
- Deps: TASK-001..007.

### Phase 5: Commands
**TASK-014** 🔴 **commands/blockers-cmd.ts** (45 min)
- Files: `.opencode/plugin/blocker-diverter/commands/blockers-cmd.test.ts`, `commands/blockers-cmd.ts`
- Impl: `/blockers [on|off|status|list|clarify]` handlers.
- TDD: Mock client/state, test all subcommands including clarify loop.
- AC: CLI control (FR-010, FR-012, FR-013), 90% coverage.
- Deps: TASK-001..013.

### Phase 6: Wiring + Integration
**TASK-015** 🔴 **index.ts** (40 min)
- Files: `.opencode/plugin/blocker-diverter/index.test.ts`, `index.ts`
- Impl: Plugin export, wire all hooks/commands, load config, context destructure.
- TDD: Mock context, test hook registration.
- AC: Loads/registers correctly (FR-001), 100% coverage.
- Deps: TASK-001..014.

**TASK-016** 🔴 **Integration Tests** (60 min)
- Files: `.opencode/plugin/blocker-diverter/integration.test.ts`
- Impl: Full plugin lifecycle mocks (permission flow, tool call, stop prevention).
- AC:
  - End-to-end: blocker logged, session continues, stop prevention works.
  - `bun test --coverage` >80% project-wide.
  - Smoke test plugin load.
- Deps: TASK-001..015.

## Parallel Opportunities
- Phase 2 (TASK-004, 005, 006): All parallel after TASK-003.
- Phase 4 Hooks (TASK-008, 009, 010, 013): Parallel except permission/tool (sequential).

## Completion Criteria
- All tasks ✅.
- `bun test --coverage` >80%.
- `bun tsc --noEmit` passes.
- No file >400 lines (HARD LIMIT 500).
- Constitution verified.
- Ready for production use.

**Total Tasks**: 16 | **Est. Time**: 9-12 hours

---

**Next Step**: Run `/speckit.implement TASK-001` to begin implementation.
