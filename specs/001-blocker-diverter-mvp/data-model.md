# Data Model: Blocker Diverter Plugin

**Spec Reference**: FR-003/006/021, Key Entities (Blocker, SessionState, Config)
**Constitution**: Strict TS, Zod validation, no `any`

## Core Interfaces (types.ts)

```typescript
export type BlockerCategory = 'permission' | 'architecture' | 'security' | 'destructive' | 'question' | 'other';

export interface Blocker {
  /** Unique ID (timestamp + sessionId + hash) */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** OpenCode session ID */
  sessionId: string;
  /** Blocker type (enum, Zod validated) */
  category: BlockerCategory;
  /** Exact question/decision text */
  question: string;
  /** Surrounding context (task, file, args) */
  context: string;
  /** True if halts all progress (hard blocker) */
  blocksProgress: boolean;
  /** Optional: 3 researched options for soft blockers */
  options?: string[];
  /** Optional: Chosen option (soft only) */
  chosenOption?: string;
  /** Optional: Reasoning for choice */
  chosenReasoning?: string;
  /** Clarification status */
  clarified?: 'pending' | 'clarified' | 'skipped';
  /** User-provided resolution */
  clarification?: string;
}

export interface SessionState {
  /** Global plugin enabled */
  enabled: boolean;
  /** Per-session divert-blockers toggle (default true) */
  divertBlockers: boolean;
  /** Logged blockers (in-mem copy) */
  blockers: Blocker[];
  /** Cooldown hashes (dedupe, 30s window) */
  cooldownHashes: Set<string>;
  /** Last blocker timestamp (ms) */
  lastBlockerTime: number;
  /** Reprompt counter for stop prevention */
  repromptCount: number;
  /** Recent response hashes (loop detection) */
  recentResponseHashes: string[];
  /** Last reprompt timestamp */
  lastRepromptTime: number;
}

export interface PluginConfig {
  /** Global enable toggle */
  enabled: boolean;
  /** Default divert-blockers state */
  defaultDivertBlockers: boolean;
  /** Blockers file path (validated) */
  blockersFile: string;
  /** Max blockers per session */
  maxBlockersPerRun: number;
  /** Dedupe cooldown (ms) */
  cooldownMs: number;
  /** Max reprompts before allow stop */
  maxReprompts: number;
  /** Reprompt window (ms) */
  repromptWindowMs: number;
  /** Completion marker string */
  completionMarker: string;
}
```

## Zod Schemas

### Config Schema (config.ts)
```typescript
import { z } from 'zod';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultDivertBlockers: z.boolean().default(true),
  blockersFile: z.string().default('./blockers.md'),
  maxBlockersPerRun: z.number().int().min(1).max(100).default(50),
  cooldownMs: z.number().int().min(1000).default(30000),
  maxReprompts: z.number().int().min(1).default(5),
  repromptWindowMs: z.number().int().min(60000).default(120000),
  completionMarker: z.string().default('BLOCKER_DIVERTER_DONE!'),
});

export type Config = z.infer<typeof ConfigSchema>;
```

### Blocker Tool Args Schema (hooks/tool.ts)
```typescript
export const BlockerToolSchema = z.object({
  category: z.enum(['permission', 'architecture', 'security', 'destructive', 'question', 'other']),
  question: z.string().min(5),
  context: z.string().min(10),
  blocksProgress: z.boolean(),
  options: z.array(z.string()).optional(),
  chosenOption: z.string().optional(),
  chosenReasoning: z.string().optional(),
});
```

### Command Args (commands/blockers-cmd.ts)
```typescript
export const CommandSubcmdSchema = z.enum(['on', 'off', 'status', 'list', 'clarify', 'export']);
```

## State Operations (state.ts)
- `getState(sessionId: string): SessionState` - Lazy init
- `updateToggle(sessionId: string, divertBlockers: boolean): void`
- `addBlocker(sessionId: string, blocker: Blocker): boolean` - Dedupe check
- `incrementReprompt(sessionId: string): boolean` - Threshold check
- `clearState(sessionId: string): void`
- All ops: Pure (in/out), async wrappers for I/O

## Markdown Format (blockers-file.ts)
```
# Blockers Log - Session {{sessionId}} ({{timestamp}})

## Hard Blockers (blocksProgress=true)
- [ ] **{{category}}**: {{question}}
  Context: {{context}}

## Soft Blockers (blocksProgress=false)
- [ ] **{{category}}**: {{question}} → Chose: {{chosenOption}}
  Reasoning: {{chosenReasoning}}
  Context: {{context}}
```

**Testability**: All models pure/typed → Easy unit tests (Bun:test).