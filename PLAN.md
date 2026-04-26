# opencode-blocker-diverter — Implementation Plan

> Living document. Update as work progresses. Created to survive context compaction.

## Goal

Enable autonomous overnight AI sessions by:
1. Intercepting "blocker" questions before they reach the user
2. Logging hard blockers to `BLOCKERS.md` for morning review
3. Letting the agent continue with non-blocking work
4. Giving the user a **per-session toggle** in the TUI (keybind or command palette) to enable/disable this behaviour

## Current State: **Stable — Verified E2E**

### What works (built & verified)
- Server plugin loads, `blocker` tool registers, `tool.execute.before` intercepts work ✅
- `command.execute.before` handles `blockers.on` / `blockers.off` / `blockers.status` / `blockers.stop` ✅
- TUI integration (Ctrl+B, commands) verified in live session ✅
- Auto-disable logic refined to avoid regression on initial prompt ✅
- Slash command deduplication fixed ✅
- `dist/index.js` and `dist/tui.js` exports correctly mapped ✅

---

## Architecture

### Two separate entry points in one package

```
opencode-blocker-diverter/
  index.ts   → dist/index.js  → exports { server }   (server plugin)
  tui.ts     → dist/tui.js    → exports { tui }      (TUI plugin)
```

OpenCode's loader calls `resolve(plan, "server")` and `resolve(plan, "tui")` separately for the same `"opencode-blocker-diverter"` spec in `opencode.jsonc`. It finds each via `package.json` `exports`:
```json
{
  ".":    { "import": "./dist/index.js" },
  "./tui":{ "import": "./dist/tui.js"  }
}
```

**Critical constraint:** `PluginModule` has `tui?: never` and `TuiPluginModule` has `server?: never` — they CANNOT be mixed in a single default export.

### Why the old `/blockers.on` approach was broken

OpenCode commit `234db24f1` added a guard in `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` that only routes `/command` through `session.command` (firing `command.execute.before`) if the command name already exists in `sync.data.command`. Since the plugin never registers commands in that registry, typed `/blockers.on` was sent as a plain-text AI message instead.

### How the TUI plugin fixes this

`api.command.register()` registers commands directly in the TUI's command system. The `onSelect` handler runs in the TUI process and calls `api.client.session.command({ sessionID, command: 'blockers.on' })` — an HTTP call to the OpenCode server that bypasses the broken prompt router entirely. The server fires `command.execute.before` normally.

### Per-session state (NOT global)

The user runs 10 simultaneous OpenCode instances and needs independent per-session toggles.

- **Server side:** `state.divertBlockers` per session in a `Map<sessionID, SessionState>` (in-memory, `src/state.ts`)
- **TUI side:** `api.kv` keyed by `"blocker:" + sessionID` tracks assumed enabled state (for toggle direction + toast message)
- **No global files, no global state**

`api.kv` can drift from server state if server auto-disables (e.g. on user message). This is acceptable — user can press toggle twice to re-sync.

---

## Key Files

### Plugin repo: `/var/www/opencode-blocker-diverter/`

| File | Purpose |
|------|---------|
| `index.ts` | Server plugin entry — exports `{ server: createPlugin }` |
| `tui.ts` | **TUI plugin entry** — exports `{ tui }` — registers commands + keybind |
| `src/core/plugin.ts` | Server plugin factory — registers all hooks |
| `src/state.ts` | Per-session state Map — `getState()`, `updateState()`, `cleanupState()` |
| `src/types.ts` | `SessionState`, `PluginConfig`, `Blocker` types |
| `src/hooks/session.ts` | `session.created/deleted/idle`, `chat.message`, `message.updated` handlers |
| `src/hooks/tool-intercept.ts` | `tool.execute.before` — blocks `question` tool when diverter active |
| `src/hooks/system-prompt.ts` | Injects autonomous session instructions into system prompt |
| `src/commands/blockers-cmd.ts` | Handlers for `blockers.on/off/status/stop` — update `state.divertBlockers` |
| `src/tools/blocker.ts` | `blocker` tool definition — AI calls this to log a blocking question |
| `dist/index.js` | Built server entry ✅ |
| `dist/tui.js` | Built TUI entry ✅ |

