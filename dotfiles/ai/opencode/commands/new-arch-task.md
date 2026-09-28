---
description: Analyze diagrams and documentation, design architecture work, and prepare a reviewed Linear task
agent: build
model: anthropic/claude-sonnet-5
---

Plan an architecture or work-planning task for: $ARGUMENTS

You are the primary coordinator. This workflow produces a sourced architecture decision and a
Linear-ready task, not an implementation. Keep the current phase, evidence gaps, and next review
point visible. The command authorizes read-only investigation and a local planning draft. Do not
change application code, diagrams, source documentation, or Linear records as part of
investigation.
Publish or reconcile Linear work only after the user reviews and explicitly approves the current
draft and its proposed Linear changes. Approval of an older draft does not approve a revision.

## 1. Context gathering

- Extract the requested outcome, scope, and every supplied reference: Lucid diagram links or IDs,
  local files, remote documentation, repositories, Linear issues/projects, and named people or
  teams. Identify whether the user asked to **create** work, **reconcile** existing work, or both.
  Do not treat the existence of a Linear link as permission to edit that issue.
- Read supplied sources before choosing a design. Use the configured `lucid` MCP for Lucid
  diagrams and `linear` MCP for Linear records; discover available tools and use their actual
  names and schemas. The primary agent handles MCP and remote sources. If a tool is unavailable,
  record the failure and ask for an export, URL, or pasted content. Never invent inaccessible
  diagram shapes, document claims, or Linear state.
- For each diagram, capture its URL/ID, title, available version or update time, pages, legend,
  swimlanes, actors, systems, labeled nodes and connectors, direction, decisions, error paths,
  and annotations relevant to the request. Describe the flow in sequence and cite node or page
  identifiers when available. Distinguish an explicit connector from an inferred relationship.
  If the MCP exposes only a rendered image, inspect it and mark unreadable labels or uncertain
  edges; ask for a clearer export when an uncertain element changes the architecture.
- Read named local and remote documents, including linked documents needed to understand the
  described flow. For technology behavior, consult current official maintainer documentation
  when available and record the version and access date. Separate external product facts from
  this project's requirements. For large repository files, use Desvio's `bulk-reader` for broad
  questions with exact eligible paths; use targeted reads for narrow questions. Keep excluded
  paths with the primary agent.
- Read the explicitly supplied Linear issue, project, and relevant parent/child or dependency
  records. Search nearby current work only as needed to identify overlap, blockers, owners, or
  duplicates, and state the search scope. Record issue IDs, titles, states, assignees, links,
  relationships, and update times; do not assume a status means work is complete.
- Build a **context ledger** before proposing a solution. For every source record its link/path,
  type, version or retrieval time, relevant facts, missing facts, and confidence. Record conflicts
  between a diagram, document, repository, and Linear separately. Label every inference and
  user-provided assertion. A diagram is evidence of a depicted design, not proof of deployed
  behavior.
- Check whether the goal, current flow, desired outcome, ownership, constraints, and success
  criteria are clear enough to reason about. Ask focused questions for missing context and say
  which decision each answer affects. Continue independent reading while waiting; do not settle
  a dependent design choice by guessing. If no source was supplied, request a reference or
  explicit permission to infer a starting context. If a named source is inaccessible, request a
  usable replacement rather than inferring its contents.

## 2. Reasoning

- The Sonnet coordinator owns source retrieval, ledger maintenance, drafting and publication.
  Send the compiled ledger, constraints, alternatives and one unresolved architecture decision
  to `architect` with a `FEATURE ANALYSIS` prompt. Opus owns that difficult decision. Reuse its
  recommendation and evidence while drafting; request another pass only when material evidence
  or constraints change. Keep routine task wording and field updates on Sonnet.

- Start from the context ledger. Write a concise **problem frame**: the decision to make, why
  now, stakeholders, boundaries, and what is known versus unknown. Reconstruct the current flow
  and the desired flow as ordered steps, citing diagrams and documents at each material step.
  Identify handoffs, data/contracts, failure paths, and ownership where relevant.
- Identify mismatches among sources and current work. For each mismatch state the competing
  claims, their evidence and freshness, the impact on the task, and the question or check that
  could resolve it. Never silently promote the newest source to truth.
