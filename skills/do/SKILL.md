---
name: do
description: "Run a task in an isolated worktree, present the diff for approval, then merge back. Lightweight alternative to /q for small, single-unit work."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Do

Run a single task in an isolated worktree. Review the diff. Merge or discard.

```
/do <instructions>        — execute task in worktree, confirm, merge
/do <instructions> --yolo — skip confirmation, auto-merge on success
```

No queue files. No relay. No drain loop. Just: isolate → execute → confirm → merge.

---

## When to use `/do` vs `/q`

| | `/do` | `/q` |
|---|---|---|
| **Tasks** | 1 | 1–N parallel |
| **Overhead** | Near zero | Queue files, relay, drain |
| **Use when** | Small, clear scope | Multi-task or needs file-disjoint parallelism |

---

## Execution

### Step 1: VALIDATE

- If no instructions provided → `AskUserQuestion`: "What should I do?"
- Record the current branch: `git rev-parse --abbrev-ref HEAD` → `$ORIGIN_BRANCH`

### Step 2: EXECUTE

Spawn a single Agent:

```
Agent(
  prompt: <see worker prompt below>,
  isolation: "worktree",
  mode: "bypassPermissions",
  description: "do: <first 5 words of instructions>"
)
```

**Worker prompt:**

```
You are a worker. Execute this task completely:

{instructions}

Rules:
- Implement the task fully. Do not ask questions.
- Commit your work with a conventional commit message.
- If you encounter a blocker you cannot resolve, commit what you have
  and note the blocker in your commit message.
- Read any relevant AI_CONSTITUTION.md, DESIGN_CONSTITUTION.md,
  or *.spec.md files before making changes.
- All styling via STL (styled() or stl prop). No plain style={}.
- Use STL shorthands (bg, p, px, radius, etc).
```

### Step 3: CONFIRM

When the agent returns:

1. Parse the result for the worktree path and branch name
2. Show the user a summary:

```markdown
## `/do` complete

**Branch:** `{worktree_branch}`
**Worktree:** `{worktree_path}`

### Changes
{agent's summary of what was done}

### Diff
{run `git -C {worktree_path} diff HEAD~1` to show the committed diff}
```

3. **Start playground preview** in the worktree:
   ```bash
   # Find available port (try 5174, then increment)
   PORT=5174
   while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

   # Start playground dev server in the worktree
   (cd {worktree_path} && yarn dev:playground --port $PORT &)
   PREVIEW_PID=$!
   ```
   Add to the summary — print the full clickable URL so the user can open it directly:
   `**Preview:** http://localhost:{PORT}`

4. **If `--yolo`:** kill the preview server (`kill $PREVIEW_PID 2>/dev/null`), skip to Step 5 (merge).
5. **Otherwise:** `AskUserQuestion`:
   - **merge** — merge into `$ORIGIN_BRANCH` and clean up
   - **open** — open the worktree in VS Code (`code {worktree_path}`) for manual review, then ask again
   - **discard** — delete worktree, no merge

After merge or discard, kill the preview server: `kill $PREVIEW_PID 2>/dev/null`

### Step 5: MERGE

```bash
# Ensure we're on the origin branch
git checkout $ORIGIN_BRANCH

# Merge the worktree branch
git merge {worktree_branch} --no-edit

# Clean up worktree
git worktree remove {worktree_path} --force
git worktree prune

# Delete the temporary branch
git branch -d {worktree_branch}
```

After merge, confirm: "Merged and cleaned up. You're on `$ORIGIN_BRANCH`."

### Step 5 (alt): DISCARD

```bash
git worktree remove {worktree_path} --force
git worktree prune
git branch -D {worktree_branch}
```

Confirm: "Discarded. No changes applied."

---

## Edge cases

- **Agent makes no changes:** worktree auto-cleans. Report "No changes made" and exit.
- **Merge conflict:** Report the conflict, suggest `open` so user can resolve manually.
- **Agent returns error:** Show the error, offer `open` or `discard`.

---

## Rules

1. **Never queue.** `/do` is not `/q`. No queue files, no relay, no drain.
2. **One task, one agent.** No parallelism within `/do`.
3. **Always return to `$ORIGIN_BRANCH`** after merge or discard.
4. **Worktree placement:** `.worktrees/do-{timestamp}` subfolder convention.
5. **Confirmation is default.** `--yolo` is opt-in.
