---
name: do
description: "Run a task in an isolated worktree, present the diff for approval, then merge back. Lightweight alternative to /q for small, single-unit work."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.1.0
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

### Step 2: CREATE WORKTREE

**IMPORTANT:** Do NOT use `Agent(isolation: "worktree")` — it branches from `origin/main` instead of the current HEAD. Create the worktree manually:

```bash
WORKTREE_ID="do-$(date +%s)"
WORKTREE_PATH=".worktrees/$WORKTREE_ID"
WORKTREE_BRANCH="do/$WORKTREE_ID"

git worktree add -b "$WORKTREE_BRANCH" "$WORKTREE_PATH"
```

This branches from the current HEAD, preserving all local work.

Symlink `node_modules` so the worktree can resolve dependencies:
```bash
ln -sf "$(pwd)/node_modules" "$WORKTREE_PATH/node_modules"
```

### Step 3: EXECUTE

Spawn a single Agent — **no `isolation` parameter** (the worktree already exists):

```
Agent(
  prompt: <see worker prompt below>,
  mode: "bypassPermissions",
  description: "do: <first 5 words of instructions>"
)
```

**Worker prompt:**

```
You are a worker. Execute this task completely:

{instructions}

Your working directory is: {absolute path to worktree}
All file reads, edits, and git commands MUST use this directory.
Do NOT modify files outside this worktree.

Rules:
- Implement the task fully. Do not ask questions.
- Commit your work with a conventional commit message.
- If you encounter a blocker you cannot resolve, commit what you have
  and note the blocker in your commit message.
- Read any relevant CONSTITUTION.md, *.spec.md, or *.ai.md files
  before making changes.
- All styling via STL (styled() or stl prop). No plain style={}.
- Use STL shorthands (bg, p, px, radius, etc).
```

### Step 4: CONFIRM

When the agent returns:

1. Show the user a summary:

```markdown
## `/do` complete

**Branch:** `{WORKTREE_BRANCH}`
**Worktree:** `{WORKTREE_PATH}`

### Changes
{agent's summary of what was done}

### Diff
{run `git -C {WORKTREE_PATH} diff HEAD~1` to show the committed diff}
```

2. **Start playground preview** in the worktree:
   ```bash
   # Start dev server (Vite auto-picks a free port)
   cd {WORKTREE_PATH} && yarn dev:playground > /tmp/$WORKTREE_ID.log 2>&1 &
   PREVIEW_PID=$!

   # Wait for Vite to print the URL, then extract it
   for i in $(seq 1 30); do
     URL=$(grep -oE 'http://localhost:[0-9]+/?' /tmp/$WORKTREE_ID.log 2>/dev/null | head -1)
     [ -n "$URL" ] && break
     sleep 1
   done
   ```
   Add to the summary: `**Preview:** {URL}`

   Open the playground in the user's default browser:
   ```bash
   open "$URL"
   ```

3. **If `--yolo`:** kill the preview server (`kill $PREVIEW_PID 2>/dev/null`), skip to Step 5 (merge).
4. **Otherwise:** `AskUserQuestion`:
   - **merge** — merge into `$ORIGIN_BRANCH` and clean up
   - **open** — open the worktree in VS Code (`code {WORKTREE_PATH}`) for manual review, then ask again
   - **discard** — delete worktree, no merge

After merge or discard, kill the preview server: `kill $PREVIEW_PID 2>/dev/null`

### Step 5: MERGE

```bash
# Ensure we're on the origin branch
git checkout $ORIGIN_BRANCH

# Merge the worktree branch
git merge $WORKTREE_BRANCH --no-edit

# Clean up worktree
git worktree remove $WORKTREE_PATH --force
git worktree prune

# Delete the temporary branch
git branch -d $WORKTREE_BRANCH
```

After merge, confirm: "Merged and cleaned up. You're on `$ORIGIN_BRANCH`."

### Step 5 (alt): DISCARD

```bash
git worktree remove $WORKTREE_PATH --force
git worktree prune
git branch -D $WORKTREE_BRANCH
```

Confirm: "Discarded. No changes applied."

---

## Edge cases

- **Agent makes no changes:** remove worktree, report "No changes made" and exit.
- **Merge conflict:** Report the conflict, suggest `open` so user can resolve manually.
- **Agent returns error:** Show the error, offer `open` or `discard`.

---

## Rules

1. **Never queue.** `/do` is not `/q`. No queue files, no relay, no drain.
2. **One task, one agent.** No parallelism within `/do`.
3. **Always return to `$ORIGIN_BRANCH`** after merge or discard.
4. **Worktree placement:** `.worktrees/do-{id}` subfolder convention.
5. **Confirmation is default.** `--yolo` is opt-in.
6. **Never use `Agent(isolation: "worktree")`** — it branches from `origin/main`, not HEAD. Always create the worktree manually with `git worktree add`.
