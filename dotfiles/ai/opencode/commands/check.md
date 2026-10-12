---
description: Run the project's build, lint and test checks with real exit codes, fix what the current change broke, and report
agent: build
model: anthropic/claude-sonnet-5-5
---

Run checks and fix failures on Sonnet `build`. Do not commit; do not change test expectations to
make a test pass; do not skip or parallelise tests unless the argument asks for exactly that.

Usage: `/check [command ...]` — e.g. `/check go test ./...`, `/check lint`, or no argument to
detect the project's checks.

## Step 1: Decide what to run

- With explicit arguments, run those commands only (each as an argv array).
- Otherwise detect from the repository root, in this order, and run everything that applies:
  - `go.mod`: `go build ./...`, `go vet ./...`, `go test ./...`; `golangci-lint run` when a
    `.golangci.*` file exists.
  - `package.json` scripts named `lint`, `typecheck`, `check`, `test` (use the repo's package
    manager: `bun.lock` → bun, `pnpm-lock.yaml` → pnpm, else npm).
  - `Makefile` / `Taskfile.yml` targets named `lint`, `test`, `check`.
  - `devenv.nix` scripts or `flake.nix` with `checks` (`nix flake check` only when the user
    asks; it can be slow).
- Say which commands you are about to run and why. Never invent a command that is not in the
  repository.

## Step 2: Run

- Use `validate_command` with `{"argv": [...], "expected_failure": false}` for each command so
  the real exit status is recorded. Use `expected_failure: true` only for a check the user
  explicitly says must fail (negative/mutation test).
- Keep output bounded; quote only the failing lines.

## Step 3: Fix

- For each failure, find the root cause with `repo_grep` and targeted reads. Fix the code or
  test that this branch changed. If the failure predates the branch (`git stash`-free check:
  compare with `git log`/blame evidence), report it instead of fixing it silently.
- Re-run only the failed commands, then the full set once more if anything changed.

## Step 4: Report

- A table: command, exit code, duration if known, status. Then the changed files and any
  failure left unresolved with the reason. Suggest `/commit` when the tree is green and dirty.

## Argument: $ARGUMENTS
