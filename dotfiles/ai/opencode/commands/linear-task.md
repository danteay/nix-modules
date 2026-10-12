---
description: Read a Linear issue and apply requested updates (subtasks, description, state, labels) after a field-by-field confirmation
agent: bulk
model: opencode/glm-5.3
---

Linear bookkeeping on GLM through the configured Linear MCP server. This command edits task
metadata from the user's instructions; it never designs the work (use `/new-arch-task` for
that) and never implements anything.

Usage: `/linear-task <issue id or URL> <instructions>` — e.g.
`/linear-task PGO-41 add subtasks for migration, rollback script and runbook`.

## Step 1: Read

- Parse the issue identifier (`[A-Z]+-[0-9]+`) or URL from the first argument. If missing,
  ask for it and stop.
- Fetch the issue with the Linear MCP (`linear_get_issue`): title, description, state,
  labels, assignee, parent, children. For subtask work also list existing children so nothing
  is duplicated.
- Show a short summary of the current state.

## Step 2: Draft the change

- From the instructions, produce the exact proposed changes as a field-by-field table:
  field, current value, proposed value. For new subtasks: title, one-paragraph description,
  parent, suggested state. Keep the user's wording; do not invent scope, estimates or
  assignees.
- Use the `question` tool once to confirm or amend the draft. Do not write before that.

## Step 3: Apply

- Apply only the confirmed changes with `linear_save_issue` (one call per issue/subtask).
  Never delete or archive issues, never change assignees or projects unless the instruction
  says so explicitly.
- If an MCP call fails, report the error verbatim and stop; do not retry blindly.

## Step 4: Report

- List each created/updated issue with its identifier and URL, and anything not applied.

## Argument: $ARGUMENTS
