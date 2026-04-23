# FINDINGS — OpenCode Blocker Diverter Plugin

**Last updated:** 2026-04-23  
**Purpose:** Survival document for compactions. Contains confirmed root causes, failed assumptions, and ground truth about how this plugin loads.  
**If you are a new agent reading this:** READ THIS ENTIRE DOCUMENT BEFORE TOUCHING ANYTHING.

---

## 🔴 ROOT CAUSE: Why TUI plugin never loaded

### Confirmed via log file (`~/.local/share/opencode/log/*.log`)

```
WARN service=tui.plugin path=opencode-blocker-diverter retry=false
     message=Plugin opencode-blocker-diverter does not expose a tui entrypoint
     tui plugin has no entrypoint
```

### Why it happened — npm cache staleness

1. `tui.jsonc` had bare spec `"opencode-blocker-diverter"` (no version, no path)
2. OpenCode calls `Npm.add("opencode-blocker-diverter@latest")`
3. → resolves from `~/.cache/opencode/packages/opencode-blocker-diverter@latest/`
4. That cache had **v0.1.0** — published before `dist/tui.js` existed
5. OpenCode looks for `package.json#exports["./tui"]` → missing → plugin skipped silently
6. **`npm update` in the config dir does NOT update this cache** — different directory

### Fix applied (2026-04-23)

```bash
# 1. Install local dev build into config node_modules
cd /var/www/opencode-config && npm install /var/www/opencode-blocker-diverter

# 2. Switch tui.jsonc to path spec (bypasses npm cache entirely)
# tui.jsonc: "opencode-blocker-diverter" → "./node_modules/opencode-blocker-diverter"

# 3. Delete stale @latest cache
rm -rf ~/.cache/opencode/packages/opencode-blocker-diverter@latest
```

### Verification status

| Check | Status | Evidence |
|-------|--------|----------|
| Server plugin loads with path spec | ✅ CONFIRMED | Log: `service=plugin path=file:///home/nikro/.config/opencode/node_modules/opencode-blocker-diverter loading plugin` |
| `dist/tui.js` exists + correct export | ✅ CONFIRMED | `export default { id: "opencode-blocker-diverter", tui }` |
| `package.json exports["./tui"]` | ✅ CONFIRMED | `"./tui": { "import": "./dist/tui.js" }` |
| Local install in config node_modules | ✅ CONFIRMED | v0.2.1, `dist/tui.js` present |
| TUI Ctrl+P commands visible | ⏳ PENDING | Requires full OpenCode TUI restart |

---

## Architecture Facts (confirmed from source)

### How OpenCode resolves plugin specs

From `packages/opencode/src/config/plugin.ts:48-65`:

```
bare spec "foo"           → Npm.add("foo@latest") → ~/.cache/opencode/packages/foo@latest/
bare spec "foo@0.2.0"     → Npm.add("foo@0.2.0")  → ~/.cache/opencode/packages/foo@0.2.0/
path spec "./path/to/foo" → path.resolve(dirname(configFile), "./path/to/foo")
                          → file:///absolute/path/to/foo (bypasses cache)
```

**NEVER use bare npm specs in config files.** They hit the cache which may be stale.

### Two separate config files, two separate plugin lists

| File | Read by | Purpose |
|------|---------|---------|
| `~/.config/opencode/opencode.jsonc` | Server | Registers server plugin (tools, hooks) |
| `~/.config/opencode/tui.jsonc` | TUI | Registers TUI plugin (Ctrl+P commands) |

They are loaded independently. Server loading ≠ TUI loading.

### TUI plugin entrypoint resolution

From `packages/opencode/src/plugin/shared.ts:103-114`:
1. Reads `package.json#exports["./tui"]` 
2. If missing → `stage: "missing"` → plugin skipped silently
3. No fallback to `main` for TUI entrypoint
4. No error thrown — just a WARN log

### TUI plugin default export shape (required)

```ts
export default {
  id: "opencode-blocker-diverter",  // required for path-spec plugins
  tui: async (api, options, meta) => {
    api.command.register(() => [...commands])
  }
  // MUST NOT have `server` property
}
```

If `server` is present alongside `tui`, the plugin is rejected.

### Silent failure points (where plugin can be skipped without error)

