---
description: Triage unresolved PR review comments, verify claimed errors, fix what is valid, push, and reply on each thread
agent: build
model: vercel/anthropic/claude-sonnet-5.5
---

Work through the unresolved review threads of a pull request. This runs on Sonnet `build`;
thinking work goes to `designer` (Opus) as bounded requests with the evidence attached: a
`DECISION REQUEST` per disputed correctness or security claim, a `DESIGN DELTA` when a thread
asks for a structural or contract change. Never do the triage itself on a reasoning model.

Usage: `/fix-pr-comments [pr-number-or-url] [extra context]`

## Step 1: Resolve the pull request

- Take the first argument as the PR number or URL; otherwise use the PR of the current branch
  (`gh pr view --json number,url,headRefName,baseRefName,title`).
- Confirm the checked-out branch is the PR head (`git branch --show-current`). If it is not,
  stop and tell the user which branch to check out; do not switch branches yourself.
- Run `git status`. If there are uncommitted changes, stop and suggest `/commit` first so the
  fixes below land in their own commits.

## Step 2: Collect the threads

- Call `pr_unresolved_comments` with `includeDiffHunk: true`. If it returns no unresolved
  threads, say so and stop.
- Number the threads exactly as the tool does; use those numbers in every later message.

## Step 3: Triage each thread with evidence

Classify every thread with `decide` (Jev), one call per thread dispatched in the same turn:
state = the thread text, its diff hunk and the current code region (targeted read);
questions = `class` as a `choice` over `error` (reviewer claims incorrect behaviour),
`suggestion` (style, naming, structure, optional improvement), `question` (needs an answer, not
a change), `already_addressed` (the current code no longer matches the hunk), `out_of_scope`;
`claim_valid` as a `boolean` ("the reviewer's claim holds against the current code in `state`");
`structural` as a `boolean` ("asks for a new boundary, interface, contract, data shape or error
contract rather than a local fix"). Use the class at confidence ≥ 0.6; otherwise classify it
yourself. `claim_valid` ≥ 0.85 or ≤ 0.15 settles an `error`; anything between is `unclear`.

- For every `error`, verify the claim against the current code: `repo_grep` for the symbols,
  then a targeted `read` of the relevant region (respect the Desvio size guard; use
  `go_outline` for large Go files). Record the evidence (`file:line`) and a verdict:
  valid / invalid / unclear.
- For every `error` still `unclear` after evidence gathering that concerns correctness,
  concurrency or security, dispatch one `designer` task per thread with a `DECISION REQUEST`:
  the thread text, the diff hunk, the gathered evidence and the specific question. Execute its
  checklist here. For a `suggestion` that asks for a structural or contract change (new
  boundary, interface, data shape, error contract), dispatch `designer` with a `DESIGN DELTA`
  carrying the thread, the current design evidence and constraints, and implement its slices
  or reply with its reasoning. Do not send style nits, questions or already-decided threads to
  `designer`; never decide an unclear claim on Sonnet.
- Present a compact table: `#`, `file:line`, class, verdict, planned action (fix / reply only /
  skip), one-line rationale.

## Step 4: Confirm before changing anything

- Use the `question` tool once: which threads to fix and whether to post replies. Replies are
  public comments under the user's GitHub account; never post without this confirmation.
- Respect the answer literally. "All" means every thread marked fix / reply.

## Step 5: Fix

- Apply each approved fix directly when it is small; dispatch a substantial slice to
  `feature-builder` with the exact files, the thread text and acceptance criteria. Keep
  Desvio-excluded paths with this agent.
- Run the project's sourced checks with `validate_command` (`go build ./...`, `go test ./...`,
  or the package/devenv scripts actually present). Fix failures caused by the change; never
  mark a check as passed without its real exit status.
- Commit per logical group with a conventional message and the `Co-Authored-By` trailer; do
  not amend published commits. Do not skip hooks.
- Push: `git push` (Go repos: `MOD_TIDY=0 git push` when no `.go`/`go.mod`/`go.sum` file
  changed in these commits). Use `--force-with-lease` only if a rebase was unavoidable.

## Step 6: Reply on each addressed thread

- For every fixed thread call `pr_reply_comment` with the thread's comment URL and a short
  reply: what changed, the commit SHA, and any caveat. For `invalid` errors or declined
  suggestions, reply with the evidence-backed reason only if the user approved replying.
- Do not resolve threads; the reviewer resolves them.

## Step 7: Report

- List threads fixed (with commit SHAs), replied-only, skipped, and any still unclear. Note
  any check that failed or could not run. Print the PR URL last.

## Argument: $ARGUMENTS
