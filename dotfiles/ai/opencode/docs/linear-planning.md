# Planning area work into Linear

`/plan-linear-work` turns an area's pending work (tracked backlog plus whatever the user knows
is untracked) into a reviewed set of Linear projects, milestones and issues for one team. This
document records the design: which role does what, why the orchestrator is a primary agent, how
it is registered in desvio, and the plan contract the pieces share.

## Pieces

| Piece | Path | Role | Model |
|---|---|---|---|
| Orchestrator | `agents/linear-planner.md` | primary; resolves the team, reads Linear, keeps the ledger and the draft, validates, publishes | V4 Pro (execution) |
| Modeler | `agents/work-modeler.md` | subagent; groups the inventory into projects, milestones and issues; returns the plan JSON | Opus (reasoning) |
| Entry point | `commands/plan-linear-work.md` | command on `linear-planner` with `$ARGUMENTS` as the entry context | V4 Pro |
| Linear reader | `tools/linear_backlog.ts`, `lib/linear.ts` | compact digests of teams, team context, open issues and shortlisted details from the GraphQL API; read-only | none (deterministic) |
| Document reader | `agents/inventory-reader.md` | subagent; turns supplied notes and plan files into fixed ledger rows | Haiku (bulk) |
| Triage | `tools/work_triage.ts`, `lib/work-triage.ts` | per item: tracked (+ matching issue), fits project / new / standalone, size; builds and batches the Jev questions | Jev |
| Validator | `tools/work_plan_check.ts`, `lib/work-plan.ts` | structural checks and publication order for the plan; fetches `existing` itself when omitted | none (deterministic) |
| Classifier | `decide` (existing) | any further bounded question over text | Jev |

## Phases

1. **Scope.** The team is mandatory. When the entry context does not name it, the planner lists
   the teams through the Linear MCP and asks with the `question` tool before any other read.
   It never infers the team from the repository, the user's email or a previous session.
2. **Context gathering.** Two `linear_backlog` calls (`team`, `issues`) give the Linear state
   as digests; `inventory-reader` extracts rows from supplied documents; `explorer` and
   `bulk-reader` cover repositories. The planner asks once, bundled, for untracked work. The
   result is an inventory ledger: one row per item with source, tracked state, summary,
   dependencies and unknowns. One `work_triage` call labels the untracked rows (tracked and
   matching issue, fits which project or new/standalone, size) and flags anything under 0.6
   confidence for the planner's judgment or a user question. `details` digests are fetched
   only for shortlisted issues.
3. **Modeling.** One `work-modeler` dispatch with a `WORK MODEL REQUEST` (ledger, Linear state,
   constraints, decisions). It returns projects (new or reused), milestones for long projects,
   issues with placement, parent and blockers, the plan JSON, rejected groupings and questions.
   Structural feedback goes back as a `WORK MODEL DELTA`; wording stays on V4 Pro.
4. **Validation.** `work_plan_check` on the plan JSON plus the `existing` records from the
   planner's reads. Errors are fixed before review; warnings are discussed with the user.
5. **Draft and review.** `linear-plan-<team-key>-<date>.md` is the only file the planner may
   write (its `edit` permission denies everything else). Approval is asked with `question`
   on the current draft; an older approval never covers a revision.
6. **Publication.** In the order the check returned: projects, then milestones, then issues
   with parents and blockers first, resolving refs to ids. Every record is read back. Operations
   the MCP lacks are left as manual steps in the draft, never reported as done.

## Modeling rules

- A project needs at least two related items and one recognizable outcome; otherwise the
  items are standalone issues on the team.
- Only long projects (sequential phases, roughly more than eight issues, or work across several
  cycles) get milestones: two to five, named by the deliverable that completes them.
- Every issue has exactly one placement: a project with an optional milestone, or the team.
- Existing issues are reused (`existing_id`) or re-homed, never duplicated.
- No invented estimates, dates, priorities, labels or assignees. The modeler leaves them unset
  and reports the gap; the planner never fills them without a source or a user decision.

## Token budget

The V4 Pro primary pays for every token it reads and writes; the design keeps it on digests,
rows and decisions:

| Step | Without the tools | With the tools |
|---|---|---|
| Open backlog of 150 issues | MCP `list_issues` pages with descriptions, tens of thousands of input tokens, re-read by each paste | `linear_backlog issues`: about 30 tokens per issue, once |
| Team context | `list_projects` + `list_milestones` per project + `list_issue_statuses` | one `linear_backlog team` digest |
| Labels for 40 untracked items | three hand-written Jev questions per item at V4 Pro output prices, or prose | one `work_triage` call with 40 short rows; Jev input-only pricing, 5 batched requests |
| Documents | V4 Pro full reads through the size guard | `inventory-reader` rows, Haiku |
| Duplicate check | the primary re-emits every open title as `existing` | `work_plan_check` fetches `existing` itself |
| Verification after publish | one `get_issue` per record | one `linear_backlog details` call for up to 20 identifiers |

