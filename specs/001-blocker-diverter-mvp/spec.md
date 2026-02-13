# Feature Specification: Blocker Diverter Plugin (v0.1 MVP)

**Feature Branch**: `001-blocker-diverter-mvp`  
**Created**: 2026-02-12  
**Status**: Draft (Clarified)  
**Input**: User description: "Initial v0.1 fully working blocker diverter plugin"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI Agent Logs Blockers and Continues Working (Priority: P1)

When plugin is enabled AND divert-blockers toggle is ON, the AI agent encounters any blocking situation (permission request, question tool usage, hitting limits). Instead of waiting for user input, the agent receives a fake templated message from "the user" instructing it to use the blocker tool and move on. After logging the blocker, the agent receives a simple confirmation: "Great, blocker registered, move on with the next non-blocking issues!"

**Why this priority**: This is the core value proposition - enabling autonomous overnight work. Without this, the plugin has no purpose.

**Independent Test**: Can be fully tested by triggering a permission request in an OpenCode session with plugin enabled and divert-blockers ON, verifying the agent receives the fake user message template, uses blocker tool, gets confirmation response, and continues working on other issues.

**Acceptance Scenarios**:

1. **Given** plugin is enabled AND divert-blockers toggle is ON AND agent needs bash permission, **When** agent encounters permission prompt, **Then** agent receives fake templated user message instructing use of blocker tool
2. **Given** agent uses blocker tool with required fields, **When** blocker is submitted, **Then** blocker is written to `blockers.md` AND agent receives response: "Great, blocker registered, move on with the next non-blocking issues!"
3. **Given** blocker tool response received, **When** agent continues, **Then** agent autonomously identifies and works on next non-blocking issue (no task list provided)
4. **Given** agent has logged 3 blockers, **When** user opens `blockers.md`, **Then** user sees all 3 blockers with category, context, and blocking status
5. **Given** plugin is enabled but divert-blockers toggle is OFF, **When** agent encounters permission, **Then** normal OpenCode permission dialog shown (no fake message, no interception)

---

### User Story 2 - AI Agent Self-Triages Hard vs Soft Blockers (Priority: P1)

When an AI agent encounters a question, it determines whether it's a "hard blocker" (architecture decision, security choice) requiring user input, or a "soft question" (naming convention, formatting style) where the agent can research options and make a reasonable default choice.

**Why this priority**: Critical for preventing the agent from stopping unnecessarily. Soft questions should not halt progress - the agent should research, decide, log the choice, and continue.

**Independent Test**: Can be fully tested by presenting the agent with both hard blocker scenarios (e.g., "which auth framework?") and soft questions (e.g., "function name: getUserData or fetchUserData?"), verifying hard blockers stop work on that task, and soft questions result in logged choices with reasoning.

**Acceptance Scenarios**:

1. **Given** agent encounters naming question, **When** agent classifies it as soft blocker, **Then** agent researches 3 options, picks one with reasoning, logs choice to `blockers.md`, and continues
2. **Given** agent encounters architecture decision, **When** agent classifies it as hard blocker, **Then** agent logs blocker with "blocksProgress: true", switches to different task
3. **Given** agent has made soft blocker choice, **When** user reviews `blockers.md`, **Then** user sees the chosen option, alternative options considered, and reasoning for the choice
4. **Given** agent encounters destructive operation requiring permission, **When** agent evaluates necessity, **Then** agent logs hard blocker if truly needed, or skips if deferrable

---

### User Story 3 - User Controls Plugin Via Commands (Priority: P2)

A user can enable or disable the plugin for their current session, check status, list logged blockers, and export the blockers file using slash commands (`/blockers on`, `/blockers off`, `/blockers status`, `/blockers list`). User can also use `/blockers clarify` to interactively resolve logged blockers one-by-one.

**Why this priority**: Essential for user control, but the core autonomous behavior (P1 stories) must work first. Users need the ability to toggle behavior and inspect blockers.

**Independent Test**: Can be fully tested by running each `/blockers` subcommand in an OpenCode session and verifying correct state changes and output messages.

**Acceptance Scenarios**:

