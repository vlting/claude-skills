# git

Commit and push with confirmation.

## Invocation

```
/git
```

## Behavior

1. Run `git status`, `git diff --staged`, and `git diff` to understand what needs committing
2. Check if we're in a worktree: `git rev-parse --git-common-dir` vs `git rev-parse --git-dir`
3. Determine the target:
   - **Normal repo:** current branch name
   - **Worktree:** worktree path, worktree branch, and the branch it would merge into (the branch checked out in the main working tree)

4. **Ask for confirmation** via `AskUserQuestion` before doing anything:
   - Show branch name
   - If worktree: show worktree path + merge target branch
   - Show a summary of what will be committed (files changed)

5. On approval:
   - `git fetch origin {branch}` and `git rebase origin/{branch}`
   - If rebase conflicts → stop, report conflicts, do NOT continue
   - Stage changes, commit (conventional commit), push
   - If worktree: merge onto the target branch, push, clean up worktree

## Rules

- Never commit or push without explicit user approval
- Always use conventional commits
- End commit message with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
