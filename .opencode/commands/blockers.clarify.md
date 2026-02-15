---
name: blockers.clarify
description: Walk through unresolved blockers one-by-one and clarify each with user input
---

# Clarify Blockers

Here are the current blockers:

!`cat BLOCKERS.md 2>/dev/null || echo "No blockers file found."`

---

{{#if $ARGUMENTS}}
**User instructions:** $ARGUMENTS

(For example: "just the last blocker", "only architecture blockers", "skip the first one")
{{/if}}

For each blocker that does NOT already have a `### User Clarification` section:

1. Show the blocker's **Question** and **Context** to the user.
2. If the blocker has an **Options Considered** section, present those options using the `question` tool and let the user pick (or type their own answer).
3. If there are no options, use the `question` tool with a free-text input asking: "How should we handle this blocker?"
4. Once the user responds, **edit** the blocker entry in @BLOCKERS.md:
   - Add `**Status:** clarified` after the existing metadata fields
   - Add a `### User Clarification` section with the user's decision
5. Move on to the next unresolved blocker.

Repeat until all blockers are clarified (or per user's instructions in $ARGUMENTS).

When no unresolved blockers remain, respond with:

> All blockers have been clarified. You can resume development.

**Rules:**
- Go through blockers **one at a time**, in order (unless user specified otherwise).
- Do NOT skip any unresolved blocker (unless user asked to).
- Do NOT modify the original Question, Context, or Options — only add Status and User Clarification.
- If no blockers found or all are already clarified, say: "No blockers need clarification."
