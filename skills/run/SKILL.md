---
name: run
description: "Ephemeral parallel executor. Spawns agents in worktrees, serializes merges. Used by /think or standalone."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Run

Parallel execution with serialized merges. Spawns agents in isolated worktrees, waits for completion, then rebases and merges each result sequentially — eliminating merge race conditions.

```
/run {instructions}   — analyze, split, spawn, merge
/run:status           — show active agents and progress
```

Flags:
- `--workers N` — max concurrent agents (default 3, max 5)

---

## When to use `/run` vs `/do` vs `/q`

| | `/run` | `/do` | `/q` |
|---|---|---|---|
| **Tasks** | 1–N parallel | 1 | 1–N parallel |
| **Persistence** | Ephemeral | Ephemeral | Queue files (survives interruption) |
| **Merge owner** | Orchestrator (serialized) | Self (with confirmation) | Self or `/scope` orchestrator |
| **Use when** | Local parallel work, `/think` | Quick single change | Tracked work, `/scope` |

---

## Flow

```
/run {instructions}
    │
    ANALYZE  — split into file-disjoint tasks
    │
    SPAWN    — create worktrees, launch agents (up to --workers)
    │
    MONITOR  — wait for agents to complete
    │
    MERGE    — sequential rebase + merge for each completed branch
    │
    CLEANUP  — remove worktrees, report results
```

---

## Phase 1: ANALYZE

Record target branch: `git rev-parse --abbrev-ref HEAD` → `$TARGET_BRANCH`.

**Standalone** (`/run {instructions}`):
1. Research the codebase to understand scope
2. Split into file-disjoint tasks (each touches different files)
3. Print task list:
   ```
   /run — {N} tasks
   ─────────────────────────
   001: {title} — {files}
   002: {title} — {files}
   003: {title} — integration
   Target: {$TARGET_BRANCH}
   ```

**Called with pre-split tasks** (from `/think`):
- Use the provided list directly, skip splitting.
- `/think` passes the full plan text. `/run` parses numbered steps into tasks.

---

## Phase 2: SPAWN

For each task (up to `--workers N` concurrent):

1. **Create worktree:**
   ```bash
   git worktree add -b run-{NNN} .worktrees/run-{NNN} $TARGET_BRANCH
   ln -sf "$(pwd)/node_modules" .worktrees/run-{NNN}/node_modules
   ```

2. **Spawn agent:**
   ```
   Agent(
     prompt: <worker prompt below>,
     mode: "bypassPermissions",
     description: "run: {first 5 words of task}"
   )
   ```

**Worker prompt:**
```
You are a worker. Execute this task completely:

{task instructions}

Your working directory is: {absolute path to worktree}
All file reads, edits, and git commands MUST use this directory.
Do NOT modify files outside this worktree.
Do NOT merge to any branch. Just commit your work.

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

**Launch all agents in a single batch** — multiple parallel `Agent()` calls in one message. This maximizes concurrency.

**Batch processing:** If tasks > `--workers`, spawn first batch. After that batch completes and merges, spawn next batch. Each batch gets the latest target (including prior batch merges).

---

## Phase 3: MONITOR

Wait for all spawned agents to return. The `Agent` tool returns when each agent completes — this is the completion signal. **No relay needed.**

Track status per task:
- `·` Pending (not yet spawned)
- `⟳` Running (agent spawned, waiting for return)
- `✓` Done (agent returned successfully)
- `✗` Failed (agent returned with error)

---

## Phase 4: MERGE

**Sequential, in task-number order.** This is the core serialization guarantee.

For each completed task (in order 001, 002, 003...):

```bash
# Ensure we're on the target branch
git checkout $TARGET_BRANCH

# Incorporate any remote changes + prior merges
git fetch origin $TARGET_BRANCH 2>/dev/null || true
git rebase origin/$TARGET_BRANCH 2>/dev/null || true

# Rebase the worker branch onto latest target (includes prior task merges)
git checkout run-{NNN}
git rebase $TARGET_BRANCH
git checkout $TARGET_BRANCH

# Merge with merge commit
git merge --no-ff run-{NNN} -m "merge: run-{NNN} {task-title}"
```

**On rebase conflict:**
- Skip this task
- Record conflict details
- Continue with remaining tasks
- Report at end

**On agent failure (no commit):**
- Skip, record failure, continue

**No push.** `/run` operates locally. Push is the caller's responsibility.

---

## Phase 5: CLEANUP

For each task (merged, skipped, or failed):

```bash
git worktree remove .worktrees/run-{NNN} --force 2>/dev/null
git worktree prune
git branch -D run-{NNN} 2>/dev/null
```

Ensure `$TARGET_BRANCH` is checked out at the end.

Print results:
```
/run complete
─────────────────────────
  ✓ run-001: {title} — merged
  ✓ run-002: {title} — merged
  ✗ run-003: {title} — conflict (skipped)

Target: {$TARGET_BRANCH}
```

---

## `/run:status`

Show current state:

```
/run — active
─────────────────────────
Target: {$TARGET_BRANCH}
Workers: 2/3

  ✓ run-001: {title} — merged
  ⟳ run-002: {title} — running
  ⟳ run-003: {title} — running
  · run-004: {title} — pending
```

If no `/run` is active: "No active /run session."

---

## Error Recovery

**Orchestrator interrupted (leftover worktrees):**
```bash
# List orphaned run worktrees
git worktree list | grep 'run-'

# Clean up
git worktree remove .worktrees/run-{NNN} --force
git worktree prune
git branch -D run-{NNN}
```

**Agent dies mid-task:** The `Agent` tool returns (with error). `/run` records the failure and continues with remaining tasks. No orphan recovery protocol needed — `/run` owns the full lifecycle.

**Merge conflict cascade:** If task 001 conflicts, tasks 002+ may also conflict (they were based on the same target). `/run` continues attempting remaining merges — some may succeed if they touch different files.

---

## Rules

1. **Never push.** Local merges only. Caller pushes if needed.
2. **Always rebase before merge.** Every branch gets rebased onto latest target before merging.
3. **Sequential merge order.** 001 before 002 before 003. Never parallel merges.
4. **One agent per task.** No drain loops, no relay, no queue files.
5. **Ephemeral.** No persistent state. If interrupted, worktrees may remain — user cleans up manually or `/run` detects them on next invocation.
6. **Never use `Agent(isolation: "worktree")`** — it branches from `origin/main`, not the target branch. Always create worktrees manually.
7. **File-disjoint tasks.** Each task must touch different files for safe parallel execution.
8. **Target = current branch.** `/run` merges to whatever branch is checked out when invoked.
