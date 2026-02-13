# OpenCode SDK Research: Blocker Diverter Hooks

**Date**: 2026-02-12 | **Sources**: @opencode-ai/plugin types, OpenCode docs (contextual), AGENTS.md Hook Reference
**Focus**: Required hooks behavior, signatures, edge cases for MVP (FR-002/007/014/020)

## Hook Signatures & Behaviors

### 1. `experimental.chat.system.transform` (Tool Injection, FR-002/011)
```typescript
(input: { system: string[] }, output: { system: string[] }): Promise<void>
```
- **When**: Session init or prompt rebuild.
- **Behavior**: Append `<blocker-tool>` XML with JSON schema + instructions **only if** `divertBlockers=ON`.
- **Output**: Mutate `output.system` array.
- **Edge**: Compaction preserves via `experimental.session.compacting`.
- **Test**: Mock input/output, assert appended string contains schema.

### 2. `tool.execute.before` (Blocker Tool Intercept, FR-004/009)
```typescript
(input: { tool: string, args: any, sessionID: string }): Promise<{ status: 'allow' | 'deny' }>
```
- **When**: Agent calls tool **before** execution.
- **Behavior**: If `tool === 'blocker' && divertBlockers=ON` → Zod validate args → dedupe → append file → return custom response text.
- **Response Template**: Fixed: \"Great, blocker registered, move on...\"
- **Edge**: Invalid args → `{ status: 'deny', message: 'Validation failed: ...' }`
- **Test**: Mock tool call, assert file append + response.

### 3. `permission.asked` (Permission Fake Msg, FR-007/008)
```typescript
(input: { permission: string, sessionID: string, tool?: string, args?: any }, output: { status: 'allow'|'deny'|'ask' })
```
- **When**: Before user dialog.
- **Behavior**: If `divertBlockers=ON` → `output.status = 'ask'` + inject fake user msg via `client.session.prompt(...)` instructing blocker tool use.
- **Template**: \"You're blocked on {{permission}}. Use the blocker tool to log it and continue with next tasks.\"
- **Edge**: Toggle OFF → `output.status = 'ask'` (normal dialog).
- **Test**: Mock input, assert prompt called w/ template.

### 4. `stop` (Stop Prevention, FR-014/016)
```typescript
(input: { sessionID: string, reason?: string }): Promise<boolean>
```
- **When**: Agent requests stop.
- **Behavior**: If `divertBlockers=ON && under threshold` → `return false` + inject prompt: \"Check progress... say '{{completionMarker}}' if done.\"
- **Marker Check**: Parse agent last response for exact marker.
- **Loop Detect**: Hash responses, count matches in window.
- **Edge**: Marker present/threshold hit → `return true` (allow stop).
- **Test**: Mock states, assert inject/prevent logic.

### 5. Session Events (State Lifecycle, FR-020)
```typescript
event: async ({ event: { type: 'session.created' | 'session.deleted', session_id } })
```
- **created**: `getState(session_id)` (lazy init).
- **deleted**: `clearState(session_id)`.
- **Test**: Mock events, assert Map ops.

### 6. `tui.command.execute` (Commands, FR-012)
```typescript
(input: { command: string, args: string[], sessionID: string }): Promise<void>
```
- **When**: `/blockers ...`
- **Behavior**: Parse subcmd, mutate state, log/output.
- **Test**: Mock client, assert state/log.

## Investigated Behaviors (from SDK Context)
- **Ctx Destructure**: `async ({ client, $, project, directory, worktree })` → CRITICAL (wrong = runtime fail).
- **Prompt Injection**: `client.session.prompt({ path: { id: sessionId }, body: { parts: [{text: template}] } })`
- **State Persistence**: Map survives across hooks, cleared on deleted.
- **Async Safety**: All hooks async, no blocking.
- **Logging**: `client.app.log({ service: 'blocker-diverter', level, message, extra })`
- **Shell**: `$` for git/status if needed (future).

## Unknowns/Blockers
- Exact `tool.execute.before` response format? → Assume text via prompt (test in impl).
- Compaction state preserve? → Add `experimental.session.compacting` later.
- Multi-session perf? → Map scales fine (<100 sessions).

## Test Mocks Needed
```typescript
const mockCtx = { client: mockClient(), $: mockShell(), project: {...} };
const plugin = await BlockerDiverter(mockCtx);
expect(plugin['permission.asked']).toBeDefined();
```

**Next**: Confirm via integration tests in `/speckit.tasks`.