# ADR: OpenCode 2.x port (opencode-v2-port)

Status: accepted for 0.3.0 (branch `feat/opencode-v2`, not released).
Verified against the OpenCode v2.2.5 source (`packages/core`, `packages/plugin`, `packages/schema`, `packages/client`).

## Context

0.2.9 exports `{ id, server }`. OpenCode 2.x loads only a default export with `id` and `setup` (or `effect`). Any other
shape logs `failed to load plugin` and the plugin does nothing. Plugin load is fail-open, so this is silent for users.
The TUI part (`tui.ts`) is only mounted when the server part loads, and v2 reads `cli.json`, not `tui.jsonc`.

## Decisions

### 1. Packaging: dual default export, split implementation

`index.ts` default-exports `{ id, setup: setupV2, server: createPlugin }`.

- v2 loader (`packages/core/src/plugin/module.ts`): the `{ id, setup }` branch matches and extra keys are ignored
  (Effect `Schema.Struct` default), so `server` is harmless on v2.
- v1 path is untouched. `createPlugin` and all v1 hook code keep their behavior.
- v2 lives in `src/v2/` and imports only the pure helpers it needs (state, config schema, tool-intercept, command
  handlers, templates, blockers file, logging). One `dist/index.js` serves both.

Alternative rejected: `dist/v1` + `dist/v2` with an `exports` map. Not needed while the two entries share one file.

### 2. Shared core: reuse pure helpers, re-express session hooks

- Reused as-is: `handleToolExecuteBefore`, `handleOnCommand`/`handleOffCommand`/`handleStopCommand`/`handleStatusCommand`,
  `getStopPrompt`, `getSystemPromptTemplate`, `getBlockerToolDefinition`, `appendBlocker`, `ConfigSchema`.
- Blocker tool: v1 `tool()` from `@opencode-ai/plugin` is an identity function (`dist/tool.js`). The v2 adapter calls the
  same v1 tool definition's `execute` with `{ sessionID }`. No change to `src/tools/blocker.ts`. v2 gets a JSON Schema
  `input` that mirrors the zod args.
- Session hooks are NOT shared. `src/hooks/session.ts` reads `ctx.client`, `tui.showToast`, `promptAsync` and v1 message
  events. Extracting it would touch ~1000 lines covered by the v1 suite. v2 gets its own small state machine in
  `src/v2/session.ts`, driven by v2 events.
- Seam changes to v1 files: `resolveBlockersFilePath` and `shouldContinue` are exported; `clearAllState()` is added to
  `src/state.ts`. No behavior change. Baseline suite: 465 pass before and after.

### 3. Logging

`LogClient` (`{ app?.log }`) stays the internal logging interface, so every `logInfo`/`logWarn`/`logError`/`logDebug`
call site is unchanged. The v1 host passes the SDK client. The v2 host passes `createFileLogClient()`
(`src/v2/log-file.ts`), which appends JSON lines to `$XDG_STATE_HOME/opencode/blocker-diverter.log`.

Deviation from the brief (S3): the ~60 raw `client?.app?.log?.(...)` trace lines in the v1 hooks are NOT rewritten. They
live in the v1 code path, which is the v1 adapter by definition. Rewriting them would be a large diff in the v1 daily
driver with no user-visible gain. v2 code never touches `client.app.log` directly.

### 4. Idle and continue: event-driven, not `experimental.idle`

v2 has no `session.idle` publisher in 2.2.5. `session.idle` and `session.status` are defined in the schema but nothing
publishes them (`packages/schema/src/session-status-event.ts`, deprecated). The idle signal is the durable
`session.execution.succeeded` event; failures and user interrupts arrive as `session.execution.failed` and
`session.execution.interrupted` (reason `user`).

Session defaults: `session.created` can be published before the subscription connects (a headless `run` creates its
session right after plugin load). So `defaultDivertBlockers` is also applied on first sight of a session in any hook
(`ensureSession` in `src/v2/session.ts`). Found in the S2 E2E run; without it the default was silently skipped.
Parent inheritance still needs the created event.

