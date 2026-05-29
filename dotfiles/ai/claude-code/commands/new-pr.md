Create a pull request from the current branch to main. Follow every step in order — do NOT skip any.

## Step 1: Commit all remaining changes

- Run `git status` to see uncommitted changes.
- If there are changes, stage all modified/new files and create a commit with a conventional commit message summarizing the work. Use a HEREDOC for the commit message. Include the Co-Authored-By trailer.
- If there are no changes, skip this step.
- IMPORTANT: Do NOT skip git hooks. If a pre-commit hook fails, fix the issue and retry the commit.

## Step 2: Sync with main

- Fetch the latest from origin: `git fetch origin main`
- Check if there are new commits on `origin/main` that are not in the current branch: `git log HEAD..origin/main --oneline`
- If there ARE new commits on origin/main:
  - Run `git pull --rebase origin main`
  - If there are merge conflicts, resolve them sensibly (prefer keeping both changes when possible, prefer the current branch's intent for feature-specific code).
  - After resolving conflicts, continue the rebase with `git rebase --continue`.
  - Set a flag that rebase happened (you will need this for the push step).
- If there are NO new commits, skip this step.

## Step 3: Push to remote

- First, determine if any Go files were modified across ALL commits in this branch (not just the last commit). Check with: `git diff origin/main...HEAD --name-only | grep -E '\.go$|go\.(mod|sum)$'`
- If NO Go files changed, push with `MOD_TIDY=0` to skip the go mod tidy pre-push hook:
  - If rebase happened: `MOD_TIDY=0 git push --force-with-lease`
  - If no rebase: `MOD_TIDY=0 git push -u origin HEAD`
- If Go files DID change, push normally (let the hook run):
  - If rebase happened: `git push --force-with-lease`
  - If no rebase: `git push -u origin HEAD`
- IMPORTANT: Do NOT skip git hooks on push. If the pre-push hook fails, fix the issue and retry.

## Step 4: Check for existing pull request

- Run `gh pr list --head "$(git branch --show-current)" --base main --state open --json number,url` to check if an open PR already exists from the current branch to main.
- If a PR already exists, skip Step 5 entirely and go straight to Step 6, outputting the existing PR URL.
- If no PR exists, proceed to Step 5.

## Step 5: Create the pull request

- Analyze ALL commits on the branch (from where it diverged from main) using `git log origin/main..HEAD` and `git diff origin/main...HEAD` to understand the full scope of changes.
- Create a pull request using `gh pr create` with the EXACT format from `.github/pull_request_template.md`. The body MUST follow this structure precisely — CI checks validate the format:

```
gh pr create --title "<short title>" --body "$(cat <<'EOF'
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

## Step 6: Output

- Print the pull request URL as the final output so the user can click it.

## Argument: $ARGUMENTS

If provided, use this as additional context for the commit message and PR description.
