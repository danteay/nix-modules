Review and fix all actionable comments on the pull request linked to the current branch. Follow every step in order — do NOT skip any.

## Step 1: Find the active pull request

- Get the current branch name: `git branch --show-current`
- Search for an open PR from this branch: `gh pr list --head "$(git branch --show-current)" --base main --state open --json number,url,title`
- If NO open PR exists, stop and tell the user: "No open pull request found for the current branch."
- Save the PR number for subsequent steps.

## Step 2: Fetch all PR comments

Collect every comment thread on the PR. There are three sources — fetch all three in parallel:

1. **Review comments** (inline code comments): `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate`
2. **Issue comments** (top-level conversation): `gh api repos/{owner}/{repo}/issues/{pr_number}/comments --paginate`
3. **Reviews** (review-level bodies): `gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --paginate`

Parse the owner/repo from: `gh repo view --json nameWithOwner -q .nameWithOwner`

## Step 3: Classify each comment

For every comment, determine its category. Ignore comments authored by bots (e.g. GitHub Actions, codecov, dependabot) and already-resolved threads.

Categories:

| Category | Description | Action |
|----------|-------------|--------|
| **bug** | Reports a bug, broken behavior, or regression introduced by this PR | Fix it |
| **suggestion** | Proposes a code change, improvement, or alternative approach | Evaluate and fix if valid |
| **question** | Asks for clarification but does not request a change | Reply with explanation |
| **nit** | Minor style/naming preference with no functional impact | Evaluate and fix if valid |
| **stale** | References code that has already been changed or no longer applies | Resolve with explanation |
| **invalid** | Misunderstands the code, suggests incorrect behavior, or contradicts project conventions | Reply with explanation |
| **praise** | Positive feedback, approval, or acknowledgment | Skip — no action needed |

For each comment, record:
- Comment ID and URL
- Author
- Category (from table above)
- The file and line it references (if inline)
- A one-line summary of what it asks for
- Your assessment of validity (valid / invalid / stale) with reasoning

## Step 4: Validate comments against the codebase

For every **bug** and **suggestion** comment:

1. Read the file and lines referenced by the comment.
2. Check whether the reported issue actually exists in the current state of the code (the comment may reference code that was already fixed in a later commit).
3. Cross-reference with project conventions in CLAUDE.md — if the suggestion contradicts a documented pattern, it is **invalid**.
4. Verify the suggestion is technically correct — does the proposed change compile, make logical sense, and not introduce new issues?

## Step 5: Handle stale and invalid comments

For each **stale** comment:
- Verify the referenced code no longer exists or the issue is already resolved.
- Reply to the comment thread explaining what changed and why it no longer applies using: `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="<explanation>"`
- For review comments, resolve the thread if possible.

For each **invalid** comment:
- Reply to the comment thread with a clear, respectful explanation of why the suggestion does not apply. Reference the relevant project convention or technical reason.

For each **question** comment:
- Reply with a clear answer based on the code and project context.

## Step 6: Plan fixes for valid comments

Group valid **bug**, **suggestion**, and **nit** comments by file. For each group:

1. List the specific changes needed.
2. Check for conflicts between suggestions (two comments requesting contradictory changes to the same code).
3. Prioritize: bugs first, then suggestions, then nits.
4. Determine the right agent for each fix:
   - **developer** agent: for application code changes (Go, Python, PKL, etc.)
   - **devops** agent: for CI/CD, workflow, infrastructure, or deployment-related changes
   - **tester** agent: for test-related suggestions

Present the plan to the user before proceeding. Wait for confirmation.

## Step 7: Implement fixes

For each planned fix, delegate to the appropriate agent:

- Use the **developer** agent for application code fixes. Provide it with:
  - The file path and line numbers to change
  - The comment's request (verbatim)
  - Your validated assessment of what the correct fix is
  - Any relevant project conventions from CLAUDE.md

- Use the **devops** agent for CI/workflow fixes. Same context as above.

- Use the **tester** agent for test changes.

Run independent fixes in parallel where possible (different files with no dependencies).

After each fix, verify:
- The change addresses the comment's concern
- No new issues were introduced
- The code still follows project conventions

## Step 8: Reply to fixed comments

For each comment that was fixed, reply to the thread confirming the fix:
- Use: `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="Fixed in the latest commit. <brief description of what changed>"`
- For issue comments, reply with: `gh api repos/{owner}/{repo}/issues/{pr_number}/comments -f body="@{author} Addressed your feedback: <brief description>"`

## Step 9: Commit and push

Use the `/new-pr` command to commit all changes and push. The commit message should reference that changes address PR review feedback.

## Step 10: Summary

Print a table summarizing every comment and what was done:

```
| # | Author | Category | Status | Action Taken |
|---|--------|----------|--------|--------------|
| 1 | user1  | bug      | fixed  | Fixed null check in handler.go:42 |
| 2 | user2  | stale    | replied | Code was already refactored in prev commit |
| ...
```

Then print the PR URL.

## Argument: $ARGUMENTS

If provided, use as filter criteria (e.g. "only bugs", "only from @username", "ignore nits").
