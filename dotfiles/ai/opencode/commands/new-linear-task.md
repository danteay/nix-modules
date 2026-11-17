---
description: Create and register a single new Linear task, inferring team, project, milestone, theme and DORA-metric labels, then confirming once before writing
agent: bulk
model: vercel/anthropic/claude-haiku-5.5
---

Create one new Linear issue from the user's description for $ARGUMENTS

Usage: `/new-linear-task <description> [team <name|key>]` — e.g.
`/new-linear-task add idempotency keys to the create-bet round use case team PGO`.

This is Linear bookkeeping on Haiku `bulk`: it creates a task, it never designs the work (use
`/new-arch-task` for that) and never implements anything. All judgment — which project, milestone,
theme and DORA metric fit the task — goes to the `decide` tool (Jev), not prose reasoning. If a
design or correctness decision is needed, stop and tell the user which V4 Pro command sends it to
`designer` (`/new-feat`, `/new-arch-task`). This command does not edit existing issues
(`/linear-task`) or plan a whole area (`/plan-linear-work`).

Discover the exact `linear` MCP tool names and schemas before the first write. Expected names:
`list_teams`, `list_issue_labels`, `save_issue_label`, `save_issue` — and `linear_backlog` (the
compact read tool) for team context and open-issue digests. Writes go only through the MCP.

## Step 1: Resolve the team and the task

- Take the task description from `$ARGUMENTS`; keep the user's wording for the title and body.
- Infer the team from the arguments (a key, name or URL named in the prompt). If absent or
  ambiguous, read `linear_backlog kind=teams`, pick the team the task clearly belongs to, and
  otherwise ask once with `question`. Do not infer a team from the checkout alone.
- If the user wants the task in a named project or team, honor it; do not silently move it.

## Step 2: Read the team context

- `linear_backlog kind=team <KEY>` for states, labels, the active cycle, and open projects with
  their milestone ids and target dates.
- `linear_backlog kind=issues <KEY>` for the open issues and their labels (used for theme
  inference and a duplicate check). Record retrieval time.

## Step 3: Infer placement

- Call `decide` with `state` = the task description plus the one-line-per-project digest, asking
  one `choice` question: which open project the task belongs to (offering every open project and
  a `standalone` option). Refer to `state`; leave missing evidence uncertain.
- If the chosen project has milestones, ask a second `choice` over its milestones plus `none`.
- Treat confidence below 0.6 as unresolved: apply your judgment or ask the user; never average
  uncertainty away. Do not invent a project, milestone, priority, estimate or assignee.

## Step 4: Infer the theme

- A theme is a `theme:<name>` label. Candidates are existing `theme:*` labels plus the dominant
  labels of recently-updated in-progress issues from Step 2.
- Call `decide` (one `choice`) to pick the best-fitting existing theme, with `none` as an option.
- If nothing fits, propose a new `theme:<lowercase-slug>` label (2–4 words, a recognizable
  outcome topic) and create it with `save_issue_label` scoped to the team, before the issue.

## Step 5: Apply the DORA-metric labels

- The five DORA software-delivery metrics are fixed labels:
  `dora:deployment-frequency`, `dora:lead-time-for-changes`,
  `dora:change-failure-rate`, `dora:failed-deployment-recovery-time`,
  `dora:deployment-rework-rate`.
- Ensure they exist workspace-wide (they are an org measurement): `list_issue_labels` without a
  team, and `save_issue_label` (no `teamId`, with a short description) for any missing. This is
  idempotent across runs.
- Call `decide` (one `choice`) to select which metric(s) this task feeds, defaulting to one
  primary label; apply only what the task actually advances.

## Step 6: Draft and confirm

- Show a field-by-field table: title, description (outcome, context, acceptance criteria),
  team, project, milestone (or `—`), theme label, DORA label(s), state (from the team's real
  states). Leave priority, estimate and assignee unset unless the user supplied them.
- `question` once to confirm or amend. Do not write before confirmation.

## Step 7: Apply

- Create any new labels first (`save_issue_label`), then the issue with `save_issue` (team,
  title, description, project, milestone, `addLabels` for the theme and DORA labels).
- One MCP call per record. On an error, report it verbatim and stop; never retry blindly, and
  never delete, archive, close or reassign records.

## Step 8: Report

- The created issue's identifier and URL, its placement and labels, plus any label that could
  not be created. Suggest `/next-linear-task` to pick what to build next.

## Argument: $ARGUMENTS