1. Missing `tui.jsonc` → silently returns `{}`
2. Invalid JSONC → silently returns `{}`
3. `OPENCODE_PURE=1` env var → all external plugins skipped
4. Missing `exports["./tui"]` → WARN logged, plugin skipped
5. Wrong default export shape → error caught, plugin skipped
6. Missing `id` for path-spec plugins → error caught, plugin skipped
7. Duplicate plugin id → second plugin rejected
8. `plugin_enabled: { "opencode-blocker-diverter": false }` → skipped

### Where OpenCode writes logs

```
~/.local/share/opencode/log/*.log   (timestamped, most recent = latest session)
```

To see plugin load messages: `grep -i "plugin\|blocker\|tui" ~/.local/share/opencode/log/LATEST.log`

### How to run opencode debug commands

```bash
opencode debug config   # dump resolved server config (plugin specs visible)
opencode debug paths    # dump config/data/log paths
```

---

## Assumptions That Were WRONG

| Assumption | Reality |
|------------|---------|
| "npm update updates the OpenCode cache" | WRONG — OpenCode has its own cache at `~/.cache/opencode/packages/`, separate from project node_modules |
| "the server plugin loading means TUI is also loading" | WRONG — they are completely separate systems |
| "path spec `./node_modules/foo` in tui.jsonc is enough once written" | WRONG — also need the package actually installed at that path |
| "v0.2.0 was published to npm so @latest should get it" | WRONG — @latest cache was pre-populated with v0.1.0 and never invalidated |
| "if there's no error, the plugin loaded" | WRONG — failures are WARNs that look normal in a busy log |

---

## Development Workflow (after the fix)

### When you change plugin code

```bash
# 1. Build
cd /var/www/opencode-blocker-diverter
bun run build  # or: bun build tui.ts --outdir dist --target bun --format esm

# 2. Update installed copy in config node_modules
cd /var/www/opencode-config
npm install /var/www/opencode-blocker-diverter

# 3. Restart OpenCode (TUI needs restart to pick up new code)
# There is no hot-reload for TUI plugins.
```

### Verify without restarting OpenCode

```bash
# Unit test — verifies plugin module loads and registers 5 commands
cd /var/www/opencode-blocker-diverter
bun test tests/tui-commands.test.ts

# Full check — module shape + command registration + log scan + config check
bash scripts/verify-plugin.sh

# Or combined:
bun run verify
```

### Verify after restarting OpenCode

```bash
# Check log for plugin load success (run after OpenCode starts)
LOGFILE=$(ls -t ~/.local/share/opencode/log/*.log | head -1)
grep -E "plugin|blocker|tui" "$LOGFILE"

# Expected success lines:
# INFO  service=plugin path=file:///home/nikro/.config/opencode/node_modules/opencode-blocker-diverter loading plugin
# INFO  service=tui.plugin id=opencode-blocker-diverter loading tui plugin  ← this means TUI works

# Failure line to watch for:
# WARN  service=tui.plugin ... tui plugin has no entrypoint   ← something is wrong
```

---

## Current Config File State

### `~/.config/opencode/tui.jsonc` (= `/var/www/opencode-config/tui.jsonc`)

```jsonc
{
  "plugin": [
    "./node_modules/opencode-blocker-diverter"
  ]
}
```

### `~/.config/opencode/opencode.jsonc` (= `/var/www/opencode-config/opencode.jsonc`)

```jsonc
{
  "plugin": [
    "./node_modules/opencode-blocker-diverter"
  ],
  ...
}
```

### `~/.config/opencode/package.json`

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.4.8",
    "opencode-blocker-diverter": "file:../opencode-blocker-diverter"
  }
}
```

---

## Plugin Repo State

```
/var/www/opencode-blocker-diverter/
├── dist/
│   ├── tui.js       ✅ EXISTS — correct export shape
│   ├── tui.d.ts     ✅
│   ├── index.js     ✅ — server plugin
│   └── index.d.ts   ✅
├── tui.ts            ✅ source
├── index.ts          ✅ source
├── tests/
│   └── tui-commands.test.ts  ✅ 22 tests, all pass
├── scripts/
│   └── verify-plugin.sh      ✅ 4-check verification script
└── package.json
    exports["./tui"] → ./dist/tui.js  ✅
    exports["."]     → ./dist/index.js ✅
    version: 0.2.1   ✅
