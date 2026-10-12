---
description: Group uncommitted work into conventional commits, confirm the plan, then commit (push only when asked)
agent: bulk
model: anthropic/claude-haiku-5-5
---

Turn the working tree into well-formed commits. This is utility work on Haiku; it never
decides what the code should do. If a change looks wrong or incomplete, say so and let the user
decide; do not "fix" it here.

Usage: `/commit [context, e.g. "push" or "this is the pitaco db fix"]`

## Step 1: Inspect

- `git status --porcelain` and `git diff --stat`; also `git diff --cached --stat` in case
  something is already staged.
- If nothing is modified, untracked or staged, say so and stop.
- Find the commit convention: a commitizen config (`.cz.toml`, `.cz.yaml`, `cz.json`,
  `pyproject.toml` `[tool.commitizen]`, `package.json` `config.commitizen`) or the repo's
  recent subjects (`git log --oneline -15`). Default to conventional commits
  (`feat|fix|chore|refactor|docs|test|ci|build(scope): subject`).
- Never stage files matching secrets/credentials patterns (`.env`, `*.pem`, `*.p12`,
  `*.tfvars`, `credentials*`); list them separately and leave them untouched.

## Step 2: Propose groups

- Group the changed paths into logical commits (one concern per commit: a feature slice, its
  tests, docs, config). Read diffs with targeted reads only as needed to name them accurately.
- Present the plan: for each group the type/scope/subject, the files, and a one-line body.
  Mention any file you could not classify.
- Use the `question` tool once to confirm the plan or take edits. Do not commit before that.

## Step 3: Commit

- For each confirmed group: `git add -- <files>` then `git commit` with a HEREDOC message
  (subject under 72 chars, optional body) ending with the `Co-Authored-By` trailer used in this
  repository. Do not skip hooks; if a hook fails, report the output and stop.
- Do not amend or rewrite existing commits.

## Step 4: Push only when asked

- Push only if the context says so (`push`). Then `git push -u origin HEAD`, with
  `MOD_TIDY=0` for Go repos when no `.go`/`go.mod`/`go.sum` changed. Otherwise suggest
  `/new-pr` or `git push` and stop.

## Step 5: Report

- Print `git log --oneline -<n>` for the new commits and anything left uncommitted.

## Argument: $ARGUMENTS