- Generate viable options, including keeping the current design when appropriate. Evaluate
  each against the sourced constraints: boundaries, interfaces, operational behavior,
  reliability, security/privacy, scaling, migration, dependencies, cost, and reversibility as
  applicable. State tradeoffs and rejected options with reasons. Do not turn an unsupported
  preference into a requirement.
- Recommend one approach only when the evidence supports it. Show the reasoning chain from
  sources to constraints to choice, with assumptions, confidence, risks, and open decisions.
  If a missing answer could change the recommendation, mark the decision blocked and seek that
  answer before writing a definitive task. Check the architect's claims against the ledger;
  do not commission a duplicate architecture review of the same decision. Do not pass it MCP
  access it does not have.
- Before drafting, run a **reasoning review**: can a reader trace each important claim to a
  source, understand the depicted versus actual state, see why the chosen approach wins, and
  identify unresolved decisions? Revise the analysis or ask for missing evidence if not.

## 3. Work plan and Linear draft

- Produce a concrete architecture work plan with objective, scope and exclusions, affected
  flows/systems, decisions to make, deliverables, dependencies, sequencing, owners only when
  sourced or confirmed, verification, risks, and rollout or rollback where applicable. Split
  work into multiple Linear issues only when parts have independently reviewable outcomes or
  different owners/dependencies. Do not invent estimates, deadlines, teams, or priority.
- Draft the exact proposed Linear title and description. Include: problem and current flow;
  target outcome; architecture decision and rationale; scope; source links (especially diagram
  page/element references); ordered work and dependencies; observable acceptance criteria;
  review checkpoints; assumptions and open questions. Keep implementation details at the level
  needed for planning. State the intended team/project, parent, labels, assignee, priority, and
  relationships only when supported by the source or user direction; otherwise leave them open.
- If reconciliation was requested, prepare a field-by-field comparison of existing Linear work
  against the sourced plan: keep, update, create, link, close, or leave unresolved, with a reason
  for each proposed action. Preserve accepted decisions, useful history, and unrelated fields.
  Do not silently overwrite a different person's edits, close an issue based only on a diagram,
  or duplicate an already tracked outcome.
- Place review checkpoints at consequential boundaries: agreement on current/target flow and
  system ownership; contracts or cross-team handoffs; security/privacy or operational risks;
  migration/cutover; and acceptance of the final deliverable. Omit checkpoints that do not
  apply. For each checkpoint name the artifact, reviewer or role if known, decision required,
  and evidence needed to pass. Add a checkpoint before execution for any unresolved decision
  that changes scope or architecture.

## 4. Review draft

- Write or update `architecture-task-<slug>.md` in the current workspace or supplied project
  root. The slug must be filesystem-safe. The file contains the context ledger; current and
  desired flow; conflicts; reasoning/options/decision; work plan; exact Linear draft; proposed
  reconciliation actions, if any; review checkpoints; open questions; status `Awaiting review`;
  and a feedback/change log. Preserve prior feedback when revising the file. This local draft
  is the only write before approval.
- Show the user the file path and a compact summary of the decision, task shape, unresolved
  questions, and proposed Linear actions. Ask for corrections or explicit approval of the
  current draft. Stop before any Linear mutation. If a blocking decision remains, seek that
  answer before requesting publication approval.

## 5. Feedback and publication

- Incorporate each feedback round and new source into the ledger and reasoning, then update
  the draft and change log. Repeat the applicable review checkpoint. If the recommendation or
  proposed Linear actions change materially, request approval of the revised draft.
- After explicit approval, re-read each target Linear record through its MCP before writing.
  If relevant state changed since the draft, reconcile the difference in the local draft and
  request review again. Check for an existing matching issue to avoid duplicates.
- Use the `linear` MCP to perform only the approved create/update/link actions. If the MCP lacks
  a required operation, report the blocked action and leave the draft ready for manual use.
  Read back changed records, verify title, description, links and relationships, and record
  their issue IDs/URLs and any partial failure in the local draft. Update the draft's status to
  reflect the verified result. Never report an action as complete merely because the MCP call
  was attempted.
- Finish with the reviewed decision, created or updated Linear links, remaining open decisions,
  and the local draft path. Do not start implementation from this command.
