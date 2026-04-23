---
name: q
description: "Queue a task or drain the task queue."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 16.1.0
---

# Q

Two modes: **enqueue** (create a task) or **drain** (execute tasks).

```
/q                            — Drain the queue (worker mode — claim and execute tasks)
/q drain                      — Explicit drain (same as bare /q)
/q {description}              — Enqueue a task (create an instruction file)
/q --no-auto {description}    — Enqueue without draining
/q --no-segment {description} — Enqueue as single task (no splitting)
/q drain --preview            — Drain with preview gate before each merge
```

Flags may appear before or after the description. Flags listed above for quick reference; details below.

Flags (enqueue only):
- `--no-segment` — single task, no file-disjoint splitting
- `--no-auto` — create task but don't start draining

Flags (drain only):
- `--preview` — pause before merging each task: spin up a playground in the worktree, ask user to approve/discard (see Preview Gate)

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

Next number = highest existing number + 1 (scan only pending `XXX.md` and active `XXX-active.md` — ignore `_completed/`). Resets to `001` when queue is empty.

### Directives (in file header)

```markdown
<!-- auto-queue -->              ← skip review, start immediately
<!-- depends-on: 001, 002 -->    ← wait for these tasks to complete first
<!-- target-branch: feat/x/y --> ← branch to work on (required for worktree)
<!-- no-merge -->                ← skip self-merge; orchestrator handles merge (used by /scope)
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

## Session Persistence (state MCP)

Workers register with the `state` MCP server for cross-conversation tracking and `/state` dashboard visibility.

**Session key:** `skill: "q"`, `repo: {cwd}`, `scope: "worker"` (drain mode) or `scope: "enqueue"` (enqueue mode).

**Drain mode lifecycle:**

1. **On startup:** `mcp__state__session_start(skill: "q", repo: {cwd}, scope: "worker")`.
   - Idempotent — if the same worker reconnects, returns the existing session.
2. **On task claim:** `mcp__state__session_checkpoint(session_id, phase: "claim", state_json: {task: "NNN", target_branch, title})`.
3. **On task complete/archive:** `mcp__state__session_checkpoint(session_id, phase: "complete", state_json: {task: "NNN"}, git_ref: {commit SHA})`.
4. **On idle (queue empty, blocking on relay):** `mcp__state__session_checkpoint(session_id, phase: "idle")`.
5. **On exit (Esc or no more work):** `mcp__state__session_complete(session_id)`.

**Enqueue mode:** `session_start` on entry, `session_complete` after files are written. Lightweight — just for dashboard visibility.

**Recovery:** If a worker reconnects after a crash, `session_resume` shows the last checkpoint. If it was mid-task (`phase: "claim"`), the worker checks if the task file is still `XXX-active.md` with its PID — if so, the worktree may still exist and work can resume. If not (orphan recovery already happened), start fresh.

The `.ai-queue/` files and relay remain authoritative for task content and claim coordination. The session DB is for observability and recovery hints.

---

## Parallel Safety

Tasks are **file-disjoint**: each task touches different files. This makes parallel execution safe — no merge conflicts between concurrent worktrees.

Before merging a completed task: always `git fetch && git rebase` on the target branch to incorporate other workers' merged changes. Then merge with `--no-ff` to create a merge commit.

**Integration segment:** After all tasks for a stage complete, one worker handles any cross-file integration work (imports, wiring, etc.) as a final task.

---

## Relay (Required)

**The relay must be running.** Workers error loudly and refuse to start if the relay is down and cannot be auto-started.

Fixed socket path: `~/.claude/relay.sock`

**Start relay (if not running):**
```bash
RELAY_SOCK="$HOME/.claude/relay.sock"
RELAY_PID="$HOME/.claude/relay.pid"
if ! ([ -f "$RELAY_PID" ] && kill -0 "$(cat "$RELAY_PID")" 2>/dev/null && [ -S "$RELAY_SOCK" ]); then
  nohup node ~/.claude/skills/relay/server.js > ~/.claude/relay.log 2>&1 &
  # Wait up to 2s for relay.sock to appear
  for i in 1 2 3 4; do [ -S "$RELAY_SOCK" ] && break; sleep 0.5; done