```

---

## What Still Needs Verification

1. **Ctrl+P commands in TUI** — requires OpenCode restart. Run `bun run verify` after restart and check logs.
2. **Server tool (`blocker`) in agent context** — use `opencode run "list your tools"` to verify `blocker` appears.
3. **End-to-end**: agent calls `blocker` tool → `BLOCKERS.md` written → stop hook fires.

---

## Question Interception Investigation (2026-04-23)

### Scope investigated
- Why `question` picker still appears even when `divertBlockers=true`.
- Verified server internals (`plugin.trigger`, prompt tool execution flow, session IDs, SDK surface).

### Confirmed findings

1. **`tool.execute.before` is awaited and throwing SHOULD stop the tool.**
   - `packages/opencode/src/session/prompt.ts:414-420` calls `yield* plugin.trigger("tool.execute.before", ...)` before `item.execute(...)`.
   - `packages/opencode/src/plugin/index.ts:266-270` executes hooks sequentially with `yield* Effect.promise(async () => fn(input, output))`.
   - There is no local catch around the `tool.execute.before` call in prompt execution path.
   - Conclusion: if our hook throws, `Question.Service.ask()` should not run.

2. **Backup `question.asked` handler is race-prone by design.**
   - Event hooks are fire-and-forget: `packages/opencode/src/plugin/index.ts:247-249` uses `void hook["event"]?.(...)`.
   - So `question.asked` reject happens *after* publish and can race with TUI rendering.

3. **Backup reject API call is currently invalid for plugin client type.**
   - Plugin input client is `ReturnType<typeof createOpencodeClient>` from `@opencode-ai/sdk` v1 surface (`@opencode-ai/plugin/dist/index.d.ts:36-38`).
   - That client does **not** expose `client.question` (confirmed by runtime check):
     - `bun -e "import { createOpencodeClient } from '@opencode-ai/sdk'; ..."` → `hasQuestion false questionType undefined`
   - So `await (client as any).question.reject({ requestID })` in `src/hooks/session.ts:167` can fail silently (caught + logged best-effort).

4. **Most likely real blocker: session-state mismatch across parent/subagent sessions.**
   - `/blockers.on` mutates state object for the command's session (`src/core/plugin.ts:128,137`; `src/commands/blockers-cmd.ts:52-58`).
   - `tool.execute.before` checks state by incoming `input.sessionID` (`src/hooks/tool-intercept.ts:54-55`).
   - Subagent tool calls run in child sessions (`packages/opencode/src/tool/task.ts:67-71,133`).
   - New sessions are reset from config default in plugin (`src/hooks/session.ts:413-436`) and do **not** inherit parent `divertBlockers`.
   - TUI aggregates question prompts from parent + children (`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:140-143`), so child questions still show picker.

### Reproductions run

- CLI non-interactive run (with logs):
  - Plugin loaded: `service=plugin path=file:///home/nikro/.config/opencode/node_modules/opencode-blocker-diverter loading plugin`
  - `question` and `blocker` tools registered: `tool.registry status=started question` + `tool.registry status=started blocker`
  - Model still answered in plain text (“I don't have a question tool...”), so no question call occurred in this specific run.

- Direct state/intercept simulation:
  - Same session enabled → question blocked (throw observed).
  - Parent enabled, child default false → child question **not blocked**.

### Practical fix direction

1. **Primary fix:** propagate `divertBlockers` from parent to child on `session.created` when `info.parentID` exists.
2. **Secondary hardening:** in `tool.execute.before`, if current session not diverted, optionally check parent session chain before allowing `question`.
3. **Backup hook fix (optional):** if keeping `question.asked` reject path, use SDK v2 client or direct `/question/:requestID/reject` call; current v1 client surface lacks `question`.

---

## Quick Commands Reference

```bash
# Build plugin
cd /var/www/opencode-blocker-diverter && bun run build

# Update config install
cd /var/www/opencode-config && npm install /var/www/opencode-blocker-diverter

# Run all tests
cd /var/www/opencode-blocker-diverter && bun test

# Run verification script
cd /var/www/opencode-blocker-diverter && bun run verify

# Check if plugin loaded (run after OpenCode restart)
grep -i "blocker\|tui.plugin" $(ls -t ~/.local/share/opencode/log/*.log | head -1)

# Check resolved config
opencode debug config | grep -A5 '"plugin"'

# Check cache state
ls ~/.cache/opencode/packages/ | grep blocker

# Nuclear option: clear all plugin cache and reinstall
rm -rf ~/.cache/opencode/packages/opencode-blocker-diverter*
cd /var/www/opencode-config && npm install /var/www/opencode-blocker-diverter
```

---

## Autonomous Toggle Regression + Fix (2026-04-23 evening)

### Symptom
- TUI showed **"Currently ENABLED"**, but question picker still appeared.
- `[BD] getState ... divertBlockers=false` in the UI/log stream during active session.

### Confirmed root cause
`chat.message` auto-disable logic was too aggressive: it disabled `divertBlockers` on **any** user message.

In OpenCode, the very first task prompt is a user message, so flow was:
1. `session.created` set `divertBlockers=true` (from config), then
2. first user message immediately flipped it back to `false`, then
3. `tool.execute.before` saw `divert=false`, so `question` tool passed through.

Evidence from log (`2026-04-23T183831.log`):
- `[BD] session.created: initializing state, defaultDivertBlockers=true`
- `[BD] session.created: DONE, divertBlockers=true`
- `[BD] chat.message: auto-disabling divertBlockers (was true, user sent message)`
- later: `[BD] tool.execute.before fired: tool=question ... divert=false`

### Changes applied

1. **Initial-prompt guard in `chat.message`** (`src/hooks/session.ts`)
   - Auto-disable now triggers only for likely manual takeover:
     - assistant already responded (`lastMessageContent` non-empty), or
     - reprompt cycle already running (`repromptCount > 0`), or
     - blockers already logged (`blockers.length > 0`).
   - For the initial user task prompt, plugin now preserves autonomous mode.

2. **Global config file added for this runtime layout**
   - Added `/var/www/opencode-config/blocker-diverter.json` with:
     - `"enabled": true`
     - `"defaultDivertBlockers": true`
   - Needed because plugin runtime `worktree` resolved to `/`, so project-local `.opencode/blocker-diverter.json` was not the source used at startup in this environment.

3. **Regression test added**
   - `tests/hooks/session-continue.test.ts`
   - New test: `does not auto-disable on initial user prompt in autonomous mode`.

### Verification
- `bun test` → **429 pass, 0 fail**
- `bun run build` → success
- `cd /var/www/opencode-config && npm install /var/www/opencode-blocker-diverter` → updated install
- Runtime behavior now matches expectation:
  - autonomous mode stays on for initial task prompt,
  - question interception works when enabled,
  - `/blockers.off` returns normal behavior (no autonomous continue nudge).

### Note on noisy UI logs
- Temporary `[BD]` diagnostics + `getState` `console.error` spam can visually pollute TUI.
- Keep until final stabilization; then remove/reduce high-volume debug lines.

### Follow-up change (same day)
- Default behavior switched back to **manual opt-in**: `defaultDivertBlockers=false` in live config.
- Postinstall now also auto-creates `<targetDir>/blocker-diverter.json` (if missing), in addition to `.opencode/blocker-diverter.json`.
- Root config is created with safe defaults and never overwrites existing user edits.

### TUI false-positive status root cause (2026-04-23 night)
- `api.client.session.command()` in TUI uses SDK v2 `RequestResult` semantics and does **not throw by default** (`throwOnError=false`).
- TUI `execServerCommand()` previously treated any resolved promise as success, so local KV was set to enabled even when server command was rejected/no-op.
- Fix applied in `tui.ts`: call `api.client.session.command(..., { throwOnError: true })`.
- Result: if `/blockers.on` fails server-side, TUI now shows error toast and does not mark session enabled locally.

### Command lookup nuance discovered (same incident)
- `session.command` expects the **bare command name** (`blockers.on`), not slash-prefixed (`/blockers.on`).
- `command.execute.before` runs only **after** command lookup succeeds, so missing-command failures show no `command.execute.before` logs.
- `session.command` payload requires `arguments` as a string in this runtime path; send `arguments: ""` for no-arg commands to avoid `invalid_type` errors.
- TUI bridge now sends bare command + empty arguments + `throwOnError: true`, and parses structured SDK errors via `error.data.message` so toasts are actionable.
- Reverted duplicate global command seeding; blocker templates remain sourced from `.opencode/commands` to avoid duplicate command entries.
