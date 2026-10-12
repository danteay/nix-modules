---
description: Triage unresolved PR review comments, verify claimed errors, fix what is valid, push, and reply on each thread
agent: build
model: anthropic/claude-sonnet-5-5
---

Work through the unresolved review threads of a pull request. This runs on Sonnet `build`;
escalate at most one disputed correctness or security claim to `reasoner` (Opus) as a bounded
task with the evidence attached. Never do the triage itself on a reasoning model.

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

Classify every thread as one of: `error` (reviewer claims incorrect behaviour), `suggestion`
(style, naming, structure, optional improvement), `question` (needs an answer, not a change),
`already-addressed` (the current code no longer matches the hunk), `out-of-scope`.

- For every `error`, verify the claim against the current code: `repo_grep` for the symbols,
  then a targeted `read` of the relevant region (respect the Desvio size guard; use
  `go_outline` for large Go files). Record the evidence (`file:line`) and a verdict:
  valid / invalid / unclear.
- If exactly one `error` remains `unclear` after evidence gathering and it concerns
  correctness, concurrency or security, dispatch one `reasoner` task with the thread text, the
  diff hunk, the gathered evidence and the specific question. Execute its answer here. Do not
  send suggestions, questions or already-decided threads to `reasoner`.
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
