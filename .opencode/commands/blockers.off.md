---
name: blockers.off
description: Disable blocker interception for the current session
---

The Blocker Diverter plugin has been **disabled** for this session. You are back in normal interactive mode:

- Ask the user for clarification when you encounter blocking questions.
- Do NOT auto-resolve decisions — wait for user input on ambiguous choices.

{{#if $ARGUMENTS}}
**User note:** $ARGUMENTS
{{/if}}

Respond with: "Done."
