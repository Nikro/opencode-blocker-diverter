<!--
Sync Impact Report - Constitution v1.0.1
========================================
Version Change: 1.0.0 → 1.0.1 (PATCH)
Last Amended: 2026-02-12

CHANGES:
  - Principle I (Modular Architecture): Updated file size limits
    - Old: 150 lines max
    - New: 300-400 lines typical, 500 lines HARD limit
  - Code Quality Standards: Updated max file length to match
  - Rationale: More pragmatic for complex hook implementations

TEMPLATES STATUS:
  ⚠ .specify/templates/plan-template.md - PENDING (constitution check alignment)
  ⚠ .specify/templates/spec-template.md - PENDING (quality gates alignment)
  ⚠ .specify/templates/tasks-template.md - PENDING (testing discipline tasks)

FOLLOW-UP TODOS:
  - Update AGENTS.md file responsibility table with new limits
-->

# Blocker Diverter Plugin Constitution

**Project**: OpenCode Plugin for Autonomous Session Management

## Core Principles

### I. Modular Architecture (NON-NEGOTIABLE)

**Rules:**
- Target 300-400 lines per module for typical implementations
- HARD LIMIT: NO files exceeding 500 lines (must split if reached)
- MUST split code into focused modules: types, hooks, utilities, commands
- Each module MUST have a single, clear responsibility
- Directory structure: `index.ts` (entry), `types.ts`, `config.ts`, then organized subdirectories (`hooks/`, `commands/`, `utils/`)
- Extract common patterns into shared utilities immediately (DRY principle)
- If a module approaches 400 lines, evaluate if it needs splitting

**Rationale:** Pragmatic file sizes allow complex hook implementations while maintaining readability. 500-line hard limit prevents monolithic files. Modularity enables isolated testing, easier code review, and collaborative development.

### II. Test-Driven Development (TDD)

**Rules:**
- Tests MUST be written before implementation code
- MUST achieve minimum 80% code coverage for all hooks and utilities
- MUST include both unit tests and integration tests
- Test files MUST live alongside source files (`module.test.ts` next to `module.ts`)
- Red-Green-Refactor cycle: Write failing test → Implement → Refactor
- Use Bun's built-in test runner: `import { describe, it, expect } from 'bun:test'`

**Rationale:** TDD ensures correctness from the start, provides living documentation, and prevents regressions. Critical for plugin stability where OpenCode users depend on reliability.

### III. TypeScript Strictness & Type Safety

**Rules:**
- MUST use TypeScript with `strict: true` in tsconfig
- MUST import types from `@opencode-ai/plugin` SDK
- NO use of `any` type (use `unknown` and type guards instead)
- MUST define interfaces for all data structures (Blocker, Config, SessionState, etc.)
- MUST validate external data (config files, LLM responses) using Zod schemas
- Plugin function MUST correctly destructure context object: `async ({ client, $, project }) => ...`

**Rationale:** Type safety prevents runtime errors, improves developer experience, and enables IDE autocompletion. Zod validation ensures config correctness.

### IV. Performance & Efficiency

**Rules:**
- ALL I/O operations MUST be asynchronous
- MUST cache LLM classification results (prevent duplicate API calls)
- MUST debounce rapid event streams (cooldown mechanism for duplicate blockers)
- MUST limit blocker file size (configurable max entries, rotation strategy)
- MUST use lazy evaluation for expensive operations
- NO blocking operations in event hooks (keep hooks fast)

**Rationale:** Plugins run in OpenCode's hot path. Slow plugins degrade user experience. Async operations prevent blocking the agent. Caching reduces costs and latency.

### V. Security & Safety

**Rules:**
- MUST validate all file paths before I/O operations
- MUST sanitize user input and LLM responses before writing to files
- NEVER log sensitive data (API keys, credentials, tokens) to blockers.md
- MUST implement deduplication to prevent blocker file spam attacks
- MUST respect OpenCode's permission system (no bypassing security checks)
- MUST handle errors gracefully without exposing internal state

**Rationale:** Plugins have file system and shell access. Security vulnerabilities can compromise user projects. Input validation prevents injection attacks.

### VI. User Experience & Discoverability

**Rules:**
- MUST provide clear command interface (`/blockers on|off|status|list|resolve`)
- MUST use structured logging via `client.app.log()` (not console.log)
- MUST provide actionable error messages with recovery suggestions
- MUST document all configuration options with examples
- MUST include inline help text for commands
- MUST follow OpenCode naming conventions (opencode-blocker-diverter)

**Rationale:** Open-source plugins succeed through great UX. Users need discoverability, clear feedback, and helpful documentation. Structured logging enables debugging.

