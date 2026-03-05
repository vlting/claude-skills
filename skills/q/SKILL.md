---
name: q
description: "Queue a task or drain the task queue."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 13.0.0
---

# Q

Two modes: **enqueue** (create a task) or **drain** (execute tasks).

```
/q                — Drain the queue (worker mode — claim and execute tasks)
q {description}   — Enqueue a task (create an instruction file)
```

Flags (enqueue only):
- `--no-segment` — single task, no file-disjoint splitting
- `--no-auto` — create task but don't start draining

---

## Queue Folder

Always `./.ai-queue/`. Created on first use. Gitignored — task files are per-engineer ephemeral work items.

### File Naming

All files live directly in `.ai-queue/` (never subfolders). 3-digit zero-padded prefix:

| State | Pattern | Example |
|-------|---------|---------|
| Pending | `XXX.md` | `004.md` |
| Being drafted | `XXX-wip.md` | `005-wip.md` |
| Active | `XXX-active.md` | `003-active.md` |

Next number = highest existing number + 1 (check all files including `_completed/`).

### Directives (in file header)

```markdown
<!-- auto-queue -->              ← skip review, start immediately
<!-- depends-on: 001, 002 -->    ← wait for these tasks to complete first
<!-- target-branch: feat/x/y --> ← branch to work on (required for worktree)
```

---

## Task Progress

Active task files track progress inline:

```markdown
<!-- LAT: 2026-03-04T12:00:00Z -->
<!-- PID: 12345 -->
<!-- worktree: .worktrees/q-003 -->
<!-- branch: feat/slug/stage-title -->

# Task: {title}

## Checklist
- [x] Step 1
- [ ] Step 2
- [ ] Step 3
```

**LAT (Last Active Timestamp):** Updated every significant action. Used for orphan detection.
**PID:** The agent process claiming this task. Verified via `kill -0`.

---

## Parallel Safety

Tasks are **file-disjoint**: each task touches different files. This makes parallel execution safe — no merge conflicts between concurrent worktrees.

Before merging a completed task: always `git fetch && git rebase` on the target branch to incorporate other workers' merged changes. Then merge with `--no-ff` to create a merge commit.

**Integration segment:** After all tasks for a stage complete, one worker handles any cross-file integration work (imports, wiring, etc.) as a final task.

---

## Drain Loop

### Startup

1. Ensure relay is running:
   ```bash
   RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
   RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
   if ! ([ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]); then
     mkdir -p .ai-relay
     nohup node ~/.claude/skills/relay/server.js "$(pwd)/.ai-relay" > .ai-relay/relay.log 2>&1 &
     # Wait up to 2s for relay.sock
   fi
   ```

