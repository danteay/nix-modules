---
description: Evidence-first production investigation with Datadog and git history; escalates one bounded question to reasoner only if needed
agent: build
model: vercel/anthropic/claude-sonnet-5.5
---

Investigate a symptom with evidence before hypotheses. This runs on Sonnet `build`. Opus is
involved only through a single bounded `reasoner` task, and only when the evidence is in and
the cause is still unresolved.

Usage: `/investigate <symptom> [service] [environment] [time window]` — e.g.
`/investigate websocket publish errors draft-relay prod last 2h`.

## Step 1: Frame

- Extract symptom, service, environment and window from the arguments. If the service or
  window is missing, ask once with the `question` tool; otherwise proceed with explicit
  assumptions stated in the report.
- Record what "normal" is if the user supplied a comparison (e.g. a previous peak).

## Step 2: Collect evidence (primary agent only)

- Datadog MCP: load the relevant skill if available, then query metrics, logs and monitors for
  the window and a baseline window of the same length before it. For each query record:
  metric/query, window, observed value, baseline value, link or query string.
- Repository: `git log --since=<window start> --oneline` on the service, recent tags/releases,
  and configuration diffs that touch the symptom (`repo_grep` for the error strings).
- Keep every number in a table; do not paraphrase measurements.
- Workers have no MCP or shell: do not delegate evidence collection.

## Step 3: Analyse

- List hypotheses ranked by how much of the evidence each explains, with the contradicting
  evidence for each. Distinguish load, dependency, deploy and configuration causes.
- If a correctness or concurrency question remains that the evidence cannot settle, dispatch
  exactly one `reasoner` task containing the evidence tables, the candidate hypotheses and the
  precise question. Execute no remediation on Opus; bring its answer back here.

## Step 4: Report

- Timeline, evidence tables, ranked hypotheses, the one escalated question (if any) and its
  answer, and the next concrete checks or mitigations for the user to decide on. Do not apply
  remediation, restart services or change configuration; propose it.

## Argument: $ARGUMENTS