### VII. OpenCode Ecosystem Integration

**Rules:**
- MUST follow OpenCode plugin patterns from official docs
- MUST use correct hook signatures (permission.asked, session.idle, stop, etc.)
- MUST manage session state using session-keyed Maps (not global variables)
- MUST clean up state on session.deleted events
- MUST preserve critical state through compaction hook
- MUST respect plugin load order and avoid conflicts with other plugins

**Rationale:** Proper integration ensures compatibility with OpenCode core, prevents conflicts, and maintains stability across sessions and updates.

## Code Quality Standards

### Code Style
- Use ESLint with recommended TypeScript rules
- Use Prettier for consistent formatting
- Use meaningful variable names (no single-letter vars except loop counters)
- Use async/await syntax (avoid raw promises)
- Maximum function complexity: 15 cyclomatic complexity
- Target file length: 300-400 lines (HARD LIMIT: 500 lines)

### Documentation Requirements
- Every exported function MUST have JSDoc comments
- Every interface/type MUST have descriptive comments
- README.md MUST include: Quick Start, Configuration, Commands, Troubleshooting
- ARCHITECTURE.md MUST document: Hook flow, State management, Classification logic
- Inline comments MUST explain "why", not "what" (code explains what)

### Error Handling
- Use Result/Either pattern for fallible operations (consider using a helper library)
- Provide context in error messages (include operation, input, reason)
- Log errors with structured data (service, level, message, extra)
- Never silently swallow errors (always log or propagate)
- Use try-catch for async operations with proper cleanup

### Dependency Management
- Minimize external dependencies (prefer Bun/Node.js built-ins)
- Pin dependency versions in package.json (no ^ or ~ in production)
- MUST declare `@opencode-ai/plugin` and `@opencode-ai/sdk` as peer dependencies
- Keep .opencode/package.json separate from npm package dependencies
- Audit dependencies for security vulnerabilities regularly

## Development Workflow

### Branch Strategy
- `main` branch: stable releases only
- `dev` branch: active development
- Feature branches: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- NO direct commits to main (always PR through dev)

### Pull Request Requirements
- MUST pass all tests (`bun test`)
- MUST pass type checking (`tsc --noCheck`)
- MUST pass linting (`eslint src/`)
- MUST include test coverage for new code
- MUST update CHANGELOG.md with changes
- MUST have at least one approving review (for contributors)

### Testing Strategy
- **Unit Tests**: Test individual functions in isolation (80%+ coverage target)
- **Integration Tests**: Test plugin hooks with mock OpenCode context
- **Manual Testing**: Test in real OpenCode session before release
- **Regression Tests**: Add test for every bug fix
- Run tests in CI pipeline (GitHub Actions)

### Release Process
1. Update version in package.json (semver: MAJOR.MINOR.PATCH)
2. Update CHANGELOG.md with release notes
3. Create git tag: `v1.2.3`
4. Publish to npm: `npm publish`
5. Create GitHub release with changelog excerpt
6. Update documentation with new features

### Version Semantics
- **MAJOR**: Breaking changes (hook signature changes, config schema breaking changes)
- **MINOR**: New features (new hooks, new commands, new config options)
- **PATCH**: Bug fixes, performance improvements, documentation updates

## Governance

### Constitution Authority
This constitution supersedes all other development practices, guidelines, and conventions. When conflicts arise between this document and other guidance, the constitution takes precedence.

### Amendment Process
1. Propose amendment via GitHub issue with rationale
2. Discussion period (minimum 7 days for community feedback)
3. Approval requires consensus from project maintainers
4. Amendment MUST include migration plan for breaking changes
5. Update CONSTITUTION_VERSION according to semantic versioning
6. Propagate changes to all dependent templates and docs

### Compliance Reviews
- ALL pull requests MUST verify compliance with constitution principles
- Reviewers MUST cite specific principles when requesting changes
- Complexity that violates principles MUST be justified in writing
- Non-compliant code MUST be refactored before merge

### Quality Gates
Code MUST NOT be merged if:
- Tests are failing or coverage drops below 80%
- TypeScript errors exist
- ESLint violations exist (no disable comments without justification)
- Security vulnerabilities detected in dependencies
- Performance regression detected (benchmarks available)
- Documentation is incomplete or outdated

### Community Standards
- Be respectful and constructive in code reviews
- Assume good intent from contributors
- Provide helpful feedback with examples
- Recognize and credit contributions
- Follow GitHub Community Guidelines
- Maintain OpenCode community standards

**Version**: 1.0.1 | **Ratified**: 2026-02-12 | **Last Amended**: 2026-02-12