2. Connect to relay as worker:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'identify',role:'worker',pid:+process.argv[2]})+'\n');
   s.on('data', d => { for (const l of d.toString().split('\n').filter(Boolean)) { try { console.log(l); } catch {} } s.destroy(); });
   setTimeout(() => s.destroy(), 2000);
   " "$RELAY_SOCK" "$PPID"
   ```

3. Scan for pending tasks.

### Main Loop (NEVER EXIT unless told to)

**CRITICAL: The drain loop runs continuously. After completing a task or waking from idle, ALWAYS loop back to step 1. The ONLY way to exit is receiving an `epic-done` event.**

```
┌─→ 1. Scan for pending tasks
│   2. If found → Claim → Execute → Archive → /clear → loop back to 1
│   3. If none  → Idle Wait (block up to 9 min) → loop back to 1
│   4. If epic-done received → EXIT
└───────────────────────────────────────────────────────────────────┘
```

**Scan:**
1. List `XXX.md` files (pending). Pick lowest number whose dependencies are met.
2. Also list `XXX-active.md` files. For each, run orphan detection (see Orphan Recovery). If orphaned → recover to pending, then re-scan.
3. If no claimable task → Idle Wait.

**Claim → Execute → Archive:**
1. **Claim (atomic write-then-rename):**
   - Read `XXX.md` content.
   - Prepend `<!-- LAT: {ISO timestamp} -->` and `<!-- PID: $PPID -->` headers to the content.
   - Write the updated content back to `XXX.md`.
   - Rename `XXX.md` → `XXX-active.md`.
   - Send `task-claimed` event.
   All tracking headers must exist in the file **before** the rename. Another worker seeing `XXX-active.md` must always find a PID inside.
2. **Execute:** See Task Execution below.
3. **Archive:** Move to `_completed/{hash}.md` where hash = commit short SHA. Send `task-completed` event.
4. **Context clear:** `/clear` between tasks. Each task starts with fresh context.
5. **Loop back** to scan.

### Exit

- **ONLY** on `epic-done` event → exit drain loop.
- Print status: tasks completed this session, any errors.
- Call relay smart stop (last agent out stops the server).
- **Never exit just because the queue is empty.** Always idle-wait and re-scan.

**!! ROLE BOUNDARY !!**
Q is execution-only. A `/q` worker:
- Never runs phases, stages, or lifecycle management
- Never reads or writes orchestrator state files
- Never interprets `returnTo` or roadmap status fields
- Never manages branches beyond its assigned task's target branch
- If invoked directly (not by an orchestrator), you are a standalone worker — just execute the task

---

## Orphan Recovery

A task is orphaned when its claiming agent dies. Detection:

| Signal | Verdict |
|--------|---------|
| `worker-disconnected` relay event with task ID | Immediately orphaned |
| PID present + `kill -0` fails | Orphaned |
| LAT stale (>5 min) + PID dead | Orphaned |
| LAT stale but PID alive | Agent is slow, **not** orphaned |
| No PID + file mtime > 60s ago | Orphaned (claim crashed before completing) |
| No PID + file mtime ≤ 60s ago | **Not** orphaned — claim in progress, skip and re-check next scan |

**Check file mtime** (for missing-PID cases):
```bash
# Returns age in seconds
echo $(( $(date +%s) - $(stat -f %m "$FILE") ))
```

**Recovery:** Rename `XXX-active.md` → `XXX.md` (back to pending). Clear LAT/PID/worktree headers. The task re-enters the queue for any worker to claim.

If a worktree exists for the orphaned task, check for uncommitted work. If salvageable, commit it before cleanup. If not, remove the worktree.

---

## Idle Waiting

**IMPORTANT: Idle waiting is NOT exiting. After idle wait completes, ALWAYS loop back to scan for tasks again. This is a 9-minute watch cycle that refreshes indefinitely.**

When no pending tasks exist:

**With relay (preferred):** Block on socket events for up to 9 minutes. Then re-scan and wait again:
```bash
node -e "
const s = require('net').connect(process.argv[1]);
const events = new Set(process.argv.slice(3));
const timeout = setTimeout(() => { console.log('IDLE_TIMEOUT'); s.destroy(); }, +process.argv[2]);
s.write(JSON.stringify({type:'identify',role:'worker',pid:process.env.PPID||0})+'\n');
s.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'event' && events.has(msg.event)) {
        clearTimeout(timeout);
        console.log(msg.event);
        s.destroy();
      }
    } catch {}
  }
});
" "$RELAY_SOCK" "540000" "work-queued" "epic-done" "worker-disconnected"
```

| Event received | Action |
|---------------|--------|
| `work-queued` | **Loop back** — re-scan queue, claim next task |
| `epic-done` | **Exit** drain loop (the ONLY exit condition) |
| `worker-disconnected` | Check for orphaned tasks, then **loop back** |
| `IDLE_TIMEOUT` (9 min) | **Loop back** — re-scan queue (safety net), then idle-wait again |

**Without relay (fallback):** Poll `.ai-queue/` every 15s for new pending files. Never exit — runs indefinitely until `epic-done`.

---

## Enqueue Mode

When invoked as `q {description}`:

### Segment mode (default)

1. Research the codebase to understand the scope.
2. Split into file-disjoint segments. Each segment becomes a separate task file.
3. Number files sequentially. Add `<!-- auto-queue -->` and `<!-- target-branch: ... -->` headers.
4. Write a brief review walkthrough:
   ```
   --- Queued {N} tasks ---
   001.md: {title} — {files touched}
   002.md: {title} — {files touched}
   003.md: {title} — integration
   Target branch: {branch}
   ---
   ```
5. Start draining (default) or exit if `--no-auto`.

### `--no-segment`

Create a single task file with the full description. No splitting.

### `--no-auto`

Create task file(s) but don't start draining. Print the walkthrough and exit.

**DO NOT IMPLEMENT.** Enqueue mode creates instruction files only. Never start implementing while in enqueue mode.

---

## Task Execution (internal)

When a worker claims a task:

1. **Read the instruction file.** Extract target branch, checklist, file paths.

2. **Create worktree:**
   ```bash
   git worktree add -b q-{NNN} .worktrees/q-{NNN} {target-branch}
   ```

3. **Implement** in the worktree. Follow the instruction file exactly. Update the checklist in the active file as steps complete. Update LAT after each significant action.

4. **Commit:** Conventional commit message. Stage only the files specified in the task.

5. **Merge to target branch:**
   ```bash
   cd {repo-root}
   git checkout {target-branch}
   git fetch origin {target-branch}
   git rebase origin/{target-branch}
   git merge --no-ff q-{NNN} -m "merge: q-{NNN} {task-title}"
   git push origin {target-branch}
   ```

6. **Cleanup:**
   ```bash
   git worktree remove .worktrees/q-{NNN} --force
   git branch -D q-{NNN}
   ```

7. **Archive:** Rename to `_completed/{commit-hash}.md`.

---

## Relay Patterns

**Check running:**
```bash
RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
RELAY_RUNNING=false
if [ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]; then
  RELAY_RUNNING=true
fi
```

**Send event:**
```bash
node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'event',event:process.argv[2]})+'\n');
setTimeout(() => s.destroy(), 500);
" "$RELAY_SOCK" "{event-name}"
```

**Smart stop (on exit):**
```bash
# Query status first — only stop if no other agents alive
RESULT=$(node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'status'})+'\n');
s.on('data', d => {
  for (const l of d.toString().split('\n').filter(Boolean)) {
    try { const r = JSON.parse(l); if (r.type==='status-response') { console.log((r.liveAgents||0)<=1?'SAFE':'BLOCKED'); s.destroy(); } } catch {}
  }
});
setTimeout(() => { console.log('TIMEOUT'); s.destroy(); }, 2000);
" "$RELAY_SOCK")
[ "$RESULT" = "SAFE" ] && kill "$(cat "$RELAY_PID_FILE")" 2>/dev/null
```
