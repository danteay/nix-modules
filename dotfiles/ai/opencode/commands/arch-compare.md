---
description: Deep comparison of architecture options on Fable 5.2 — pros, cons, edge cases and the code, team, maintenance and infrastructure implications; asks for missing constraints and writes a reviewed local draft
agent: deep-architect
model: vercel/anthropic/claude-fable-5.2
---

Compare architecture options for: $ARGUMENTS

Usage:
- `/arch-compare <decision> [candidates] [sources]` — the decision in free text, the candidate
  approaches if already known, and any file paths, Lucid or Linear links, documents, RFCs or
  decisions already taken.
- `/arch-compare <decision>` without candidates — you propose the viable candidates, including
  keeping the current design, before comparing.

Follow your phases in order: Frame (outcome, acceptance criteria, behavior and constraints,
code state, team knowledge, maintenance and infrastructure context, assets; ask with the
`question` tool for whatever is unclear or missing), Evidence (context ledger from supplied
sources through the MCPs and Haiku workers, one question per task), Candidates (an explicit
model per approach), Comparison (same criteria for every candidate; concrete pros, cons and
edge cases; implications per candidate), Recommendation (one approach when the evidence
supports it, otherwise the blocked state and the question that unblocks it), Draft and review
(`architecture-comparison-<slug>.md`, feedback with the `question` tool).

This command authorizes read-only investigation and the local draft. It never implements,
runs checks, or writes to Linear, Lucid or application code; the draft's `## Next step` names
the `/new-arch-task` or `/new-feat` invocation that carries the decision forward.

For later feedback rounds on the same comparison, keep `deep-architect` selected as the agent
(or use `/desvio-continue`) so the conversation stays on this role instead of returning to
`build`. Fable 5.2 bills $8/$40 per MTok; keep follow-ups to what changes the comparison.
