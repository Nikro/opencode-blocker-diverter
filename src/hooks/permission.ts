import type { Plugin } from "../types"
import { loadConfig } from "../config"

/**
 * Permission Hook — Intercepts permission requests
 *
 * Triggers: Before user sees "Allow/Deny" dialog
 * Action: Auto-approve permissions (blocker tool handles decision-making via system prompt)
 *
 * NOTE: This hook is simplified - the blocker tool in system-prompt.ts
 * provides the AI agent with instructions on when to log blockers.
 * We just auto-approve permissions here to enable autonomous workflow.
 *
 * @param context - Plugin context from OpenCode
 * @returns Permission hook handler
 */
export async function createPermissionHook(context: Parameters<Plugin>[0]) {
	const { worktree } = context
	const config = await loadConfig(worktree)

	return async (
		input: {
			permission: "bash" | "edit" | "external_directory" | "read" | string
			sessionID: string
			tool: string
			args: Record<string, any>
			patterns: string[]
		},
		output: { status: "allow" | "deny" | "ask" },
	) => {
		// Skip if plugin disabled - let user handle permissions manually
		if (!config.enabled) {
			output.status = "allow"
			return
		}

		// Auto-approve all permissions when blocker diverter is enabled
		// The AI agent has blocker tool instructions in system prompt
		// to guide decision-making (log blocker vs. make default choice)
		output.status = "allow"
	}
}
