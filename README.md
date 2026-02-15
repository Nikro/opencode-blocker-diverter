# Blocker Diverter

> OpenCode plugin for autonomous overnight sessions — intercept blockers, continue work, review in the morning.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/opencode-blocker-diverter.svg)](https://www.npmjs.com/package/opencode-blocker-diverter)

## Problem

AI coding agents get chatty. They stop to ask questions about framework choices, naming conventions, deployment strategies. This breaks the "autonomous overnight run" workflow.

**You want:** Start a task at 5pm, walk away, return at 9am to completed work.  
**Reality:** Agent stopped at 6:03pm asking "Should I use Zod or Yup for validation?"

## Solution

**Blocker Diverter** intercepts questions and confirmations:

- **Hard blockers** (architecture, security, destructive actions) → logged to `BLOCKERS.md` for morning review
- **Soft questions** (naming, formatting, minor preferences) → answered with sensible defaults
- **Agent keeps working** on independent tasks while blocked items wait for human review

## Features

- 🚫 **Permission interception** — catches "Allow/Deny" dialogs before they reach you
- 🤖 **LLM-based classification** — distinguishes hard blockers from soft questions
- 📝 **Structured blocker log** — morning-friendly format with context, options, and tradeoffs
- ⚙️ **Configurable rules** — customize what counts as a blocker, set defaults for soft questions
- 🔥 **Deduplication** — prevents blocker spam via cooldown mechanism
- 💬 **Command interface** — `/blockers on|off|status|list` for easy control
- 🎹 **TUI hotkey** — quick toggle without breaking flow

## Quick Start

### Installation

**From npm:**
```bash
npm install -g opencode-blocker-diverter
```

**In your project's `opencode.json`:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-blocker-diverter"]
}
```

**Or local development:**
```bash
# Clone and link for development
git clone https://github.com/Nikro/opencode-blocker-diverter.git
cd opencode-blocker-diverter
bun install
bun run build

# Link to OpenCode (from project directory with opencode.json)
npm link /path/to/opencode-blocker-diverter
```

### Basic Usage

> **⚠️ Important:** The plugin requires explicit activation via `/blockers on` command. This ensures autonomous behavior only happens when you intentionally enable it.

#### AI Agent Usage (The Blocker Tool)

When the Blocker Diverter plugin is active, AI agents have access to a `blocker` tool that they can actively call to log blocking questions:

```typescript
// AI agent encounters a hard blocker
await use_tool("blocker", {
  question: "Which authentication provider should I use?",
  category: "architecture",
  context: "Building user login system. Files: src/auth/provider.ts, src/middleware/auth.ts"
})
// Returns: "Great, blocker registered, move on with the next non-blocking issues!"
```

**Categories:**
- `architecture` — Framework/library selection, design patterns
- `security` — Authentication, authorization, data protection
- `destructive` — Delete operations, data migrations
- `deployment` — Hosting, CI/CD, environment configuration
- `question` — General questions requiring human input
- `other` — Uncategorized blockers

**When agents should use it:**
- Hard decisions requiring human judgment (framework choice, security strategy)
- Destructive operations (deleting files, dropping tables)
- Deployment/configuration choices (hosting provider, CI/CD setup)

**When agents should NOT use it:**
- Naming conventions (make reasonable default: `getUserData`)
- Code formatting (follow project style: Prettier/ESLint)
- Minor refactoring choices (use existing patterns)

#### User Commands

```bash
# In OpenCode session
/blockers on          # Enable blocker diverter
/blockers off         # Disable (back to normal interactive mode)
/blockers status      # Check current state
/blockers list        # Show recorded blockers

