---
description: Commit, sync, push, and open a pull request to a base branch (default main)
agent: bulk
model: opencode/glm-5.3
---

Create a pull request from the current branch. This command supports two workflows and automatically detects which one applies — do NOT ask the user to choose unless detection is inconclusive.

- **Path A — Standalone PR**: the branch is not tracked by `gh stack`. Normal PR against the selected base branch (`main` by default).
- **Path B — Stacked PR**: the branch belongs to a stack managed by `gh stack` (GitHub's official stacked-PR extension — `github/gh-stack`). Each layer gets its own PR, based on the layer below it instead of `main`.

Follow every step in order — do NOT skip any.

## Arguments

Usage: `/new-pr [base-branch] [additional context]`

- Read the first whitespace-separated argument as `BASE_BRANCH`; default to `main` when no argument is provided. For example, `/new-pr develop` targets `develop`, and `/new-pr release/1.2` targets `release/1.2`.
- Treat any remaining arguments as additional context for the commit message and PR description(s). To provide context while using the default base, pass `main` explicitly: `/new-pr main explain the migration`.
- Treat the branch argument as literal data, never shell code. Validate it with `git check-ref-format --branch` and reject names beginning with `-` or containing whitespace before making changes. Quote its value in shell commands and preserve it across command invocations.

## Step 0: Detect which workflow applies

- Run `gh stack view --json` and check its exit code only (don't dump the raw JSON on the user).
  - Exit code `0` → the current branch is part of an existing stack → use **Path B**. If a base branch was explicitly provided, verify it matches the current layer's base from the stack metadata; if it differs, report the mismatch and stop before committing or rebasing. Without an explicit argument, keep the stack's configured bases.
  - Exit code `2` ("not in a stack") → use **Path A**.
  - Any other exit code (e.g. `4` GitHub API failure, `8` stack locked) → report the error and stop. Do not guess or fall back silently.
- Override: if the additional context explicitly requests a "stack" workflow and the branch is untracked (exit code `2`), ask the user to confirm before running `gh stack init` to adopt the current branch into a new stack with `BASE_BRANCH` as its trunk, then proceed with Path B. Never convert a standalone branch into a stack without confirmation.

---

## Path A: Standalone PR (base: BASE_BRANCH)

### Step A1: Commit all remaining changes

- Run `git status` to see uncommitted changes.
- If there are changes, stage all modified/new files and create a commit with a conventional commit message summarizing the work. Use a HEREDOC for the commit message. Include the Co-Authored-By trailer.
- If there are no changes, skip this step.
- IMPORTANT: Do NOT skip git hooks. If a pre-commit hook fails, fix the issue and retry the commit.

### Step A2: Sync with the selected base branch

- Fetch the latest from origin: `git fetch origin "$BASE_BRANCH"`
- Check if there are new commits on `origin/$BASE_BRANCH` that are not in the current branch: `git log "HEAD..origin/$BASE_BRANCH" --oneline`
- If there ARE new commits on `origin/$BASE_BRANCH`:
  - Run `git pull --rebase origin "$BASE_BRANCH"`
  - If there are merge conflicts, resolve them sensibly (prefer keeping both changes when possible, prefer the current branch's intent for feature-specific code).
  - After resolving conflicts, continue the rebase with `git rebase --continue`.
  - Set a flag that rebase happened (you will need this for the push step).
- If there are NO new commits, skip this step.

### Step A3: Push to remote

- First, check whether this is a Go project at all: `test -f go.mod` (repo root; also check `go.work` if used). The `MOD_TIDY` env var only means anything if the pre-push hook actually runs `go mod tidy`, so skip straight to the non-Go case below if there's no `go.mod`.
- If it is NOT a Go project:
  - If rebase happened: `git push --force-with-lease`
  - If no rebase: `git push -u origin HEAD`
- If it IS a Go project, determine if any Go files were modified across ALL commits in this branch (not just the last commit). Check with: `git diff "origin/$BASE_BRANCH...HEAD" --name-only | grep -E '\.go$|go\.(mod|sum)$'`
  - If NO Go files changed, push with `MOD_TIDY=0` to skip the go mod tidy pre-push hook:
    - If rebase happened: `MOD_TIDY=0 git push --force-with-lease`
    - If no rebase: `MOD_TIDY=0 git push -u origin HEAD`
  - If Go files DID change, push normally (let the hook run):
    - If rebase happened: `git push --force-with-lease`
    - If no rebase: `git push -u origin HEAD`
- IMPORTANT: Do NOT skip git hooks on push. If the pre-push hook fails, fix the issue and retry.

### Step A4: Check for existing pull request

- Run `gh pr list --head "$(git branch --show-current)" --base "$BASE_BRANCH" --state open --json number,url` to check if an open PR already exists from the current branch to `BASE_BRANCH`.
- If a PR already exists, skip Step A5 entirely and go straight to Step A6, outputting the existing PR URL.
- If no PR exists, proceed to Step A5.

### Step A5: Create the pull request

- Analyze ALL commits on the branch (from where it diverged from `BASE_BRANCH`) using `git log "origin/$BASE_BRANCH..HEAD"` and `git diff "origin/$BASE_BRANCH...HEAD"` to understand the full scope of changes.
- Create a pull request using `gh pr create` with the EXACT format from `.github/pull_request_template.md`. The body MUST follow this structure precisely — CI checks validate the format:

```
gh pr create --base "$BASE_BRANCH" --title "<short title>" --body "$(cat <<'EOF'
## Description

<1-3 sentence summary of what changed and why>

## Task Context

### What is the current behavior?

<describe behavior before this PR>

### What is the new behavior?

<describe behavior after this PR>

### Additional Context

<any extra context, or "N/A" if none>

## Checklist

### How was it tested?

- [ ] unit
- [ ] local
- [ ] dev
- [ ] integration
- [ ] performance
- [ ] health check
- [ ] other (specify)
- [ ] don't need testing (justify)

---

## Testing Evidence

<describe how changes were verified, or "Pending" if not yet tested>

---

<div>
Draftea Engineering — Building the future of sports betting
<img align="right" src="https://github.com/Drafteame.png" width="20" height="20" alt="Draftea" />
</div>
EOF
)"
```

- Fill in all sections based on the actual changes. Be specific and accurate.
- For the checklist, check the boxes that apply based on what testing was actually done. If only code/config changes with no runtime testing yet, check "don't need testing" with justification or leave unchecked with "Pending" in evidence.
- The PR title should be short (under 70 characters), following conventional commit style.

### Step A6: Output

- Print the pull request URL as the final output so the user can click it.

---

## Path B: Stacked PR (gh stack)

### Step B1: Commit all remaining changes

- Same as Step A1.

### Step B2: Sync the stack

- Run `gh stack rebase` — this fetches `origin`, then cascades a rebase across every branch in the stack, starting from trunk, so each layer replays cleanly on top of the (possibly updated) layer below it.
- If it pauses for a conflict: resolve the conflicted files, `git add` them, then run `gh stack rebase --continue`. Repeat until it finishes.
- If you need to abandon the rebase entirely: `gh stack rebase --abort`.

### Step B3: Push the stack

- Make sure you're on the top of the stack: `gh stack top`.
- Check whether this is a Go project at all: `test -f go.mod` (repo root; also check `go.work` if used). `MOD_TIDY` only means anything if the pre-push hook actually runs `go mod tidy`.
- If it is NOT a Go project: `gh stack push`.
- If it IS a Go project, determine if any Go files changed anywhere in the stack: `git diff origin/main...HEAD --name-only | grep -E '\.go$|go\.(mod|sum)$'` (adjust `origin/main` if the stack's trunk is not `main`).
  - If NO Go files changed, push with the pre-push `go mod tidy` hook disabled: `MOD_TIDY=0 gh stack push`.
  - If Go files DID change, push normally so the hook runs: `gh stack push`.
- IMPORTANT: Do NOT skip git hooks. If the pre-push hook fails on any branch, fix the issue and retry.

### Step B4: Check existing PRs in the stack

- Run `gh stack view --json` and inspect which branches already have an open PR and which don't.
- If every branch in the stack already has a PR, skip Step B5 and go straight to Step B6.
- Otherwise, continue to Step B5 to submit the branches that don't have one yet.

### Step B5: Submit the stack

- Run `gh stack submit --auto` to push, create a PR for every branch that doesn't already have one, and link them together as a Stack on GitHub. `--auto` skips the interactive editor and uses auto-generated titles.
- `gh stack submit` does not accept a custom PR body, so for every PR it just created:
  - Get that branch's PR number and its base branch (the stack layer below it) from `gh stack view --json`.
  - Analyze ONLY that layer's own changes with `git diff <base-branch>...<this-branch>` — NOT against `main`. Each PR in the stack must describe just its own layer, not the whole stack.
  - Update its body with `gh pr edit <number> --body "..."` using the exact same template and structure as Path A Step A5, filled in for that layer's changes only.
  - Leave the auto-generated title unless it's clearly wrong, then fix it with `gh pr edit <number> --title "..."`.
- PRs that already existed before this run need no title/body changes unless their branch had new commits pushed in Step B3.

### Step B6: Output

- Print every PR URL in the stack, from bottom to top: `gh stack view --short` or `gh stack view --json`.

## Argument: $ARGUMENTS

The first argument selects the base branch (default: `main`); remaining arguments provide additional context. See Arguments and Step 0 for stack handling.
