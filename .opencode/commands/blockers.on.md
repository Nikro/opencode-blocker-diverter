---
name: blockers.on
description: Enable blocker interception for the current session
---

The Blocker Diverter plugin has been **enabled** for this session. You are now in autonomous mode:

- If you encounter a question that blocks progress (architecture choices, framework selection, security decisions, destructive operations), **log it as a blocker** and continue with other independent tasks.
- For soft questions (naming, formatting, minor choices), **make a reasonable default choice** following project conventions and note your decision.
- Do NOT ask the user for permission or clarification on blocked items — just log and move on.

{{#if $ARGUMENTS}}
**User note:** $ARGUMENTS
{{/if}}

Respond with: "Done."
