# Changelog

All notable changes to the Blocker Diverter plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-14

### Added
- **Core Blocker Tool System**: AI agents can now actively call the `blocker` tool to log blocking questions and continue working autonomously
  - Tool definition with JSON schema validation (Zod)
  - XML tool definition injection into system prompts (Anthropic-compatible)
  - Tool handler with validation → logging → success response flow
  - Support for 6 blocker categories: `architecture`, `security`, `destructive`, `deployment`, `question`, `other`
- **Hook System**: Complete implementation of OpenCode plugin hooks
  - `experimental.chat.system.transform`: Injects blocker tool definition and autonomous mode instructions
  - `tool.execute.before`: Intercepts blocker tool calls and handles logging
  - `event`: Manages session lifecycle (created, deleted, idle)
  - Legacy `question` tool blocking for backward compatibility
- **Session State Management**: Session-keyed Map pattern for tracking blockers, files modified, and plugin state
- **Configuration System**: Zod-validated configuration with defaults and user overrides
  - `blockersFile`: Path to blockers markdown file (default: `blockers.md`)
  - `maxBlockersPerRun`: Limit on blockers per session (default: 50)
  - `cooldownMs`: Deduplication cooldown period (default: 30000ms)
  - `defaultDivertBlockers`: Enable/disable blocker diversion by default
  - `maxReprompts`: Maximum continue prompts before stopping (default: 5)
  - `completionMarker`: Marker phrase for agent completion (default: `BLOCKER_DIVERTER_DONE!`)
- **User Commands**: `/blockers` command with subcommands
  - `/blockers on` - Enable blocker diversion for current session
  - `/blockers off` - Disable blocker diversion for current session
  - `/blockers status` - Show current state and blocker count
  - `/blockers list` - Display all blockers in current session
- **Blocker Log Format**: Structured markdown format with context, categories, and timestamps
  - Hard blockers: Architecture, security, destructive, deployment decisions
  - Soft questions: Naming, formatting, minor choices (with chosen option)
  - Full context preservation for later review
- **Deduplication System**: Cooldown-based hash mechanism to prevent duplicate blocker logging
- **Utilities**: Structured logging, timeout handling, template generation
- **Comprehensive Test Suite**: 330 tests covering all modules (80%+ coverage)
  - Unit tests for all core modules
  - Integration tests for hook workflows
  - E2E scenario tests for complete flows

### Documentation
- README with installation, usage, and configuration examples
- AI agent usage guide with TypeScript examples
- Configuration reference with all options
- Architecture documentation explaining hook flow
- AGENTS.md with development guidelines and constitution compliance

### Known Limitations
- Manual testing (Task 7.3) not yet completed - needs validation in real OpenCode environment
- No compaction hook implementation (deferred to v0.2.0)
- Task parsing is heuristic-based, not AI-powered (future enhancement)
- No hotkey implementation (TUI API support unclear, deferred)
- Blocker log rotation not implemented (will be added when file size becomes an issue)
- `session.ts` file is 608 lines (exceeds 500-line constitution limit) - refactoring planned for v0.2.0

### Technical Details
- **Language**: TypeScript 5.x with strict mode
- **Runtime**: Bun (JavaScript runtime with built-in shell API)
- **Build Output**: ESM bundle (`dist/index.js` ~600KB)
- **Plugin SDK**: `@opencode-ai/plugin` v0.x
- **Validation**: Zod schemas for runtime type safety
- **Testing**: Bun test runner with coverage reporting

---

## [Unreleased]

### Planned for v0.2.0
- **Code Quality**: Refactor `session.ts` (608 lines) into smaller modules to meet 500-line constitution limit
  - Extract session-types.ts for interfaces
  - Extract session-helpers.ts for utility functions
  - Maintain <400 lines per module for better maintainability
- Compaction hook: Preserve blocker state across session compaction
- Enhanced task tracking: AI-powered task extraction from conversation history
- Blocker resolution tracking: Mark blockers as resolved with annotations
- Priority levels: High/medium/low priority for blockers
- Summary generation: `/blockers summary` command for reporting
- File size management: Blocker log rotation when exceeding threshold
- Hotkey support: Quick toggle for blocker diversion (if TUI API supports it)

### Future Enhancements
- Web dashboard: Visualize blockers across multiple sessions
- Blocker analytics: Track most common blocker types, time spent blocked
- Integration with task management: Export blockers to GitHub Issues, Jira, etc.
- Multi-agent coordination: Share blockers across parallel agent sessions
- Blocker resolution suggestions: AI-powered recommendations for unblocking

---

## Version History

- **v0.1.0** (2026-02-14): Initial release with core blocker tool system