Chosen: subscribe with `ctx.event.subscribe({ types, signal })`. Continue prompts use `ctx.session.synthetic({ sessionID, text })`
(default `resume`, which wakes the session; the prompt hook does not fire for synthetic input).

Rejected: `ctx.session.hook("experimental.idle")`. It is experimental, runs before idle inside the same execution, and it
does not run after interruption or failure, so the v1 cancel and recovery behavior would have no hook point. The bound is
the same in both designs: `maxReprompts`, `cooldownMs` and `repromptWindowMs`.

### 5. Permission semantics

`permission.evaluate` runs in `evaluateInput` (`packages/core/src/permission.ts`). Configured deny rules (agent and
session) are checked before the hook is triggered, so a deny never reaches the plugin. The plugin changes only
`effect === "ask"` to `"allow"`, and only while divert is on. It never writes `"deny"`. A test asserts this.
Saved "always" approvals are allow-only and are evaluated after the deny check.

### 6. Hook mapping

| v1 | v2 (0.3.0) |
|---|---|
| `tool.execute.before` (question) | `ctx.tool.hook("execute.before")`; throw fails the call |
| `permission.ask` | `ctx.permission.hook("evaluate")`, ask to allow only |
| `chat.message` (user branch) | `ctx.session.hook("prompt")` (auto-disable, same rules) |
| `chat.message` (assistant text) and `message.part.updated` | `session.text.ended` (`data.text`) |
| `experimental.chat.system.transform` | `ctx.session.hook("context")`, pushes text parts to `event.system` |
| `experimental.session.compacting` | `ctx.session.hook("compaction")`, pushes summary to `event.system` |
| `session.created/deleted` | same events; parent inheritance kept |
| `session.idle` | `session.execution.succeeded` |
| `session.error` | `session.execution.failed` (sets recovery flag) |
| user abort (`MessageAbortedError`) | `session.execution.interrupted` with reason `user`, disables divert at once (v1 did it on the next idle) |
| `command.execute.before` | `ctx.command.transform` for on, off, stop, status; reply via `ctx.session.prompt` with `ignoreNextUserMessage` set (v1 parity) |
| `tool` blocker | `ctx.tool.transform` with `input` as JSON Schema |

### 7. Commands

`/blockers.on|off|stop|status` are plugin commands in v2. `/blockers.list` and `/blockers.clarify` stay markdown
templates. The shipped `.opencode/commands/blockers.{on,off,status}.md` also register these names. The e2e run must show
that the plugin command wins; if it does not, the markdown files must be dropped for v2 installs.

`blockers.stop` gets a command in v2. v1 handled it but shipped no markdown for it.

### 8. Config

v2 global dir: `OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`. Project file
`.opencode/blocker-diverter.json` wins over the global file (same as v1). `ctx.options` overrides keys of the chosen file.
Defaults are unchanged, including `defaultDivertBlockers: false`. Invalid options fall back to defaults with a warning.

### 9. Types

No `@opencode/plugin` dependency. `src/v2/types.ts` declares the subset of the v2 context that is used. It is structural,
so the runtime never imports v2 packages.

### 10. Toasts and TUI

- Toasts: v2 server context has no toast API. v1 toasts are dropped. Each command reply carries the same text as its
  minimal response, sent as a user message (v1 parity).
- TUI: NOT ported in 0.3.0. v2 TUI needs `cli.json` plus the keymap API (`packages/plugin/src/tui/context.ts`). The v1
  `tui.ts` and its `./tui` export are kept for v1 only. Ctrl+B and the TUI list command are v1-only. The slash commands
  work on v2.

### 11. Continue-prompt bound

The brief said "bounded by maxBlockersPerRun". The v1 code bounds continue prompts by `maxReprompts`, `cooldownMs` and
`repromptWindowMs` (`src/hooks/session.ts` `shouldContinue`). The v2 port keeps the v1 behavior.

## Consequences

- v1 users see no change. The v1 suite and the real v1 binary are the regression gate (S10).
- v2 users get `plugins: [{ package, options }]`. The TUI part is missing until a follow-up.
- Load failures stay fail-open. The `opencode plugin list --standalone` canary is documented in README.
