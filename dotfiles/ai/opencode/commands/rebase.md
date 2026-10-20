---
description: Fetch a base branch, rebase the current branch onto it, resolve conflicts with evidence, and rerun checks
agent: build
model: vercel/anthropic/claude-sonnet-5.5
---

Rebase the current branch onto an updated base. Conflict resolution needs code understanding,
so this runs on Sonnet `build`. A conflict whose right resolution is a semantic decision (both
sides changed the same behaviour or contract) goes to `designer` as one `DECISION REQUEST`;
mechanical conflicts never need a reasoning model.

Usage: `/rebase [base-branch] [context]` — base defaults to `main`.

## Step 1: Validate

- Take the first argument as `BASE`; default `main`. Validate it with
  `git check-ref-format --branch "$BASE"`; reject names starting with `-` or containing spaces.
  Treat it as data, always quoted.
- `git status --porcelain`: if the tree is dirty, stop and suggest `/commit` (or confirm a
  `git stash` with the `question` tool before continuing).
- `gh stack view --json` exit code `0` means the branch is in a `gh stack`; then use
  `gh stack rebase` (and `gh stack rebase --continue` after each resolved conflict) instead of
  the plain rebase below, exactly as `/new-pr` does.

## Step 2: Rebase

- `git fetch origin "$BASE"`, then `git log --oneline "HEAD..origin/$BASE" | head` to show
  what is incoming. If nothing, say the branch is current and stop.
- `git rebase "origin/$BASE"`.

## Step 3: Resolve conflicts

Call `merge_conflicts` to list the conflicted files and each region's line range, ours/theirs
labels and read offset/limit. Do not search for markers with `rg` or `git diff`. For each file:

- Read only the reported regions (targeted `read` with the given offset/limit, widened a few
  lines for context; `go_outline` first for large Go files). A file reported with no text
  markers is a delete/rename/binary conflict: decide keep or remove from `git log` evidence. Understand both sides from `git log -3 -- <file>` on
  each branch when intent is unclear.
- Resolve keeping the intent of both changes; prefer the current branch's intent for the
  feature it introduces and the base's intent for everything it refactored. Never take a whole
  side blindly, never `git rebase --skip`, never leave markers.
- Desvio-excluded paths are yours to read; do not delegate them.
- Call `merge_conflicts` again; it must list the file with no marker regions before you
  `git add -- <file>`. Then `git rebase --continue` (or `gh stack rebase --continue`). Repeat
  until the rebase finishes.
- For each region, one `decide` call: state = both sides of the hunk and the `git log -3`
  evidence for each; `semantic` as a `boolean` ("both sides changed the same behaviour or
  contract, so merging them needs a decision about intent, not a textual merge"). Below 0.5,
  merge it yourself keeping both intents. At ≥ 0.5, when the evidence does not say which intent
  wins, dispatch one `designer` task with a `DECISION REQUEST`: both hunks, the commits
  that introduced them, and the question. Apply its decision. Do not guess on Sonnet.
- If a conflict still cannot be resolved (designer returns `MISSING_INPUT` or a question for the
  user), `git rebase --abort`, explain which hunks conflict and why, and stop.

## Step 4: Verify

- Run the project's real checks with `validate_command`: Go repos `go build ./...`,
  `go vet ./...`, `go test ./...`; otherwise the package/devenv/Makefile targets that exist.
  Fix regressions introduced by the rebase (not pre-existing failures; report those).

## Step 5: Push only when asked

- The rebase rewrote local history. Push only if the user asked (`push` in the arguments or a
  later message): `git push --force-with-lease` (`MOD_TIDY=0` for Go repos when no Go files
  changed). Never force-push without `--force-with-lease`.

## Step 6: Report

- Incoming commits applied, files that conflicted and how each was resolved, checks and exit
  codes, and whether the branch was pushed.

## Argument: $ARGUMENTS