fi
```

**If relay still not available after auto-start attempt:**
```
ERROR: Relay server is not running and could not be started.
Cannot proceed without relay — task claiming requires relay coordination.
Start the relay manually: node ~/.claude/skills/relay/server.js
```
**Do NOT silently proceed. Do NOT fall back to file-based claiming.**

---

## Drain Loop

### Startup

1. **Start relay** (see Relay section). If relay unavailable → error and exit.

2. **Connect to relay as worker:**
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'identify',pid:+process.argv[2]})+'\n');
   s.on('data', d => { for (const l of d.toString().split('\n').filter(Boolean)) { try { console.log(l); } catch {} } s.destroy(); });
   setTimeout(() => s.destroy(), 2000);
   " "$RELAY_SOCK" "$PPID"
   ```

3. Scan for pending tasks.

### Main Loop

```
┌─→ 1. Scan for pending tasks
│   2. If found → Claim via relay → Execute → Archive → /clear → loop back to 1
│   3. If none → Block on relay for work-queued/task-completed → loop back to 1
│   4. If user presses Esc → EXIT
└───────────────────────────────────────────────────────────────────────────────┘
```

**Scan:**
1. List `XXX.md` files (pending). Pick lowest number whose dependencies are met.
2. Also list `XXX-active.md` files. For each, run orphan detection (see Orphan Recovery). If orphaned → recover to pending, then re-scan.
3. If no claimable task → block on relay (see Idle / Persistent Listening).

**Exit condition:** User presses **Esc** to interrupt the blocking listener → worker returns to normal conversation flow.

**Persistent listening:**
When the queue is empty (with or without blocked items), the worker does NOT exit. It blocks on the relay waiting for `work-queued`, `task-completed`, or `worker-disconnected` events. When received, re-scan. The worker stays alive until an exit condition is met.

**Claim → Execute → Archive:**
1. **Claim (relay-coordinated):**
   - Get the task file's creation timestamp: `stat -f %B {file}` (macOS) or `stat -c %W {file}` (Linux)
   - Send claim to relay:
     ```bash
     node -e "
     const s = require('net').connect(process.argv[1]);
     s.write(JSON.stringify({type:'claim',key:process.argv[2]})+'\n');
     s.on('data', d => {
       for (const l of d.toString().split('\n').filter(Boolean)) {
         try { const r = JSON.parse(l); console.log(r.type); } catch {}
       }
       s.destroy();
     });
     setTimeout(() => s.destroy(), 2000);
     " "$RELAY_SOCK" "{NNN}:{ctime}"
     ```
   - If `claim-granted` → proceed with rename:
     - Read `XXX.md` content
     - Prepend `<!-- LAT: {ISO timestamp} -->` and `<!-- PID: $PPID -->` headers
     - Write updated content back to `XXX.md`
     - Rename `XXX.md` → `XXX-active.md`
   - If `claim-denied` → skip this task, scan for next
   - **No file-based fallback.** Relay is the single source of truth for claims.
2. **Execute:** See Task Execution below.
3. **Archive:** Move to `_completed/{hash}.md` where hash = commit short SHA. Send `task-completed` event with key. Then send `release` to free the claim:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'release',key:process.argv[2]})+'\n');
   s.on('data', d => { s.destroy(); });
   setTimeout(() => s.destroy(), 1000);
   " "$RELAY_SOCK" "{NNN}:{ctime}"
   ```
4. **Context clear:** `/clear` between tasks. Each task starts with fresh context.
5. **Loop back** to scan.

---

## Orphan Recovery (Relay-Coordinated)

A task is orphaned when its claiming agent dies. Recovery goes through the relay to prevent race conditions where two workers try to recover the same task.

**For each `XXX-active.md` file found during scan:**

1. Extract the claim key from the file. The key format is `{NNN}:{ctime}` — get `NNN` from the filename, `ctime` from the file's `stat -f %B` (macOS) or `stat -c %W` (Linux).

2. Send `recover` to relay:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'recover',key:process.argv[2]})+'\n');
   s.on('data', d => {
     for (const l of d.toString().split('\n').filter(Boolean)) {
       try { const r = JSON.parse(l); console.log(r.type); } catch {}
     }
     s.destroy();
   });
   setTimeout(() => s.destroy(), 2000);
   " "$RELAY_SOCK" "{NNN}:{ctime}"
   ```