`linear_backlog` and the `existing` fetch need a Linear credential: `LINEAR_API_KEY` in the
service environment (exported by the draftea zsh profile) or the OAuth access token OpenCode
stores in `~/.local/share/opencode/mcp-auth.json` after logging in to the `linear` MCP. The
tools never log the value. Without a credential they say so and the planner falls back to the
narrowest MCP calls, keeping their output out of the draft and worker prompts. Reads use the
API directly; writes stay on the MCP so each mutation is visible and permission-gated.

`work_triage` reports `metadata.decision`, `cost` and `input_tokens`, and the plugin logs any
tool with `decision: true` as a Jev message (previously only `decide`), so the usage report
attributes its cost.

## Why a primary agent and not only a command

Planning is a multi-turn conversation: team resolution, untracked-work questions, several
review rounds. Commands on `build` return to the baseline after their terminal response and the
next free text runs on `build` without the planning prompt. A primary agent keeps the prompt for
as long as it is selected: `lifecycle.classifySelection` honors a selected primary whose role
cost is not above the baseline, and `linear-planner` is an execution-role agent like `build`.
The command exists for the `$ARGUMENTS` entry point; the planner tells the user to keep the
agent selected (or use `/desvio-continue`) for follow-up rounds.

The one caveat follows from desvio's reset rule: the first free-text turn right after the
command's terminal response is classified `stale` (the selector still shows the command's
route) and runs on the baseline. Asking with the `question` tool keeps the command run open and
avoids that; the agent prompt requires it for every approval gate.

## Registration

A new agent must be known to the routing policy or the desvio test fails and the lifecycle
treats the agent as unmanaged:

- `lib/routing.ts` `agentRoles`: `linear-planner` is `execution`, `work-modeler` is `reasoning`,
  `inventory-reader` is `bulk`; `lib/paths.ts` `workerAgents` includes `inventory-reader`.
- `lib/lifecycle.ts` `primaryAgents`: `linear-planner`, so a terminal selection is honored.
- `lib/paths.ts` `reviewAgents`: `work-modeler`, which makes it read-only, limits its nested
  delegation to the cheap workers and keeps the large-file guard on Opus.
- `opencode.json` `agent.linear-planner`: the same model and permissions as the agent file.
- `lib/jev.ts` `mechanicsCommands`: `plan-linear-work`, so a free-text turn that asks to
  organize work into Linear gets the advisory to use the command.

Workers (child sessions) are denied MCP, shell and web tools by the plugin, so `work-modeler`
can only reason over the text the planner sends. That is deliberate: the Linear reads and
writes stay on one agent that the user can audit.

## Plan contract

`work_plan_check` input, also the `## Plan JSON` section of the modeler's answer:

```json
{
  "team": { "id": "…", "key": "PGO", "name": "Platform" },
  "projects": [
    {
      "ref": "billing",
      "name": "Billing v2",
      "long": true,
      "milestones": [
        { "ref": "m_schema", "name": "Schema migrated in staging" },
        { "ref": "m_api", "name": "Endpoints behind a flag" }
      ]
    }
  ],
  "issues": [
    {
      "ref": "schema",
      "title": "Design billing schema",
      "description": "Outcome, context, acceptance criteria, links",
      "project": "billing",
      "milestone": "m_schema",
      "blocked_by": [],
      "source": "ledger row 3"
    },
    { "ref": "runbook", "title": "Write on-call runbook", "parent": "PGO-12" }
  ],
  "existing": {
    "projects": [{ "id": "prj_…", "name": "Billing v2" }],
    "issues": [{ "identifier": "PGO-40", "title": "Design billing schema", "state": "Todo" }]
  }
}
```

Refs are plan-local (`[a-z][a-z0-9_-]*`), unique across projects, milestones and issues.
`parent` and `blocked_by` accept a plan ref or an existing identifier (`PGO-41`). A project or
milestone with `existing_id` is reused, not created; an issue with `existing_id` is updated
(re-homed). The check returns:

- `errors` (must fix): missing team, bad or duplicate refs, unknown project/milestone/parent/
  blocker, milestone outside its project, dependency cycles, duplicate titles inside the plan,
  priority outside 0-4, negative estimate, malformed dates or identifiers.
- `warnings` (discuss): `possible_duplicate` against existing issues or projects (token
  Jaccard similarity at or above 0.6), empty projects or milestones, a single milestone, a long
  project without milestones, an issue without description, a past target date.
- `order`: numbered steps (`project`, `milestone`, `issue`) with `create`, `reuse` or `update`
  and the refs that must have an ID first.

The check never calls Linear. Duplicate detection only sees what the planner passes in
`existing`, so an incomplete read produces an incomplete check; the planner records the
retrieval filters for that reason.

## What this does not do

- `linear_backlog` is read-only by construction: it has no mutation queries, so the planner
  cannot bypass the MCP's permission prompts for writes.
- It does not pick the next task to build (`/next-linear-task`) or edit one issue's fields
  (`/linear-task`).
- It does not design the work itself; an architecture decision inside a planned project is a
  separate `/new-arch-task`.
- It does not delete, archive, close or reassign records, and it does not create cycles,
  labels or teams.
