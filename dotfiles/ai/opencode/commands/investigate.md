---
description: Evidence-first production investigation with Datadog and git history; sends the root-cause decision to designer as a bounded DECISION REQUEST
agent: build
model: vercel/anthropic/claude-sonnet-5.5
---

Investigate a symptom with evidence before hypotheses. This runs on Sonnet `build`: Sonnet
collects, Opus decides. Once the evidence is in, the root-cause decision goes to `designer` as
one bounded `DECISION REQUEST`; Sonnet does not rank hypotheses into a conclusion on its own.

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

- List the candidate hypotheses with the evidence for and against each. Distinguish load,
  dependency, deploy and configuration causes. Do not conclude.
- Score them with one `decide` call: state = the evidence tables and the candidate list;
  `cause` as a `choice` over the candidates (plus `other: null`), and `evidence_sufficient` as a
  `boolean` ("the evidence in `state` proves the cause outright, without further analysis").
  Record the probabilities in the report.
- Dispatch exactly one `designer` task with a `DECISION REQUEST`: the evidence tables, the
  candidates with Jev's probabilities, what was already ruled out, and the precise question
  (root cause, or the correctness/concurrency question the evidence leaves open). Skip it only
  when `evidence_sufficient` ≥ 0.9 and the `cause` confidence ≥ 0.9; say so. Execute no
  remediation on Opus; bring its decision and checklist back here.

## Step 4: Report

- Timeline, evidence tables, candidate hypotheses, the designer's decision with its reasoning, and the next concrete checks or mitigations for the user to decide on. Do not apply
  remediation, restart services or change configuration; propose it.

## Argument: $ARGUMENTS
