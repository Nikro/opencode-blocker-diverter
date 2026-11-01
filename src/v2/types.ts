/**
 * Structural subset of the OpenCode 2.x plugin context (`@opencode/plugin`).
 *
 * Declared locally so the runtime never imports v2 packages and the plugin needs no
 * v2 dependency. Only the members used by `setupV2` are listed. Shapes follow
 * OpenCode v2.2.5 (`packages/plugin/src/promise/*.ts`).
 *
 * @module v2/types
 */

export type V2Delivery = 'steer' | 'queue'

export interface V2TextPart {
  type: 'text'
  text: string
  metadata?: Record<string, unknown>
}

export interface V2ToolDefinition {
  name: string
  description: string
  /** JSON Schema describing the tool input */
  input: Record<string, unknown>
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content: string }>
}

export interface V2ExecuteBeforeEvent {
  tool: string
  sessionID: string
  agent: string
  messageID: string
  id: string
  input: unknown
}

export interface V2PermissionEvaluation {
  readonly sessionID: string
  readonly action: string
  readonly metadata?: Record<string, unknown>
  effect: 'allow' | 'ask' | 'deny'
}

export interface V2PromptEvent {
  readonly sessionID: string
  readonly messageID: string
  readonly prompt: { text: string }
  readonly delivery: V2Delivery
}

export interface V2ContextEvent {
  readonly sessionID: string
  system: V2TextPart[]
}

export interface V2CommandInvocation {
  readonly sessionID: string
  readonly prompt: { text: string }
  readonly delivery: V2Delivery
}

export interface V2CommandDefinition {
  name: string
  description?: string
  execute: (input: V2CommandInvocation) => Promise<void>
}

export interface V2EventEnvelope {
  readonly type: string
  readonly data: Record<string, unknown>
}

type Callback<E> = (event: E) => void | Promise<void>

export interface V2Context {
  readonly options: Readonly<Record<string, unknown>>
  readonly location: {
    readonly directory: string
    readonly project: { readonly directory: string }
  }
  readonly tool: {
    transform(callback: (editor: { add(tool: V2ToolDefinition): void }) => void): Promise<unknown>
    hook(name: 'execute.before', callback: Callback<V2ExecuteBeforeEvent>): Promise<unknown>
  }
  readonly permission: {
    hook(name: 'evaluate', callback: Callback<V2PermissionEvaluation>): Promise<unknown>
  }
  readonly session: {
    hook(name: 'prompt', callback: Callback<V2PromptEvent>): Promise<unknown>
    hook(name: 'context', callback: Callback<V2ContextEvent>): Promise<unknown>
    hook(name: 'compaction', callback: Callback<V2ContextEvent>): Promise<unknown>
    prompt(input: { sessionID: string; text: string; delivery?: V2Delivery }): Promise<unknown>
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>
  }
  readonly command: {
    transform(callback: (editor: { add(command: V2CommandDefinition): void }) => void): Promise<unknown>
  }
  readonly event: {
    subscribe(options: {
      readonly types?: readonly string[]
      readonly signal?: AbortSignal
    }): AsyncIterable<V2EventEnvelope>
  }
}

export type V2Cleanup = () => Promise<void> | void
