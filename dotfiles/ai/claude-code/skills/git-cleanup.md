# /git-cleanup

Clean up local Git branches that have been merged or deleted remotely.

## Usage

```
/git-cleanup
```

## Description

This skill performs Git repository cleanup:
- Fetches latest changes from remote with prune
- Lists branches that have been merged into main/master
- Offers to delete local branches that no longer exist on remote
- Shows stale branches for review

## Steps

When user invokes this skill:

1. Verify we're in a Git repository
2. Run: `git fetch --prune`
3. Identify current branch
4. List merged branches: `git branch --merged main`
5. List branches with gone remotes: `git branch -vv | grep ': gone]'`
6. Ask user for confirmation before deleting branches
7. Delete confirmed branches: `git branch -d <branch-name>`
8. Report summary of cleaned branches

## Safety

- Never delete the current branch
- Never delete main/master branches
- Always confirm before deletion
- Use `-d` flag to prevent deleting unmerged branches