# Morning workflow
cat BLOCKERS.md       # Review overnight blockers
/blockers resolve 3 2 # Resolve blocker #3 with option 2
```

## Configuration

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-blocker-diverter"],
  "blockerDiverter": {
    "enabled": true,
    "blockersFile": "BLOCKERS.md",
    "maxBlockersPerRun": 20,
    "cooldown": 60000,
    "useLLMClassification": true,
    "hardBlockerRules": {
      "keywords": ["framework", "auth", "deploy", "migration", "delete", "security"],
      "patterns": ["^Which .+ should", "^Should I use", "^Delete .+\\?"],
      "categories": ["architecture", "security", "destructive", "deployment"]
    },
    "softDefaults": {
      "naming": "use descriptive camelCase",
      "formatting": "follow project Prettier config",
      "refactoring": "prefer composition over inheritance"
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Global plugin enable/disable (plugin loads, but requires `/blockers on` to activate autonomous mode) |
| `defaultDivertBlockers` | boolean | `false` | Whether blocker diversion starts enabled in new sessions (requires explicit `/blockers on`) |
| `blockersFile` | string | `"BLOCKERS.md"` | Path to blocker log file |
| `maxBlockersPerRun` | number | `50` | Safety limit (prevents runaway logging) |
| `cooldownMs` | number | `30000` | Milliseconds to dedupe identical blockers |
| `maxReprompts` | number | `5` | Maximum continuation prompts before stopping |
| `repromptWindowMs` | number | `300000` | Time window (5 min) for reprompt rate limiting |
| `completionMarker` | string | `"BLOCKER_DIVERTER_DONE!"` | Phrase agent says when finished |
| `promptTimeoutMs` | number | `30000` | Timeout for prompt injection API calls |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Agent Loop                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Agent wants to execute tool (bash, edit, etc.)  │  │
│  │  2. Permission system checks if approval needed     │  │
│  └────────────┬─────────────────────────────────────────┘  │
│               │                                             │
│               ▼                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Blocker Diverter Plugin Hooks                       │  │
│  │                                                       │  │
│  │  permission.asked → Intercept before user sees it   │  │
│  │  session.idle     → Detect "done but actually not"  │  │
│  │  stop             → Prevent premature exit          │  │
│  └────────────┬─────────────────────────────────────────┘  │
│               │                                             │
│               ▼                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Classification (LLM-based or rule-based)            │  │
│  │  ┌─────────────┐         ┌─────────────┐            │  │
│  │  │ HARD        │         │ SOFT        │            │  │
│  │  │ BLOCKER     │         │ QUESTION    │            │  │
│  │  └──────┬──────┘         └──────┬──────┘            │  │
│  │         │                       │                    │  │
│  │         ▼                       ▼                    │  │
│  │  Log to          Apply                              │  │
│  │  blockers.md     default                            │  │
│  │  + inject        + continue                         │  │
│  │  "continue"                                          │  │
│  │  prompt                                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Hook Flow

1. **Permission Hook**: Catches tool confirmations (bash, edit, external_directory)
2. **Session Idle Hook**: Detects conversational questions ("What next?")
3. **LLM Classifier**: Determines hard vs soft (or rule-based patterns)
4. **Blocker Logger**: Appends structured entry to `BLOCKERS.md`
5. **Prompt Injector**: Sends synthetic response to keep agent working
6. **Stop Hook**: Prevents agent from exiting prematurely

## Blocker Log Format

Example `BLOCKERS.md` entry:

```markdown
## Blocker #3
**Time:** 2026-02-12T02:34:12Z
**Branch:** feature/user-auth
**Session:** abc123-def456

### What I'm blocked on
Need to choose authentication provider for user login system

### Why it matters
Security-critical decision. Wrong choice = costly migration later.
Affects token strategy, session management, and third-party integrations.

### Options
1. **Auth0** — Full-featured, expensive, vendor lock-in risk
2. **Supabase Auth** — Open-source friendly, PostgreSQL-based, less mature
3. **Custom JWT** — Full control, high maintenance burden, security risk

### Default if no answer
Option 2 (Supabase Auth) — balances open-source values with maintainability

### Files involved
- src/auth/provider.ts
- src/middleware/auth.ts
- .env.example

### Last tool output
```
$ npm search auth provider
... (truncated for brevity)
```