3. **`recover-granted`** → The relay confirmed the owner PID is dead (or no claim exists). Recover the task:
   - Rename `XXX-active.md` → `XXX.md` (back to pending)
   - Clear `LAT`, `PID`, `worktree`, `branch` headers
   - If a worktree exists, check for uncommitted work. If salvageable, commit before cleanup. If not, remove the worktree.

4. **`recover-denied`** → The owner PID is still alive. Skip — the task is not orphaned.

5. **Relay unavailable** → Fall back to local PID check:
   - Extract PID from `<!-- PID: ... -->` header
   - `kill -0 $PID` succeeds → skip (not orphaned)
   - `kill -0 $PID` fails → recover (rename to pending, clear headers)
   - No PID + file mtime > 60s → recover
   - No PID + file mtime ≤ 60s → skip (claim in progress)

The relay's `recover` handler is atomic — only one worker can win the recovery for a given key. This eliminates the race where two workers both detect the same orphan and both try to claim it.

---

## Idle / Persistent Listening

When no immediately claimable tasks exist, the worker stays connected to the relay and waits for new work. It does **not** exit on empty queue.

**Subscribe-first-then-scan** to eliminate the race where `work-queued` fires between the scan and the relay connect:

```bash
node ~/.claude/skills/q/relay-listen.js "$RELAY_SOCK" ".ai-queue" "540000" "work-queued" "task-completed" "worker-disconnected"
```

**Why subscribe-first:** connecting to the relay registers the worker for future events. Scanning *after* connect means: work queued before connect is caught by the scan, work queued after connect is caught by the event. No gap.

| Output | Action |
|--------|--------|
| `WORK_FOUND` | Pending files detected on immediate scan — re-enter main loop |
| `work-queued` | Re-scan — new tasks available |
| `task-completed` | Re-scan — a dependency may now be met |
| `worker-disconnected` | Check for orphaned tasks, then re-scan |
| `IDLE_TIMEOUT` (9 min) | Re-scan (safety net), then block again |

**Pickup latency:** sub-second (scan is immediate after connect).
**Safety net:** 9-min timeout still triggers a re-scan in case events are missed for any reason.

### Exiting while idle

The relay listener is a blocking Bash command. User messages cannot be processed while it runs. To exit: press **Esc** to interrupt the listener. The worker returns to normal conversation flow and can process any queued input.

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

