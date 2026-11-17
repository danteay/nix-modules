# Deep architecture comparison

`/arch-compare` compares candidate architectures for one decision and leaves a reviewed local
draft behind. It exists for the question `/new-arch-task` does not answer well: not "how do we
build this" but "which of these approaches should we build, given the code we have, the team
we have and the platform we run on". This document records the design: which role does what,
why the agent is a primary on Fable 5.2, how it is registered in desvio, and what the draft
contains.

## Pieces

| Piece | Path | Role | Model |
|---|---|---|---|
| Comparer | `agents/deep-architect.md` | primary; frames the decision, asks the user, keeps the ledger, models and scores the candidates, writes the draft | Fable 5.2 (`deep`) |
| Entry point | `commands/arch-compare.md` | command on `deep-architect` with `$ARGUMENTS` as the decision, candidates and sources | Fable 5.2 |
| Locator | `agents/explorer.md` | subagent; where things live in a repository | Haiku (bulk) |
| Evidence packs | `agents/bulk-reader.md` | subagent; symbols, callers, tests, invariants, one question per task | Haiku (bulk) |
| Document reader | `agents/inventory-reader.md` | subagent; constraints and decisions inside supplied documents as fixed rows | Haiku (bulk) |
| Classifier | `decide` (existing) | bounded label questions over supplied text | Jev |
| Remote sources | `lucid`, `linear` MCPs and `webfetch` | diagrams, issues, documentation; fetched by the primary, never by workers | none |

## Phases

1. **Frame.** Outcome and acceptance criteria, behavior and constraints (load, latency,
   consistency, failure tolerance, compliance, budget, deadlines), code state, team knowledge,
   maintenance ownership, infrastructure platform and capacity, and the assets the comparison
   should rest on. Anything unclear or missing is asked with the `question` tool, bundled,
   naming the decision each answer affects. Independent gathering continues while an answer
   is pending; a dependent choice is never settled by guessing.
2. **Evidence.** A context ledger: every source with path or link, type, version or retrieval
   time, facts, missing facts and confidence; conflicts recorded separately; inferences and
   user assertions labeled. Repository facts come from `explorer` and `bulk-reader`, document
   facts from `inventory-reader`, remote facts from the MCPs on the primary.
3. **Candidates.** An explicit model per approach (components, boundaries, contracts, data
   flow, failure handling, rollout and rollback), always including the current design when it
   is viable.
4. **Comparison.** The same criteria for every candidate, derived from the frame; concrete
   pros and cons (a consequence and when it lands, not a quality word); edge cases per
   candidate; implications for code state, team knowledge, maintenance and infrastructure.
   Unknown cells stay unknown; figures cite a source.
5. **Recommendation.** One approach when the evidence supports it, with the reasoning chain,
   confidence, assumptions and the conditions that would flip it; otherwise the blocked state
   and the question or measurement that resolves it.
6. **Draft and review.** `architecture-comparison-<slug>.md` is the only file the agent may
   write. Feedback rounds update only what changed and keep the change log.

## Why a primary agent on the deep role

- **Asking is the point.** The agent must interrogate the user for constraints the prompt
  leaves open. Subagents return "questions for the user" for a primary to relay; a primary
  uses the `question` tool directly and keeps the run open. The same reasoning made
  `coordinator` the interactive form of `designer`.
- **One expensive model, no doubling.** Fable 5.2 bills $8/$40 per MTok, twice Opus 5.5. The
  agent is forbidden to dispatch `designer`, `architect` or `coordinator`, and the routing
  instructions forbid dispatching `deep-architect` as a subagent, so a comparison costs one
  reasoning-tier context, not two.
- **Haiku gathers, Jev classifies.** The worker table in the agent mirrors `linear-planner`:
  every broad read or label question goes to a cheap model, and the primary spends its tokens
  on the comparison.
- **Read-only by construction.** `edit` is denied except `*architecture-comparison-*.md`,
  `bash` is denied except `git status|diff|log|branch`, `rg` asks. The comparison is handed to
  `/new-arch-task` or `/new-feat` for planning and execution.

## Registration in desvio

- `lib/routing.ts`: `models.deep` is `vercel/anthropic/claude-fable-5.2`; `agentRoles` maps
  `deep-architect` to `deep`; `modelRole` reports `claude-fable-*` and `claude-mythos-*` as
  `deep`; `isReasoningTier` treats `reasoning` and `deep` alike wherever the plugin guards
  expensive models. The routing instructions name `/arch-compare` as the only route to the role.
- `lib/config.ts`: a `deep-architect` baseline is rejected like `coordinator` unless
  `allow_reasoning_baseline` is set.
- `lib/control.ts`: `deep-architect` is pinnable and the pin expires after one run.
- `lib/lifecycle.ts`: `deep-architect` is a primary agent; `roleRank.deep` is above
  `reasoning`, so a manual selection is an upgrade (honored once when deliberate) and the run
  returns to the baseline on completion.
- `lib/report.ts`: Fable spend counts as reasoning-tier cost in the audit (`reasoning_cost`,
  `cheap_on_reasoning`, reasoning baselines).
- `opencode.json`: the `deep-architect` primary with the same permissions as the agent file.
- `pricing.json`: `vercel/anthropic/claude-fable-5.2` at $8/$40, cache $0.20/$10, verified on
  November 17, 2026.
- `tests/desvio.test.ts` checks that the agent file, the command and `opencode.json` agree with
  the routing policy; `tests/config.test.ts` covers the role, the baseline rejection and the
  pin scope.

## Model choice

Fable 5.2 was chosen over Fable 5.1 because the Vercel gateway exposes both
(`vercel/anthropic/claude-fable-5.1`, `vercel/anthropic/claude-fable-5.2`,
`vercel/anthropic/claude-fable-5.2-fast`) and a one-word probe through `opencode run` with
`DESVIO_MODEL_ROUTING=0 --standalone` answered on `anthropic/claude-fable-5.2` on November 17,
2026. The same probe without the flag was rewritten to V4 Pro by desvio, which is the expected
behavior and the reason the role is reached through the command rather than a manual model
pick. Fable 5.2 is cheaper than 5.1 ($8/$40 versus $10/$50 list). The `-fast` variant was not
chosen: a comparison is latency-tolerant and fast mode doubles the price.

## Limits

- The agent cannot measure anything; scalability and cost findings are reasoned and must say
  so. Figures without a source stay unknown in the matrix.
- Excluded paths (wallet, kyc, aml, payments, payouts, secrets, credentials, key/env files)
  are reasoned from supplied text only.
- A running loop cannot change model; the return to the baseline happens on completion.
- `modelRole` groups Fable and Mythos together under `deep`; the report does not distinguish
  them.
