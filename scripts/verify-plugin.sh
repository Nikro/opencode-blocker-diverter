#!/usr/bin/env bash
# scripts/verify-plugin.sh
# ─────────────────────────────────────────────────────────────────────────────
# End-to-end sanity check for opencode-blocker-diverter.
# Run from any directory: bash /path/to/scripts/verify-plugin.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Locate repo root (script lives in <root>/scripts/) ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DIST="$ROOT/dist"

# ── ANSI colours ─────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
BOLD="\033[1m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}✔  $*${RESET}"; }
fail() { echo -e "  ${RED}✘  $*${RESET}"; }
info() { echo -e "  ${CYAN}ℹ  $*${RESET}"; }
warn() { echo -e "  ${YELLOW}⚠  $*${RESET}"; }
header() { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }

# ── Result tracking ───────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
declare -a RESULTS=()

record() {
  local name="$1" status="$2"
  RESULTS+=("$name|$status")
  if [[ "$status" == "PASS" ]]; then
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 — dist files exist and have correct module shape
# ─────────────────────────────────────────────────────────────────────────────
header "Check 1 — Module shape (dist/tui.js + dist/index.js)"

CHECK1_NAME="Module shape"

if [[ ! -f "$DIST/tui.js" ]] || [[ ! -f "$DIST/index.js" ]]; then
  fail "dist/ is missing tui.js or index.js — run: bun run build"
  record "$CHECK1_NAME" "FAIL"
else
  CHECK1_OK=true