1. **Given** plugin is disabled, **When** user types `/blockers on`, **Then** plugin enables divert-blockers toggle for current session and user sees confirmation message
2. **Given** plugin is enabled, **When** user types `/blockers status`, **Then** user sees: enabled/disabled state, divert-blockers toggle state, number of blockers logged, session ID
3. **Given** 5 blockers are logged, **When** user types `/blockers list`, **Then** user sees summary of all 5 blockers with categories and timestamps
4. **Given** user types `/blockers off`, **When** agent encounters permission request, **Then** agent shows normal OpenCode permission dialog (plugin behavior bypassed)
5. **Given** 3 blockers are logged, **When** user types `/blockers clarify`, **Then** system loops through each blocker, uses ask/question tool to present blocker to user, waits for user response, records answer, moves to next blocker

---

### User Story 4 - Plugin Prevents Premature Agent Stop (Priority: P2)

When an AI agent tries to stop working (thinks it's "done"), the plugin injects a fake templated user message: "Check the progress of your current tasks - if you're blocked, use blocker tool, if you're not → continue with the remaining tasks. IF you are DONE and have no other tasks to do, just say 'BLOCKER_DIVERTER_DONE!'". System monitors for this unique completion marker. If agent doesn't respond with the marker, system reprompts. After X reprompts within Y minutes with same response pattern, system allows stop.

**Why this priority**: Important for maximizing overnight productivity, but less critical than the blocker logging itself (P1). Ensures agents don't give up prematurely.

**Independent Test**: Can be fully tested by setting up a session with multiple tasks, letting agent complete one, attempting to stop, and verifying the plugin injects templated check-progress prompt and monitors for completion marker.

**Acceptance Scenarios**:

1. **Given** agent tries to stop, **When** plugin intercepts stop signal, **Then** plugin injects templated message: "Check the progress of your current tasks - if blocked, use blocker tool. If done, say 'BLOCKER_DIVERTER_DONE!'"
2. **Given** agent responds without 'BLOCKER_DIVERTER_DONE!' marker, **When** system detects missing marker, **Then** system reprompts with same template
3. **Given** agent responds with 'BLOCKER_DIVERTER_DONE!' marker, **When** system detects marker, **Then** system allows agent to stop
4. **Given** agent has been reprompted X times in Y minutes with identical response pattern, **When** threshold exceeded, **Then** system allows stop (prevents infinite loop)
5. **Given** agent has no work remaining and no blockers, **When** agent says 'BLOCKER_DIVERTER_DONE!', **Then** plugin allows stop immediately

---

### User Story 5 - Plugin Provides Blocker Tool to AI Agent (Priority: P1)

When plugin is enabled AND divert-blockers toggle is ON, the plugin injects a synthetic `blocker` tool into the AI agent's available tools via system prompt transformation. The tool has a well-defined schema (category, question, context, blocksProgress, options, chosenOption) that guides the agent to provide structured information.

**Why this priority**: Core infrastructure requirement - without the blocker tool definition, agents have no mechanism to log blockers. This is foundational to all other stories.

**Independent Test**: Can be fully tested by inspecting the system prompt after plugin loads with divert-blockers ON, verifying the blocker tool definition is present, and confirming the tool schema includes all required fields.

**Acceptance Scenarios**:

1. **Given** plugin is enabled AND divert-blockers toggle is ON, **When** session starts, **Then** system prompt includes blocker tool definition with complete JSON schema
2. **Given** blocker tool is available, **When** agent calls it with valid arguments, **Then** tool intercept hook catches the call and processes it
3. **Given** agent calls blocker tool with missing required field, **When** tool handler validates, **Then** agent receives error message indicating which field is missing
4. **Given** blocker tool is called, **When** handler returns response, **Then** response is: "Great, blocker registered, move on with the next non-blocking issues!"
5. **Given** plugin is enabled but divert-blockers toggle is OFF, **When** session starts, **Then** blocker tool is NOT injected into system prompt

---

### Edge Cases

- What happens when agent logs duplicate blocker (same question within 30 seconds)?
  - System uses cooldown hash to deduplicate, ignores duplicate, logs info message

- How does system handle blocker file write failure (disk full, permissions)?
  - Blocker kept in-memory state, error logged, retry on next blocker call

- What happens when agent calls blocker tool while divert-blockers toggle is OFF?
  - Tool intercept hook ignores call, logs info message, no file write occurs

- How does system handle session with 50+ blockers (flooding)?
  - Config setting `maxBlockersPerRun` limits blockers per session (default: 50), further blocker calls return warning

- What happens when agent encounters permission request but plugin system prompt injection fails?
  - Permission hook falls back to normal OpenCode behavior (show user dialog)

- How does system handle multiple concurrent sessions with different divert-blockers toggle states?
  - Session-keyed Map stores per-session state, each session operates independently

- What happens when user manually edits `blockers.md` while session is active?
  - Plugin only appends, never reads during session, manual edits preserved (appends go to end of file)

- How does system handle blocker tool call with invalid category enum value?
  - Zod validation catches error, returns message to agent: "Invalid category. Must be one of: permission, architecture, security, destructive, question, other"

- What happens when agent is reprompted X times with identical non-completion response?
  - System tracks response pattern hash, if same hash appears X times in Y minutes, allows stop to prevent infinite loop

- How does system detect "identical response pattern" for reprompt threshold?
  - System hashes agent's response text (excluding timestamps/IDs), compares hash to recent responses, increments counter if match

- What happens during `/blockers clarify` if user skips a blocker?
  - System marks blocker as "skipped", moves to next blocker, continues loop

- What happens if `/blockers clarify` is interrupted mid-loop?
  - System saves progress (which blockers clarified/skipped), allows resume on next `/blockers clarify` invocation

- How does fake templated user message distinguish itself from real user messages?
  - It doesn't - agent perceives it as real user input, ensuring natural continuation behavior

- What happens when divert-blockers toggle changes mid-session?
  - Next interception point respects new toggle state (ON = fake message + blocker tool, OFF = normal behavior)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST maintain two-level toggle: plugin enabled (global) AND divert-blockers toggle (per-session, default ON when plugin enabled)
- **FR-002**: System MUST inject synthetic blocker tool definition into AI agent's available tools ONLY when divert-blockers toggle is ON
- **FR-003**: Blocker tool MUST accept structured arguments: category (enum), question (string), context (string), blocksProgress (boolean), options (optional array), chosenOption (optional string), chosenReasoning (optional string)
- **FR-004**: System MUST validate blocker tool arguments using Zod schema before processing
- **FR-005**: System MUST write blockers to markdown file in checklist format with sections for hard blockers and soft blockers
- **FR-006**: System MUST maintain session-keyed state Map storing: enabled status, divert-blockers toggle, blocker list, cooldown hashes, last blocker timestamp, reprompt counter, response pattern hashes
- **FR-007**: System MUST intercept permission requests via `permission.asked` hook and inject fake templated user message when divert-blockers toggle is ON
- **FR-008**: Fake templated user message MUST instruct agent to use blocker tool and move on with next non-blocking issues
- **FR-009**: Blocker tool response MUST be templated: "Great, blocker registered, move on with the next non-blocking issues!"
- **FR-010**: System MUST NOT provide task lists or next-step suggestions (agent decides autonomously)
- **FR-011**: System MUST inject system prompt instructions explaining blocker tool usage, triage process, and soft blocker research workflow ONLY when divert-blockers toggle is ON
- **FR-012**: System MUST handle `/blockers` command with subcommands: on, off, status, list, export, clarify
- **FR-013**: `/blockers clarify` MUST loop through logged blockers, use ask/question tool for each, wait for user response, record answer, move to next
- **FR-014**: System MUST prevent agent stop by injecting templated check-progress message via `stop` hook when divert-blockers toggle is ON
- **FR-015**: Stop prevention message MUST include completion marker instruction: "If DONE, say 'BLOCKER_DIVERTER_DONE!'"
- **FR-016**: System MUST monitor agent responses for 'BLOCKER_DIVERTER_DONE!' marker before allowing stop
- **FR-017**: System MUST track reprompt count and response pattern hashes to detect infinite loops
- **FR-018**: System MUST allow stop after X reprompts (default: 5) within Y minutes (default: 2) with identical response pattern
- **FR-019**: System MUST deduplicate blockers using cooldown hash (30 second window by default)
- **FR-020**: System MUST initialize session state on `session.created` event and cleanup on `session.deleted` event
- **FR-021**: System MUST load configuration from `opencode.json` file with Zod validation and provide defaults
- **FR-022**: System MUST provide structured logging for all plugin operations (blocker logged, state change, errors)
- **FR-023**: System MUST limit blockers per session based on config setting (default: 50)
- **FR-024**: System MUST handle file I/O errors gracefully (keep in-memory state, retry logic)
- **FR-025**: System MUST respect divert-blockers toggle state (OFF = normal OpenCode behavior, no interception)
- **FR-026**: Soft blocker workflow MUST instruct agent to research 3 options, pick one, provide reasoning
- **FR-027**: System MUST format blocker markdown with: timestamp, session ID, category sections, checkbox items, context fields

### Key Entities

- **Blocker**: Represents a question or decision point logged by the AI agent. Key attributes: unique ID, timestamp, session ID, category (permission/architecture/security/destructive/question/other), question text, context description, blocks progress flag, optional 3 researched options, optional chosen option with reasoning, optional metadata (tool name, file path, arguments), clarification status (pending/clarified/skipped).

- **SessionState**: Represents the runtime state for a single OpenCode session. Key attributes: plugin enabled flag, divert-blockers toggle (ON/OFF), list of blockers logged, set of cooldown hashes for deduplication, timestamp of last blocker, reprompt counter, list of recent response pattern hashes (for loop detection), last reprompt timestamp.

- **Config**: Represents plugin configuration loaded from opencode.json. Key attributes: enabled flag (global default), divert-blockers default toggle state, blockers file path, max blockers per session limit, cooldown duration in milliseconds, reprompt threshold (max reprompts before allowing stop), reprompt window duration (time window for detecting loops), completion marker string (default: "BLOCKER_DIVERTER_DONE!"), list of soft blocker category keywords.

- **ToolDefinition**: Represents the synthetic blocker tool made available to AI agent when divert-blockers toggle is ON. Key attributes: tool name ("blocker"), description text, JSON schema for parameters with required fields and enums, return format specification (fixed template response).

- **FakeMessageTemplate**: Represents templated "user" messages injected during interception. Key attributes: permission interception template, stop prevention template with completion marker, variable substitution rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: AI agents can work autonomously for at least 4 hours overnight without requiring user intervention, logging all blocking questions to file
- **SC-002**: When presented with 10 test scenarios (5 hard blockers, 5 soft questions), agent correctly classifies and handles 9+ scenarios appropriately (90%+ accuracy)
- **SC-003**: Users can review morning blocker log file and understand each blocker's context, category, and impact without needing additional information (100% comprehensibility in user testing)
- **SC-004**: Plugin prevents at least 80% of premature agent stops when work remains, using templated check-progress messages and completion marker detection (measured across 20 test sessions with multi-task workloads)
- **SC-005**: All `/blockers` commands execute and return results in under 1 second for sessions with up to 50 logged blockers
- **SC-006**: `/blockers clarify` successfully loops through all logged blockers, presenting each via ask/question tool, with <2 second latency per blocker presentation
- **SC-007**: Plugin handles 10 concurrent OpenCode sessions with independent divert-blockers toggle states without errors or cross-contamination
- **SC-008**: Blocker file write operations complete within 50 milliseconds on standard hardware (measured across 100 blocker logging operations)
- **SC-009**: System recovers gracefully from file I/O errors without losing blocker data (kept in-memory, retry succeeds within 3 attempts)
- **SC-010**: For soft blocker scenarios, agent provides reasoning quality rated 4+ out of 5 by human reviewers (measuring quality of option research and choice explanation)
- **SC-011**: Infinite loop detection prevents runaway reprompting in 100% of test cases (agent reprompted max 5 times before stop allowed)
- **SC-012**: Agent perceives fake templated messages as authentic user input in 100% of test cases (no behavioral differences vs. real user messages)
- **SC-013**: Zero security vulnerabilities identified in file path handling, input validation, and secrets logging (verified via security review checklist)