5. **Review Gate:**

   Run specialist review agents against the worktree. Reviewers with the **Output Contract** (see `.claude/agents/<name>.md`) emit a fenced JSON block the gate parses to decide merge/retry/proceed.

   **Selection** — include by default, skip only when clearly irrelevant:

   | Agent | Skip when |
   |---|---|
   | `stl-enforcer` | No `packages/stl*` edits, no `styled()`/`stl=` usage |
   | `a11y-reviewer` | No interactive or visible UI, no ARIA-relevant changes |
   | `design-critic` | No UI/visual changes (pure logic, config, build scripts) |
   | `bundle-checker` | No new deps, no new exports, no build-affecting changes |

   When in doubt, include. False positives are cheap.

   **Spawn** selected reviewers **in parallel** (read-only, no conflicts):
   ```
   Agent(
     subagent_type: "{reviewer}",
     name: "{reviewer}-q-{NNN}",
     prompt: "Review changes in .worktrees/q-{NNN}. Focus on files: {changed files list}. End with the Output Contract JSON block.",
   )
   ```

   **Parse** each response for the fenced ```json block. Expected shape:
   ```json
   { "severity": "ok|warning|error", "blocking": true, "summary": "...", "findings": [{ "file": "...", "line": 0, "rule": "...", "severity": "error|warning", "message": "..." }] }
   ```

   **Verdict:**
   | Aggregate | Action |
   |---|---|
   | All `severity: "ok"` | Merge silently |
   | Warnings only (no blocking) | Surface in archive summary, merge |
   | Any `blocking: true` | Re-spawn worker with collected findings (max 1 retry), re-review |
   | Still blocking after retry | Merge anyway, flag blocking findings prominently in archive summary |

   Malformed or missing JSON from a reviewer → treat as `warning`, surface in summary. Never re-retry on malformed output.

6. **Preview Gate (only when `--preview`):**

   If the `--preview` flag is active, pause before merging:

   ```bash
   # Symlink node_modules so the worktree can resolve dependencies
   ln -sf "$(pwd)/node_modules" .worktrees/q-{NNN}/node_modules

   # Start dev server (Vite auto-picks a free port)
   cd .worktrees/q-{NNN} && yarn dev:playground > /tmp/q-preview-{NNN}.log 2>&1 &
   PREVIEW_PID=$!

   # Wait for Vite to print the URL, then extract it
   for i in $(seq 1 30); do
     URL=$(grep -oE 'http://localhost:[0-9]+/?' /tmp/q-preview-{NNN}.log 2>/dev/null | head -1)
     [ -n "$URL" ] && break
     sleep 1
   done
   ```

   Display summary:
   ```markdown
   ## Preview: q-{NNN} — {task-title}
   **Playground:** {URL}
   **Branch:** `q-{NNN}`
   **Worktree:** `.worktrees/q-{NNN}`
   ```

   Do NOT open the URL automatically. Just display it — the user will open it if they want.

   **Create the preview gate marker** (required for merge — enforced by hook):
   ```bash
   touch .worktrees/q-{NNN}/.PREVIEWED
   ```

   Then `AskUserQuestion`:
   - **merge** — proceed to merge and clean up
   - **discard** — skip merge, remove worktree, archive as skipped

   **After response (merge or discard):** kill the preview server:
   ```bash
   kill $PREVIEW_PID 2>/dev/null
   ```

   On **discard**: skip steps 7–9, jump straight to cleanup (step 8) and archive. Do NOT merge.

7. **Merge to target branch:**

   **Check for `<!-- no-merge -->` directive** in the task file. If present, the orchestrator (`/scope`) handles merging — skip steps 6–7 and go to step 6b instead.

   **Standard merge (no `<!-- no-merge -->` directive):**
   ```bash
   cd {repo-root}
   git checkout {target-branch}
   git fetch origin {target-branch}
   git rebase origin/{target-branch}
   git merge --no-ff q-{NNN} -m "merge: q-{NNN} {task-title}"
   git push origin {target-branch}
   ```
   Then proceed to step 8.

   **7b. Orchestrated mode (`<!-- no-merge -->` present):**

   The worker does NOT merge. Instead:
   1. Send `task-ready` event via relay (signals the orchestrator that a branch is ready to merge)
   2. Block on relay waiting for `merge-done:{NNN}` event:
      ```bash
      node ~/.claude/skills/q/relay-listen.js "$RELAY_SOCK" ".ai-queue" "300000" "merge-done:{NNN}"
      ```
      This blocks up to 5 minutes. If timeout → log warning, proceed to archive anyway (orchestrator may have already merged).
   3. After receiving `merge-done:{NNN}` (or timeout) → proceed to step 8.

8. **Cleanup:**
   ```bash
   git worktree remove .worktrees/q-{NNN} --force
   git branch -D q-{NNN}
   ```

9. **Archive:** Rename to `_completed/{commit-hash}.md`. Send `task-completed` event with key `{NNN}:{ctime}`.

---

## Relay Patterns

**Send event:**
```bash
RELAY_SOCK="$HOME/.claude/relay.sock"
node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'event',event:process.argv[2]})+'\n');
setTimeout(() => s.destroy(), 500);
" "$RELAY_SOCK" "{event-name}"
```

## Memory Integration

Lightweight recall restores context after `/clear`. Read `~/.claude/skills/memory/MEMORY_OPS.md` for tool call templates.

| Point | Action |
|-------|--------|
| **Task claim** | `recall-prior-art` with task title + file paths. `recall-constraints` with "worker role boundary". |
| **Task error** (build/lint/test fail) | `store-outcome` with error + resolution |
| **Task complete** (non-obvious fix) | `store-decision` with technique used |

---

**!! ROLE BOUNDARY !!**
Q is execution-only. A `/q` worker:
- Never runs phases, stages, or lifecycle management
- Never reads or writes roadmap files
- Never interprets roadmap status fields
- Never manages branches beyond its assigned task's target branch
- **Never creates PRs** — PR creation is `/scope`'s responsibility (ADVANCE phase)
- **Never pushes to `main` or `epic/*` branches** — only push to the task's `target-branch`
- If invoked directly (not by an orchestrator), you are a standalone worker — just execute the task