---
```

## Commands

### `/blockers on`
Enable blocker diverter for current session.

### `/blockers off`
Disable blocker diverter (back to normal interactive mode).

### `/blockers status`
Show current state: enabled/disabled, blocker count, last action.

### `/blockers list`
Print summary of all recorded blockers.

### `/blockers resolve <id> <option>`
Resolve blocker #id by selecting option (future feature).

## Troubleshooting

### Plugin not loading
- Check `opencode.json` syntax
- Verify plugin name: `"opencode-blocker-diverter"` (exact match)
- Check logs: `~/.local/state/opencode/logs/`

### Blockers not being caught
- Confirm `enabled: true` in config
- Check if question matches hardBlockerRules patterns
- Enable debug logging in config

### Agent still stopping
- Check stop hook implementation
- Review session.idle handler logs
- Ensure compaction hook preserves state

## Development

### Setup
```bash
git clone https://github.com/Nikro/opencode-blocker-diverter.git
cd opencode-blocker-diverter
bun install
```

### Testing
```bash
bun test              # Run all tests
bun test --coverage   # With coverage report
bun test --watch      # Watch mode
```

### Code Quality
```bash
bun run lint          # ESLint
bun run typecheck     # TypeScript
bun run format        # Prettier
```

### Project Structure
```
opencode-blocker-diverter/
├── index.ts              # Root entry point (export default createPlugin)
├── package.json          # NPM package manifest
├── tsconfig.json         # TypeScript configuration
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
│   ├── hooks/
│   │   ├── session.ts
│   │   ├── tool-intercept.ts
│   │   └── system-prompt.ts
│   └── commands/
│       └── blockers-cmd.ts
├── tests/                # All tests with fixed imports
│   ├── config.test.ts
│   ├── state.test.ts
│   └── utils/
│       ├── logging.test.ts
│       ├── dedupe.test.ts
│       └── templates.test.ts
└── dist/                 # Build output (gitignored)
    ├── index.js         # Bundled plugin
    ├── index.d.ts       # TypeScript declarations
    └── src/             # Type definition modules
```

## Development Workflow (Spec-Kit)

This project uses **spec-kit** for structured development. Here's the correct workflow:

```
┌─────────────────────────────────────────────────────────────┐
│  Spec-Kit Development Workflow                              │
│                                                              │
│  0. /speckit.constitution → Project principles (once)       │
│  1. /speckit.specify      → What & Why (requirements)       │
│  2. /speckit.clarify      → Resolve ambiguities (before!)   │
│  3. /speckit.plan         → How (tech stack + architecture) │
│  4. /speckit.tasks        → Break down into actionable work │
│  5. /speckit.implement    → Execute with TDD                │
│  └─────────────────────────────────────────────────────────┘
│                          ↓ Iterate ↑                        │
└─────────────────────────────────────────────────────────────┘
```

### When to Use Each Command

| Command | When | Output |
|---------|------|--------|
| `/speckit.constitution` | Project start (once) | Governing principles and development guidelines |
| `/speckit.specify` | New feature needed | User stories, requirements, success criteria |
| `/speckit.clarify` | Before planning (recommended!) | Resolved ambiguities, clarified edge cases |
| `/speckit.plan` | After spec is clear | Tech stack decisions, architecture, module structure |
| `/speckit.tasks` | Plan approved | Ordered task breakdown with dependencies |
| `/speckit.implement` | Ready to code | Working implementation with tests |

**Pro Tip:** Always run `/speckit.clarify` before `/speckit.plan` to prevent rework!

📚 **Learn More:**
- [Spec-Kit Documentation](https://github.com/github/spec-kit)
- [Development Best Practices](.specify/memory/constitution.md)
- [Agent Guidelines](AGENTS.md)

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [.specify/memory/constitution.md](.specify/memory/constitution.md) for development standards.

### Key Principles
- **Modular architecture** — target 300-400 lines per module, 500-line hard limit
- **Test-driven development** — tests before implementation
- **TypeScript strict mode** — no `any` types
- **Performance first** — async operations, caching, debouncing
- **Security conscious** — validate inputs, sanitize outputs

## License

MIT © 2026

## Acknowledgments

- [OpenCode](https://opencode.ai) — extensible AI coding agent
- Community plugin examples and patterns
- Contributors and testers

---

**Status**: 🚧 In Development | **Version**: 0.1.0 (pre-release)
