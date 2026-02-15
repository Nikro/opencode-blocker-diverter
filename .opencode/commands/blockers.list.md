---
name: blockers.list
description: List all recorded blockers for the current session
---

# List Recorded Blockers

Displays a formatted list of all blockers recorded during this session.

Each blocker includes:
- **ID**: Unique blocker identifier
- **Timestamp**: When it was recorded
- **Category**: Type of blocker (permission, architecture, security, etc.)
- **Question**: The original question or permission request
- **Context**: Surrounding context at the time

{{#if $ARGUMENTS}}
**User note:** $ARGUMENTS
{{/if}}

{{#each blockers}}
## Blocker {{@index}}
- **ID**: {{id}}
- **Time**: {{timestamp}}
- **Category**: {{category}}
- **Question**: {{question}}
- **Context**: {{context}}
{{/each}}

{{#if (eq blockers.length 0)}}
No blockers recorded yet in this session.
{{/if}}