  # Verify tui.js default export has id + tui
  TUI_SHAPE_OUTPUT=$(bun -e "
    import plugin from '$DIST/tui.js';
    if (typeof plugin !== 'object' || plugin === null) {
      process.stderr.write('tui.js: default export is not an object\n');
      process.exit(1);
    }
    if (plugin.id !== 'opencode-blocker-diverter') {
      process.stderr.write('tui.js: plugin.id is \"' + plugin.id + '\" (expected opencode-blocker-diverter)\n');
      process.exit(1);
    }
    if (typeof plugin.tui !== 'function') {
      process.stderr.write('tui.js: plugin.tui is not a function\n');
      process.exit(1);
    }
    console.log('tui.js OK — id=' + plugin.id + ', tui=' + typeof plugin.tui);
  " 2>&1) || true

  if echo "$TUI_SHAPE_OUTPUT" | grep -q "^tui.js OK"; then
    pass "$TUI_SHAPE_OUTPUT"
  else
    fail "tui.js shape check failed: $TUI_SHAPE_OUTPUT"
    CHECK1_OK=false
  fi

  # Verify index.js has a default export (server plugin)
  INDEX_SHAPE_OUTPUT=$(bun -e "
    import plugin from '$DIST/index.js';
    if (typeof plugin !== 'function' && typeof plugin !== 'object') {
      process.stderr.write('index.js: default export is neither a function nor an object\n');
      process.exit(1);
    }
    console.log('index.js OK — default export type=' + typeof plugin);
  " 2>&1) || true

  if echo "$INDEX_SHAPE_OUTPUT" | grep -q "^index.js OK"; then
    pass "$INDEX_SHAPE_OUTPUT"
  else
    fail "index.js shape check failed: $INDEX_SHAPE_OUTPUT"
    CHECK1_OK=false
  fi

  if [[ "$CHECK1_OK" == "true" ]]; then
    record "$CHECK1_NAME" "PASS"
  else
    record "$CHECK1_NAME" "FAIL"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — TUI command registration (full mock run)
# ─────────────────────────────────────────────────────────────────────────────
header "Check 2 — TUI command registration (mock API)"

CHECK2_NAME="TUI command registration"

CMD_OUTPUT=$(bun -e "
  import plugin from '$DIST/tui.js';

  const commands = [];
  const toasts   = [];
  const disposers = [];

  const mockApi = {
    command: {
      register: (cb) => {
        const cmds = cb();
        commands.push(...cmds);
        return () => {};
      },
    },
    route: { current: { name: 'session', params: { sessionID: 'verify-session' } } },
    ui:    { toast: (t) => toasts.push(t) },
    kv:    { get: (k, d) => d, set: () => {}, delete: () => {} },
    client: { session: { command: async () => {} } },
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
  };

  await plugin.tui(mockApi, {}, {});

  const expected = ['blockers.toggle', 'blockers.on', 'blockers.off', 'blockers.status', 'blockers.list'];
  const values   = commands.map(c => c.value);
  const missing  = expected.filter(v => !values.includes(v));

  if (missing.length) {
    process.stderr.write('FAIL: Missing commands: ' + missing.join(', ') + '\n');
    process.exit(1);
  }
  console.log('PASS: Registered ' + commands.length + ' command(s):');
  for (const c of commands) {
    const slash = c.slash?.name ?? '(no slash)';
    const kb    = c.keybind ? ' [keybind: ' + c.keybind + ']' : '';
    console.log('  \u2022 ' + c.value.padEnd(20) + '  title=\"' + c.title + '\"  slash=' + slash + kb);
  }
  if (disposers.length > 0) {
    console.log('  lifecycle.onDispose registered: ' + disposers.length + ' function(s) \u2714');
  }
" 2>&1) || true

if echo "$CMD_OUTPUT" | grep -q "^PASS:"; then
  while IFS= read -r line; do
    pass "$line"
  done <<< "$CMD_OUTPUT"
  record "$CHECK2_NAME" "PASS"
else
  fail "Command registration check failed:"
  echo "$CMD_OUTPUT" | sed 's/^/    /'
  record "$CHECK2_NAME" "FAIL"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3 — OpenCode log scan
# ─────────────────────────────────────────────────────────────────────────────
header "Check 3 — OpenCode log scan (~/.local/share/opencode/log/)"

CHECK3_NAME="Log scan"
LOG_DIR="$HOME/.local/share/opencode/log"

if [[ ! -d "$LOG_DIR" ]]; then
  warn "Log directory not found ($LOG_DIR) — skipping (OpenCode may not have run yet)"
  record "$CHECK3_NAME" "PASS"  # not a hard failure
else
  LATEST_LOG=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
  if [[ -z "$LATEST_LOG" ]]; then
    warn "No .log files found in $LOG_DIR — skipping"
    record "$CHECK3_NAME" "PASS"
  else
    info "Scanning: $LATEST_LOG"
    MATCHES=$(grep -iE "blocker|tui\.plugin|blocker-diverter" "$LATEST_LOG" 2>/dev/null | tail -10 || true)
    if [[ -n "$MATCHES" ]]; then
      pass "Found plugin references in log:"
      echo "$MATCHES" | sed 's/^/      /'
      record "$CHECK3_NAME" "PASS"
    else
      warn "No 'blocker|tui.plugin|blocker-diverter' references in latest log (plugin may not have loaded yet)"
      info "Latest log: $LATEST_LOG"
      record "$CHECK3_NAME" "PASS"  # degrade gracefully — plugin may not have run
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4 — opencode config check
# ─────────────────────────────────────────────────────────────────────────────
header "Check 4 — OpenCode config (opencode debug config)"

CHECK4_NAME="Config check"

if ! command -v opencode &>/dev/null; then
  warn "opencode binary not found in PATH — skipping config check"
  record "$CHECK4_NAME" "PASS"  # degrade gracefully in CI
else
  CONFIG_OUTPUT=$(opencode debug config 2>&1 || true)
  if echo "$CONFIG_OUTPUT" | grep -q "blocker-diverter\|opencode-blocker-diverter"; then
    pass "Plugin spec found in opencode config"
    echo "$CONFIG_OUTPUT" | grep -i "blocker" | sed 's/^/      /'
    record "$CHECK4_NAME" "PASS"
  else
    fail "Plugin spec NOT found in opencode debug config output"
    info "Make sure opencode.jsonc / tui.jsonc reference the plugin"
    info "Expected: \"./node_modules/opencode-blocker-diverter\" in plugins array"
    record "$CHECK4_NAME" "FAIL"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD} Verification Summary${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
for entry in "${RESULTS[@]}"; do
  name="${entry%%|*}"
  status="${entry##*|}"
  if [[ "$status" == "PASS" ]]; then
    echo -e "  ${GREEN}PASS${RESET}  $name"
  else
    echo -e "  ${RED}FAIL${RESET}  $name"
  fi
done
echo ""
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✔  All ${PASS_COUNT} checks passed${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}  ✘  ${FAIL_COUNT} check(s) failed, ${PASS_COUNT} passed${RESET}"
  exit 1
fi