### Config repo: `/var/www/opencode-config/` (= `~/.config/opencode/`)

| File | Purpose |
|------|---------|
| `opencode.jsonc` | `"plugin": ["opencode-blocker-diverter"]` — single entry loads both server+TUI |
| `package.json` | `"opencode-blocker-diverter": "file:/var/www/opencode-blocker-diverter"` |
| `node_modules/opencode-blocker-diverter/` | Symlink → `/var/www/opencode-blocker-diverter` |

### OpenCode source (reference only): `/var/www/opencode-source/`

| File | Why it matters |
|------|---------------|
| `packages/opencode/src/plugin/loader.ts` | Loads plugins by kind (`server`/`tui`) |
| `packages/opencode/src/plugin/shared.ts` | `resolvePackageEntrypoint()` — reads `exports["./tui"]` |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | The broken prompt router (commit `234db24f1`) — only routes registered commands |

---

## TUI Plugin Commands (`tui.ts`)

| Value | Slash | Keybind | Action |
|-------|-------|---------|--------|
| `blockers.toggle` | `/blockers.toggle` | `ctrl+b` | Flips per-session kv state, calls `blockers.on` or `blockers.off` on server |
| `blockers.on` | `/blockers.on` | — | Explicitly enables |
| `blockers.off` | `/blockers.off` | — | Explicitly disables |
| `blockers.status` | `/blockers.status` | — | Shows current kv state in toast |

All commands show error toast if not on a session route, and if `api.client.session.command()` throws.

---

## Known Bugs Fixed (in this session)

1. **`output.parts` no-op** — `output.parts = [...]` was a no-op (caller holds original ref). Fixed with `output.parts.splice(0, output.parts.length, ...)` in `src/core/plugin.ts`.
2. **`ignoreNextUserMessage`** — When a blocker command ran via `session.command`, OpenCode created a user-role message that triggered `chat.message` hook → auto-disabled `divertBlockers`. Fixed by setting `ignoreNextUserMessage = true` in all command handlers and skipping auto-disable once in `session.ts`.
3. **`lastRepromptTime`** — Was `0` even after enable, so reprompt cooldown fired immediately. Fixed by setting `lastRepromptTime = Date.now()` on `blockers.on` in `handleOnCommand`.

---

## Next Steps

### 1. Version Bump & Publish
After final verification in the sandbox environment, bump version to `0.2.9` (or `0.3.0`) and publish to npm.

### 2. Update Configuration
Ensure `opencode-config` is updated to use the latest published version instead of the local file link.

---

## How to Build

```bash
cd /var/www/opencode-blocker-diverter
bun run build
# Runs: bun build index.ts tui.ts --outdir dist --target bun --format esm && tsc --emitDeclarationOnly
```

## How to Verify Build

```bash
node -e "import('/var/www/opencode-blocker-diverter/dist/tui.js').then(m => console.log(Object.keys(m.default)))"
# Expected: [ 'tui' ]

node -e "import('/var/www/opencode-blocker-diverter/dist/index.js').then(m => console.log(Object.keys(m.default)))"
# Expected: [ 'server' ]
```

## Open Questions

1. **Does `api.client.session.command({ sessionID, command: 'blockers.on' })` actually fire `command.execute.before` on the server?** This is the critical untested assumption. The route is: TUI plugin → HTTP POST → OpenCode server → `session.command` handler → fires `command.execute.before` event → plugin hook catches it.

2. **Does the TUI plugin need the spec registered somewhere separate, or does one entry in `opencode.jsonc` cover both server+TUI?** Based on loader source analysis: one entry covers both. The loader resolves server and TUI entries independently from the same spec.

3. **`ctrl+b` conflict?** Unknown until tested in live TUI.
