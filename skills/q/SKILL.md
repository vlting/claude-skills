---
name: q
description: "Queue a task or drain the task queue."
license: MIT
metadata:
  author: Lucas Castro
  version: 11.5.0
---

# Q Command

Unified command for queued task workflows. Two forms depending on arguments.

## Prerequisites

Required skills: **relay**. Verify before executing:

```bash
[ -f ~/.claude/skills/relay/SKILL.md ] || { echo "Missing skill 'relay'. Install at ~/.claude/skills/relay/"; exit 1; }
```

---

## Queue Folder

The queue folder is always `./.ai-queue/`. If it doesn't exist and a folder needs to be created (e.g., `q {description}`), create `./.ai-queue/`.

Throughout this document, `QUEUE_DIR` refers to `./.ai-queue/`.

> **`.ai-queue/` is gitignored.** Queue files are per-engineer ephemeral work items — committing them would cause other engineers' agents to claim the same tasks. Shared project artifacts (roadmaps, docs) live in `.ai-epics/` instead, which IS tracked in git.

---

## File Naming Convention

All queue files live directly in `QUEUE_DIR` (never in subfolders). Files are named with a **3-digit zero-padded number as a prefix**, followed by an optional **status suffix**:

| State      | Filename pattern  | Example        |
|------------|-------------------|----------------|
| Pending    | `XXX.md`          | `004.md`       |
| Being drafted (wip) | `XXX-wip.md` | `005-wip.md` |
| Actively being worked | `XXX-active.md` | `003-active.md` |

**The number is always the first 3 characters of the filename.** This makes collision detection trivial: to determine which numbers are already in use, read the first 3 characters of every `.md` file directly in `QUEUE_DIR` (excluding subfolders). A number is considered "in use" regardless of what status suffix follows it.

> **Numbering resets when the queue is empty.** Numbers are only determined by files currently in `QUEUE_DIR` (not in subfolders). Once all tasks are archived to `_completed/`, the next task starts at `001` again. This is intentional — completed task files are renamed to commit hashes, so the original numbers are not preserved and cannot collide.

---

## Queue File Directives

Queue instruction files support HTML comment directives on their first few lines:

| Directive | Purpose | Example |
|-----------|---------|---------|
| `<!-- auto-queue -->` | Marks file as auto-queued (line 1) | `<!-- auto-queue -->` |
| `<!-- depends-on: 001, 002 -->` | Task cannot start until listed tasks are archived | `<!-- depends-on: 001, 002 -->` |
| `<!-- target-branch: feat/kitchen-sink -->` | Worktree branches off and merges to this branch instead of the current branch | `<!-- target-branch: feat/kitchen-sink -->` |

### Target Branch Directive

When a queue instruction file contains `<!-- target-branch: <branch> -->`, the task execution procedure changes:

- **Worktree creation:** The worktree is branched off `<branch>` (not the current branch)
- **Rebase:** `git rebase origin/<branch>` (not `origin/main`)
- **Merge:** `git checkout <branch> && git merge <worktree-branch> --no-ff` (not `main`)

If no `target-branch` directive is present, the default behavior applies (use the current branch).

This directive is used by the `epic` skill to route segment work to a feature branch.

---

## Orchestrator State File

When the orchestrating agent (running `/saga` or `/epic`) enters the drain loop, it writes a **state file** that persists across `/clear` boundaries. This enables the drain loop to detect orchestrator mode and allows the agent to resume the correct skill phase after the drain loop exits.

### Location

`QUEUE_DIR/.orchestrator-state.json` — lives alongside queue files, gitignored with the rest of `.ai-queue/`.

### Schema

```json
{
  "role": "orchestrator",
  "pid": 36295,
  "saga": {
    "roadmap": ".ai-sagas/roadmaps/shadcn-parity.md",
    "currentEpic": 1
  },
  "epic": {
    "roadmap": ".ai-epics/roadmaps/2026-03-01-token-audit-fonts.md",
    "currentStage": 1,
    "stageBranch": "feat/token-audit-fonts/font-system-foundation",
    "returnTo": "verify"
  }
}
```

| Field | Purpose |
|-------|---------|
| `role` | Always `"orchestrator"` |
| `pid` | The orchestrating agent's PID — used to verify ownership |
| `saga` | Present only when a saga is driving execution. Contains saga roadmap path and current epic number. |
| `epic` | Always present during orchestrated queue draining. Contains epic roadmap path, current stage number, stage branch name, and which phase to return to after the drain loop exits. |

### Lifecycle

1. **Written by** `/epic` (Phase 3: EXECUTE) or `/saga` (Phase 5: EXECUTE) **before** entering the drain loop.
2. **Read by** the drain loop at startup to detect orchestrator mode.
3. **Read by** the agent after the drain loop exits (or after `/clear`) to determine the next phase.
4. **Updated by** `/epic` or `/saga` when transitioning between stages or epics.
5. **Deleted by** `/epic` (Phase 8: COMPLETION) or `/saga` (Phase 7: COMPLETE) when the orchestration is finished.

### Drain Loop Behavior When State File Exists

When the drain loop starts and finds `.orchestrator-state.json` with a `pid` matching the current agent's PID (`$PPID`):

- **Orchestrator mode activates.** The agent participates as a worker (claims and executes tasks) but follows different exit behavior.
- **No `/clear` between tasks.** The orchestrator skips the Context Clearing Between Tasks procedure to preserve the return-path context. If context grows too large, it may `/clear` but MUST re-read the state file immediately after.
- **No idle waiting.** When the queue is drained (no claimable tasks remain), the orchestrator **exits the drain loop** instead of waiting for new tasks. This returns control to the calling skill (`/epic` or `/saga`).
- **Orphan recovery still runs.** Before exiting, the orchestrator still checks for orphaned tasks and reclaims them if found.

The "drain and return" behavior is the key difference: workers start waiting for new tasks; the orchestrator exits the drain loop so the epic/saga lifecycle can advance to the next phase (VERIFY, ITERATE, ADVANCE, etc.).

### Post-Clear Recovery

If `/clear` runs for any reason while orchestrator state exists, the first action after clearing MUST be:

1. Check for `QUEUE_DIR/.orchestrator-state.json`
2. If it exists and `pid` matches `$PPID`: read the state and resume orchestration from the recorded `returnTo` phase
3. If it doesn't exist or `pid` doesn't match: continue as a normal worker

---

## Relay Integration

Q integrates with the `relay` skill for real-time inter-agent coordination. At drain loop startup, Q ensures relay is running — starting it if needed. On drain loop exit, Q calls `/relay stop` (smart stop — only succeeds if no other agents are connected). This "last one out turns off the lights" pattern means relay is always available during work and automatically cleaned up when all agents are done.

If relay fails to start (e.g., skill not installed, Node.js unavailable), Q falls back to file-based polling and heartbeat detection — the same behavior as before relay existed.

### Starting relay at drain loop startup

At drain loop startup (before the first scan), ensure relay is running:

1. **Check if relay is already running:**
   ```bash
   RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
   RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
   RELAY_RUNNING=false
   if [ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]; then
     RELAY_RUNNING=true
   fi
   ```

2. **If relay is NOT running**, invoke `/relay` to start it. This is idempotent — if another agent starts relay between the check and the invocation, `/relay` will detect the existing server and reuse it. If `/relay` fails (skill not installed), set `RELAY_RUNNING=false` and continue without relay.

3. **If relay IS running** (or was just started), connect and identify as a worker:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'identify',role:'worker',pid:+process.argv[2]})+'\n');
   s.on('data', d => { for (const l of d.toString().split('\n').filter(Boolean)) { try { console.log(l); } catch {} } s.destroy(); });
   setTimeout(() => s.destroy(), 2000);
   " "$RELAY_SOCK" "$PPID"
   ```

### Stopping relay at drain loop exit

When the drain loop exits (queue drained, `epic-done` received, or user termination), attempt to stop relay using the **smart stop protocol below**. Never bypass this by manually killing the relay PID — doing so kills relay for ALL agents across all terminals.

**Smart stop procedure (inline — do NOT shortcut this):**

The smart stop checks TWO independent signals before stopping relay:
1. **Relay-tracked live agents** — PIDs that have identified with the relay and are still alive (survives transient connections)
2. **Connected clients** — sockets currently open to the relay

Both must be zero to stop. This prevents killing relay while agents are actively working but between transient connections.

```bash
RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
if [ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]; then
  STOP_RESULT=$(RELAY_SOCK="$RELAY_SOCK" node <<'SMARTSTOP'
  const s = require("net").connect(process.env.RELAY_SOCK);
  const t = setTimeout(() => { console.log("TIMEOUT"); s.destroy(); }, 2000);
  s.write(JSON.stringify({type:"status"})+"\n");
  s.on("data", d => {
    for (const line of d.toString().split("\n").filter(Boolean)) {
      try {
        const r = JSON.parse(line);
        if (r.type==="status-response") {
          clearTimeout(t);
          const identified = (r.clients||[]).filter(c => c.role !== "unknown");
          const liveAgents = r.liveAgents || 0;
          const blocking = Math.max(identified.length, liveAgents);
          console.log(blocking === 0 ? "SAFE" : `BLOCKED:${identified.length} connected, ${liveAgents} live agents`);
          s.destroy();
        }
      } catch {}
    }
  });
SMARTSTOP
  )
  if [ "$STOP_RESULT" = "SAFE" ]; then
    kill "$(cat "$RELAY_PID_FILE")" 2>/dev/null
    echo "Relay stopped."
  elif [ "$STOP_RESULT" = "TIMEOUT" ]; then
    echo "Relay status query timed out. Not stopping."
  else
    echo "Relay not stopped — ${STOP_RESULT#BLOCKED:}."
  fi
else
  echo "Relay is not running."
fi
```

This is called at every drain loop exit path — the smart stop makes it safe to call unconditionally.

> **CRITICAL: Never `kill` the relay PID directly.** The relay server is shared across all agents in all terminals. Always use the smart stop above, which checks both connected clients AND known live agent PIDs. The relay server also has a defense-in-depth SIGTERM guard that refuses to die if live agents exist, but agents must not rely on this — always use the smart stop protocol.

### Event emission

When relay is running, the drain loop sends events at key lifecycle points:

| Lifecycle point | Event sent |
|----------------|------------|
| After claiming a task (step 2) | `{"type":"event","event":"task-claimed","task":"003","pid":$PPID}` |
| After archiving a task (step 4) | `{"type":"event","event":"task-completed","task":"003"}` |

These events are **in addition to** the file-based heartbeat (LAT + PID), which is always written regardless of relay. The file data is the durable fallback; relay events are the fast path.

### Relay-accelerated orphan detection

When the relay broadcasts a `worker-disconnected` event (an agent's socket closed), the event includes the dead agent's PID and its claimed tasks. Any agent in the drain loop receiving this event can immediately check if the listed tasks have `-active.md` files and reclaim them — no need to wait for the 5-minute LAT stale threshold.

This is handled in the **Orphan Recovery Protocol** and **Idle Waiting for New Tasks** sections below.

---

## Task Progress & Heartbeat

When an agent claims a task (or takes over an orphaned task — see **Orphan Recovery Protocol**), it MUST append a `## Task Progress` section to the end of the active file. This section serves two purposes: **(1)** heartbeat for liveness detection, and **(2)** handoff context if the agent dies mid-task.

### Format

```markdown
## Task Progress
<!-- lat: 2026-02-25T14:32:05Z -->
<!-- agent-pid: 48291 -->
<!-- worktree: .worktrees/q-004 -->
<!-- branch: q/004 -->

### Checklist
- [x] Created worktree from main
- [x] Scaffolded Button component
- [ ] **ACTIVE** → Write unit tests
- [ ] Update barrel export in index.ts
- [ ] Verify build passes

### Handoff Context
- Using the `styled()` pattern from Card component as reference
- Found Tamagui v2 needs `@ts-expect-error` for token defaults
```

### Fields

| Field | Purpose |
|-------|---------|
| `<!-- lat: ... -->` | **Last Active Time** — ISO 8601 UTC timestamp. Updated after each major step. |
| `<!-- agent-pid: ... -->` | **Agent PID** — the shell PID of the claiming agent (obtain via `echo $PPID`). Used for liveness checks. |
| `<!-- worktree: ... -->` | Path to the worktree directory, relative to repo root. |
| `<!-- branch: ... -->` | Git branch name used in the worktree. |

### Checklist Convention

- Derive the checklist from the task's `## Instructions` or `## Verification` sections.
- Mark the currently active step with `**ACTIVE** →` prefix.
- Update the checklist and LAT after completing each step.

### Handoff Context

Free-form notes capturing non-obvious decisions, gotchas, file locations, or partial state that a successor agent would need to continue the work. Update this as you discover things during implementation.

### Heartbeat Update Cadence

The agent MUST update `<!-- lat: ... -->` in the active file at these points:
- Immediately after claiming the task (or taking over an orphaned task)
- After completing each checklist item
- Before starting a long-running operation (build, test suite, etc.)

The LAT does NOT need to be updated on a fixed timer — Claude Code agents don't have background threads. Natural checkpoint updates are sufficient. The stale threshold (used by orphan detection) accounts for this.

---

## Parallel Safety

When multiple agents drain the queue simultaneously (or when segments may be worked in parallel), merge conflicts are the primary risk. The following principles govern all parallel work:

### File-Disjoint Ownership

The fundamental rule: **no two concurrent tasks should modify the same file.** Every task instruction file MUST include a `## Scope` section listing the files it will create or modify. This makes overlap detectable before work begins.

If overlap is truly unavoidable (e.g., a barrel `index.ts`, a shared route config, a page that imports new components), use the **integration segment** pattern described under Segment Mode below.

### Rebase Before Merge

When a worktree is ready to merge back, the agent MUST rebase onto the latest target branch first:

```bash
# Inside the worktree
git fetch origin
git rebase origin/main   # or whatever the target branch is
```

This catches conflicts immediately (in the agent's worktree) rather than producing a broken merge. If the rebase has conflicts, the agent resolves them before merging. This is enforced in the task execution lifecycle.

### Merge Ordering

When multiple tasks are active in parallel, they merge in the order they finish — but the rebase-before-merge step ensures each merge incorporates all previously merged work. No explicit ordering is required because the rebase makes each merge additive.

---

## `q` — Drain the Task Queue

### Syntax
```
q
```

### Drain Loop Startup Checklist

> **MANDATORY — complete ALL steps in order, even if the queue appears empty. Do NOT skip steps or short-circuit.**

> **ROLE BOUNDARY — Q NEVER RUNS EPIC LIFECYCLE PHASES.** The Q skill is an execution engine: it claims tasks, executes them in worktrees, merges, and archives. It NEVER performs epic phases (VERIFY, ADVANCE, BREAKDOWN, ITERATE, PR, COMPLETION) and NEVER interprets the `returnTo` field in the orchestrator state file. Those phases are exclusively owned by the `/epic` skill. When the drain loop exits in orchestrator mode, it literally returns (stops executing) — it does NOT read the state file to figure out "what to do next" and it does NOT run any epic or saga logic. If `/q` was invoked directly by the user, the agent is a **worker** regardless of what the state file says.

1. **Check for orchestrator state file** — read `QUEUE_DIR/.orchestrator-state.json`. If it exists, **run `echo $PPID` as a Bash command** and compare the numeric result to the `pid` field in the state file. They must match **exactly** (integer comparison). If they match, activate **orchestrator mode** (drain-and-return, no idle waiting, no `/clear` between tasks). If they don't match or the file doesn't exist, run as a **normal worker**. Do NOT skip this check or assume the PID matches — always verify with the actual Bash output.
2. Ensure relay is running (start if needed — see **Relay Integration**)
3. Connect to relay as worker (`identify` with PID)
4. Scan queue for claimable tasks → execute each one
5. Run Orphan Recovery Protocol
6. **If orchestrator mode:** Exit the drain loop (return control to calling skill). **If worker mode:** Start waiting for new tasks if no work found.
7. `/relay stop` on every exit path (workers only — orchestrator skips this since the calling skill manages relay)

### Definition

If the repo root contains a `QUEUE_DIR` folder, this enters **the drain loop** — scanning and executing all available tasks in the queue, then exiting.

The drain loop scans for the `next available queued task` (defined as "the lowest-numbered `.md` file directly in `QUEUE_DIR` that does not end in `-active.md` or `-wip.md`, and whose `depends-on` dependencies are all resolved"). For each task found:

> **CRITICAL — No resuming active tasks during normal scanning.** When scanning for the next task, **always skip `-active.md` files**. If a file is already named `XXX-active.md` when you scan, it is owned by another agent — even if you believe you renamed it yourself in an earlier turn of this conversation. Ownership is non-resumable: each `/q` entry is a fresh scan. Only plain `XXX.md` files (not `-active`, not `-wip`) are candidates for claiming. (The sole exception is the **Orphan Recovery Protocol**, which runs at drain-exit time and can take over an `-active.md` file after confirming the owning agent is dead.)

1. **Check dependencies first:** Read the first few lines of the candidate file. If it contains a `<!-- depends-on: 001, 002, ... -->` comment, check whether ALL listed task numbers have been archived to `_completed/`. A dependency is resolved **only** if no file with that number exists in `QUEUE_DIR` at all — no `XXX.md`, `XXX-active.md`, or `XXX-wip.md`. If any dependency still has a file present (in any state), **skip this file** and check the next lowest-numbered candidate.
2. Claim the file by atomically renaming it with the `-active` suffix (e.g., `004.md` → `004-active.md`). If the rename fails (another agent claimed it first), find the next available task. **Immediately after claiming**, append the `## Task Progress` section (see **Task Progress & Heartbeat**) with your PID, the current timestamp as LAT, and a checklist derived from the task's instructions.
3. **Using the internal task execution procedure** (see **Internal: Task Execution in Worker Tree** below), work on the tasks in that .md file until they are all successfully completed. **Update the LAT and checklist** in the active file after completing each major step.
4. Once the work on that .md file is completed, the agent responsible for that work must do task execution cleanup (including committing, rebasing, and merging the work — see the **Merge Lifecycle** in the task execution section). Then rename the file to the commit hash of the commit that merges the worktree, and update the top of the file with a `# Commit History` section listing all commits associated with this work. Then move the file into the `_completed` sub-folder. If there is a filename conflict, add a seconds-based epoch timestamp as a suffix (e.g., `abc1234-1771520405.md`). IMPORTANT: The instruction file rename and move should also be included in the commit for that work — don't leave dangling uncommitted files behind from this work!

> **Between steps 4 and 5**: Follow the **Context Clearing Between Tasks** procedure below — print a task summary, then clear your conversation context before proceeding to the next task.

5. Then start on the `next available queued task`.
6. **When no more tasks can be claimed** (queue empty, or all remaining are `-active.md`, `-wip.md`, or dependency-blocked), run the **Orphan Recovery Protocol** (see below). If orphan recovery reclaims any tasks, continue the drain loop (go back to step 1).
7. **If no orphans were found**, the exit behavior depends on the agent's mode:

   **Orchestrator mode** (state file exists with matching PID): **Exit the drain loop immediately.** Print the status below and **stop executing** — literally do nothing more. The calling skill (`/epic` or `/saga`), which invoked `/q` as a sub-step, will resume its own lifecycle when it regains control. **Q does NOT read `returnTo`, does NOT run VERIFY/ADVANCE/BREAKDOWN/ITERATE/PR/COMPLETION, and does NOT interpret the state file beyond the PID check.** If there is no calling skill (i.e., the user invoked `/q` directly), then exiting the drain loop means the agent is done.

   ```
   --- Queue drained (orchestrator returning to lifecycle) ---
   Remaining: X blocked (depends-on), Y active (other agents), Z drafts (wip)
   ---
   ```

   **Worker mode** (no state file or PID mismatch): **Start waiting for new tasks** (see below). The agent stays alive indefinitely, waiting for new actionable files. If a file appears, stop waiting and go back to step 1 to claim and execute it.

   On exit, print a final status:
   ```
   --- Queue drained ---
   Remaining: X blocked (depends-on), Y active (other agents), Z drafts (wip)
   ---
   ```
   If the queue is fully empty, print instead:
   ```
   --- Queue empty ---
   ```

8. **Stop relay on exit (workers only).** After printing the final status (or at any other drain loop exit point — `epic-done` received, user termination), **worker-mode agents** call `/relay stop`. The smart stop is safe to call unconditionally: it refuses if other agents are still connected, and succeeds only if this agent is the last one out. **Orchestrator-mode agents skip this step** — the calling skill (`/epic` or `/saga`) manages relay lifecycle.

> **For parallel execution**, run `/q` in multiple terminal windows — the atomic rename mechanism ensures each task is claimed by exactly one agent.

### Task Ownership — STRICT SILO RULE

**Each task is fully owned by the single agent that claimed it.** Ownership begins the moment an agent renames a file to `XXX-active.md` (or takes over an orphaned `-active.md` file via the Orphan Recovery Protocol) and ends only when that agent moves the file to `_completed/`. During that window:

- **No other agent may touch the `XXX-active.md` file**, its associated worktree branch, or any commits on that branch.
- **No other agent may merge that worktree**, archive that queue file, or perform any cleanup on behalf of another agent's task.
- An agent working on task `XXX` must perform the **entire lifecycle itself**: claim → implement → merge → archive → cleanup. It must never delegate the merge or archive steps to a parent or sibling agent.
- If an agent spawns sub-agents for implementation work, those sub-agents must only perform implementation (code + commits). The **claiming agent** retains sole responsibility for merging, archiving the queue file, and removing the worktree.
- An agent in the drain loop **must not** pre-claim multiple tasks. It claims one task, completes it end-to-end (including cleanup), then claims the next.

> **Exception — Orphan Recovery:** When an agent determines that an `-active.md` task is orphaned (via the Orphan Recovery Protocol), it may take over ownership directly — without renaming the file back to pending first. This avoids an unnecessary race window. See **Orphan Recovery Protocol** below.

### Context Clearing Between Tasks

After completing a task (step 4 — archiving to `_completed`) and before starting the next task (step 5), the agent's behavior depends on its mode:

**Worker mode (default):** The agent MUST clear its conversation context to prevent token bloat from accumulating across sequential tasks. Each queued task is independent and does not need prior task context.

**Procedure (worker mode):**

1. **Print a brief task summary** (visible to the human watching the terminal):
   ```
   --- Task XXX completed ---
   Summary: <1-2 sentence description of what was done>
   Commit(s): <list of commit SHAs>
   ---
   ```

2. **Clear the conversation context** by running the `/clear` command. This is a built-in Claude Code CLI command — do NOT invoke it via the Skill tool. Simply output `/clear` as a message to reset the conversation. This drops all accumulated tool results, file contents, and intermediate reasoning from the completed task.

3. **After clearing**, resume the drain loop by checking for the next available task (step 5) with a fresh context window. Re-read any necessary skill files or project context as needed since prior context has been dropped.

**Orchestrator mode:** The agent **skips `/clear`** between tasks. The orchestrator needs to preserve its return-path context (which phase to resume, which epic/saga is active). Instead, it prints the task summary (step 1 above) and proceeds directly to scanning for the next task. If context grows excessively large, the orchestrator MAY `/clear` but MUST immediately re-read the orchestrator state file (`QUEUE_DIR/.orchestrator-state.json`) to recover its return path.

**Note:** This procedure only applies to the sequential drain flow (between tasks). It does NOT apply to standalone task execution.

### Orphan Recovery Protocol

When the drain loop reaches step 6 (no more claimable tasks), the agent MUST check for orphaned `-active.md` files before exiting. A task is orphaned when its owning agent has died — leaving the file in `-active` state with no one working on it.

**Detection procedure:**

For each `XXX-active.md` file in `QUEUE_DIR`:

1. **Read the `## Task Progress` section.** Extract `<!-- lat: ... -->` and `<!-- agent-pid: ... -->`.
2. **Check PID liveness:**
   ```bash
   kill -0 <agent-pid> 2>/dev/null && echo "alive" || echo "dead"
   ```
3. **Check LAT staleness:** Compare `<!-- lat: ... -->` to the current time. The threshold is **5 minutes**.
4. **Determine verdict:**

   | LAT fresh (< 5 min) | PID alive | Verdict |
   |----------------------|-----------|---------|
   | Yes | Yes | **Active** — skip, another agent is working |
   | Yes | No | **Recently died** — treat as orphaned |
   | No | Yes | **Slow but alive** — skip (agent may be in a long operation) |
   | No | No | **Orphaned** — reclaim |

   If no `## Task Progress` section exists (legacy file or agent died before writing one), fall back to the file's filesystem modification time (`stat -f %m` on macOS). If mtime is older than 5 minutes AND no Claude Code processes are running (`pgrep -f "claude" | wc -l` returns only the current agent's tree), treat as orphaned.

5. **If not orphaned**, skip this file.
6. **If orphaned**, proceed to **Takeover** below.

**Takeover procedure (no intermediate rename):**

The discovering agent takes over the orphaned task **directly** — it does NOT rename the file back to `XXX.md` first. This eliminates any race window with parallel agents.

1. **Log the takeover:**
   ```
   --- Reclaiming orphaned task XXX ---
   Previous agent PID: <pid> (dead)
   Last active: <lat timestamp>
   ---
   ```
2. **Update the `## Task Progress` section** in place:
   - Replace `<!-- agent-pid: ... -->` with the current agent's PID.
   - Replace `<!-- lat: ... -->` with the current timestamp.
   - Do NOT clear the checklist or handoff context — this is the successor agent's primary guide for resuming work.
3. **Check for an existing worktree:**
   - Read `<!-- worktree: ... -->` and `<!-- branch: ... -->` from the Task Progress section.
   - Run `git worktree list` to check if the worktree still exists.
   - **If the worktree exists:** Reuse it. Inspect the state of the code — check `git status`, `git log`, and the checklist to understand what was completed. Resume from the first unchecked item.
   - **If the worktree is gone:** Create a fresh worktree. Start from the first unchecked checklist item. If early items are checked, trust the checklist — the prior agent's commits may already be on the branch (verify with `git log`).
4. **Continue the normal task lifecycle** — implement remaining work, merge, archive, clean up. The task is now fully owned by the new agent under the standard silo rules.
5. **After completing (or if this was the only orphan)**, return to the drain loop (step 1) to check for more tasks.

**Edge cases:**

- **Multiple orphaned tasks:** Process them one at a time, lowest-numbered first (consistent with normal drain loop ordering). Complete one fully before taking over the next.
- **Orphaned task with unresolvable state** (e.g., worktree exists but has merge conflicts from a half-finished rebase): Clean up the worktree (`git rebase --abort` or remove and recreate), then restart the task from the last unchecked checklist item.
- **No Task Progress section and no mtime signal:** If you truly cannot determine whether the task is orphaned (no heartbeat data, mtime is recent, can't check PID), skip it and let a human investigate. Print a warning:
  ```
  --- Warning: task XXX is active but has no heartbeat data ---
  Cannot determine if orphaned. Skipping. Manual intervention may be needed.
  ---
  ```

### Idle Waiting for New Tasks

Idle waiting keeps **worker-mode** agents alive **indefinitely** while waiting for new work. Without it, the drain agent would exit immediately on an empty queue, requiring the user to manually re-run `/q`. The agent stays in idle waiting until work arrives or it receives an `epic-done` signal — there is no idle timeout.

**When idle waiting activates:** Step 7 of the drain loop — after the normal scan finds nothing claimable AND orphan recovery finds nothing to reclaim. **Only worker-mode agents start idle waiting.** Orchestrator-mode agents exit the drain loop instead (see step 7 above).

**Behavior depends on whether relay is running:**

#### Idle waiting with relay (preferred)

When `RELAY_RUNNING=true`, idle waiting uses the relay socket for instant event-driven wake-up instead of polling:

1. Print a status message:
   ```
   --- Waiting for new tasks (relay-connected, waiting indefinitely for events) ---
   ```
2. **Wait for a relay event** using a single blocking bash command:
   ```bash
   RESULT=$(node -e "
   const s = require('net').connect(process.argv[1]);
   const events = new Set(['work-queued','epic-done','worker-disconnected']);
   s.write(JSON.stringify({type:'identify',role:'worker',pid:+(process.env.PPID||0)})+'\n');
   const cycle = setTimeout(() => { console.log('IDLE_CYCLE'); s.destroy(); }, 9*60*1000);
   s.on('data', d => {
     for (const line of d.toString().split('\n').filter(Boolean)) {
       try {
         const msg = JSON.parse(line);
         if (msg.type === 'event' && events.has(msg.event)) {
           clearTimeout(cycle);
           console.log(JSON.stringify(msg));
           s.destroy();
         }
       } catch {}
     }
   });
   s.on('error', () => { clearTimeout(cycle); console.log('IDLE_RECONNECT'); s.destroy(); });
   " "$RELAY_SOCK")
   ```
   This runs as a **single tool call** with `timeout: 600000` (10 minutes). The script self-cycles before this limit is reached, so the Bash timeout should never fire — but setting it to the max provides a safety net.
3. **Interpret the result:**
   - **`work-queued`**: Return to the drain loop (step 1) to claim and execute the new task.
   - **`worker-disconnected`**: The event includes the dead agent's PID and tasks. Run the orphan recovery protocol (step 6) to check if any of those tasks can be reclaimed. Then return to step 1.
   - **`epic-done`**: Exit the drain loop gracefully with the standard final status message.
   - **`IDLE_RECONNECT`** (socket error): Run an orphan scan. If orphans are found, reclaim them and return to step 1. Otherwise, **resume waiting** (go back to step 2) — do NOT exit the drain loop.
   - **`IDLE_CYCLE`** (internal timeout — keeps idle waiting alive across Bash tool timeout boundaries): **Resume waiting** (go back to step 2). This is normal housekeeping, not an error.
   - **Empty output or unexpected result** (Bash timeout fired, process killed, sleep/wake disruption): Treat identically to `IDLE_CYCLE` — resume waiting. Log a brief note: `--- Idle cycle (recovered from stale connection) ---`

#### Idle waiting without relay (fallback)

When relay is not running, idle waiting falls back to filesystem polling:

1. Print a status message:
   ```
   --- Waiting for new tasks (polling indefinitely) ---
   ```
2. **Poll the queue** using a single bash command that checks every 15 seconds:
   ```bash
   QUEUE_DIR=".ai-queue"
   START=$(date +%s)
   while true; do
     # Check for pending files (not -active, not -wip)
     FOUND=$(ls "$QUEUE_DIR"/*.md 2>/dev/null | xargs -I{} basename {} | grep -v -E '(-active|-wip)\.md$' || true)
     if [ -n "$FOUND" ]; then
       echo "ACTIONABLE: $FOUND"
       exit 0
     fi
     NOW=$(date +%s)
     if [ $((NOW - START)) -ge 540 ]; then
       echo "IDLE_CYCLE"
       exit 0
     fi
     sleep 15
   done
   ```
   This runs as a **single tool call** with `timeout: 600000` (10 minutes). The script self-cycles after ~9 minutes, before the Bash timeout fires — but setting it to the max provides a safety net.
3. **Interpret the result:**
   - **`ACTIONABLE: ...`** (actionable files found): Stop waiting and return to the drain loop (step 1) to claim and execute the task normally.
   - **`IDLE_CYCLE`** (internal timeout — keeps idle waiting alive across Bash tool timeout boundaries): **Resume waiting** (go back to step 2). This is normal housekeeping, not an error.
   - **Empty output or unexpected result** (Bash timeout fired, process killed, sleep/wake disruption): Treat identically to `IDLE_CYCLE` — resume waiting. Log a brief note: `--- Idle cycle (recovered from stale connection) ---`

#### Common idle waiting behavior

**Idle waiting runs indefinitely.** The agent stays in idle waiting until work arrives, an `epic-done` signal is received, or the user manually terminates the agent (e.g., Ctrl+C). There is no idle timeout — the agent is always ready to pick up new work the moment it's queued.

**Idle waiting does NOT activate when:**
- The agent is in **orchestrator mode** (state file exists with matching PID) — the orchestrator exits the drain loop to return to the calling skill's lifecycle.
- The agent was invoked with `q {description}` (enqueue mode) — that flow creates files and exits, it never drains.

---

## `q {Task description}` — Enqueue a Task

### Syntax
```
q {Task description}
q --no-segment {Task description}
q --no-auto {Task description}
q --no-segment --no-auto {Task description}
```

By default, `q {description}` uses **segment mode** (breaks the task into independent sub-tasks) and **auto-queue** (queues immediately without confirmation). Use opt-out flags to change this:

| Flag | Effect |
|------|--------|
| `--no-segment` | Create a single instruction file instead of segmenting |
| `--no-auto` | Require user confirmation before queuing |

Flags can appear anywhere in the arguments and will be stripped before treating the rest as the task description.

### Disambiguation

- `q` alone (no further text) → drain the queue
- `q --no-segment ...` or `q --no-auto ...` → enqueue mode (flags are unambiguous)
- `q {any other text}` → enqueue mode (the text is the task description)

### Example
```
q Overhaul the component library for accessibility compliance
q --no-segment Create an example dating app in the ./examples folder
q --no-auto Do a major accessibility audit and fix all issues
q --no-segment --no-auto Refactor the auth module
```

### !! CRITICAL: DO NOT IMPLEMENT !!

> **This command is purely administrative. Do NOT perform any implementation, run any tools, edit any files, or execute any code related to the task description. Your only job here is to author the instruction file(s) and confirm with the user. All actual work happens later, when an agent actions the queued task.**

### Definition

First, parse the arguments: check if `--no-segment` and/or `--no-auto` are present among the arguments. If so, remove them and enable the corresponding opt-outs. The remaining text is the `{Task description}`.

By default (no flags), both segment mode and auto-queue are enabled.

#### Segment Mode (default, disabled by `--no-segment`)

When segment mode is active, the agent must **analyze the task description** and break the work into multiple smaller, independent queued instruction files instead of creating a single file. Each segment should be a logically cohesive unit of work that can be completed independently in its own worktree.

**Procedure for segment mode:**
1. Analyze the `{Task description}` — research the codebase as needed to understand the scope.
2. Identify natural segmentation boundaries (e.g., by component, by concern, by layer).
3. Create multiple `XXX-wip.md` files, one per segment, with sequential numbering starting from the next available number.
4. Each segment file contains detailed instructions for its specific portion of the work.
5. **If auto-queue is enabled (default)**, each segment is auto-queued (immediately renamed from `-wip` to `.md` without confirmation). **If auto-queue is disabled (`--no-auto`)**, run the **Segment Review Walkthrough** (see below).

**Segmentation guidelines:**
- Each segment should be completable in a single worktree session.
- **File-disjoint (CRITICAL):** No two segments may modify the same file. Each segment MUST include a `## Scope` section listing the exact files it will create or modify. Before finalizing segments, cross-check all `## Scope` sections — if any file appears in more than one segment, restructure the split or use the integration segment pattern.
- **Integration segment pattern:** When multiple segments genuinely need a shared file (e.g., a barrel export, a page that imports new components, a config file), designate ONE segment as the "integration segment." This segment:
  - Is always the **highest-numbered** segment so it runs last.
  - Owns the shared file(s) exclusively — no other segment touches them.
  - Includes `<!-- depends-on: 001, 002, ... -->` on its second line (after `<!-- auto-queue -->` if present) listing the segment numbers it depends on.
  - An agent in the drain loop MUST NOT claim a segment with `depends-on` until all listed task numbers have no file remaining in `QUEUE_DIR` (i.e., fully archived to `_completed/`). This includes `-wip.md`, plain `.md`, and `-active.md` files — any file with that number blocks the dependency.
- Each segment's instructions must be self-contained — a future agent should not need context from other segments (except for the integration segment, which may reference what earlier segments produced).
- Name each segment file with a clear title in the markdown heading.
- **Splitting heuristic — prefer splitting by module/directory:** A segment that owns `src/components/Button/**` will never conflict with one that owns `src/components/Select/**`. Split along directory boundaries when possible. Only share files like top-level barrel exports, route configs, or example pages — and route those to the integration segment.

#### Segment Review Walkthrough (`--no-auto` + segment mode)

When `--no-auto` is used with segment mode, walk the user through each segment individually. This keeps reviews focused and efficient — the user sees only what they need to approve, not raw instruction files.

**IDE command resolution:** Before starting the walkthrough, resolve the IDE command for the "open in IDE" option. Check these sources in order, using the first one found:
1. The user's global `CLAUDE.md` — look for an "IDE command" preference (e.g., `code`, `cursor`)
2. The `$VISUAL` environment variable
3. The `$EDITOR` environment variable
4. Auto-detect: check `$PATH` for `code`, `cursor`, `zed`, `subl` (first match wins)

Store the resolved command for use in step 2. If the resolved command is a terminal editor (e.g., `vim`, `nano`, `emacs`), skip the "open in IDE" option — terminal editors would block the agent's shell.

**Procedure:**

1. **Present an overview** of all created segments:
   ```
   Created N segments for review:
     001-wip.md — {segment title} (~X files)
     002-wip.md — {segment title} (~X files)
     003-wip.md — {segment title} (~X files, integration — depends on 001, 002)
   ```

2. **For each segment** (in order), present an executive summary and ask for approval:
   ```
   --- Segment 001: {title} ---
   Scope: {list of files/directories from ## Scope section}
   Summary: {2-3 sentences — what this segment does and why}
   Dependencies: none | depends on 001, 002
   ---
   (y) Queue  ·  (n) Request changes  ·  (o) Open in IDE
   ```

   Do NOT dump the full instruction file — only the executive summary above.

   - **y (queue):** Rename `XXX-wip.md` → `XXX.md`. Confirm briefly (e.g., "Queued 001.") and move to the next segment.
   - **n (request changes):** Ask `What should change?`. Refine the instruction file based on the user's feedback. Re-present the updated summary and ask again. Repeat until approved, or the user explicitly says to drop the segment (delete the `-wip.md` file).
   - **o (open in IDE):** Open the file in the user's IDE via Bash:
     ```bash
     {ide_command} .ai-queue/XXX-wip.md
     ```
     Then tell the user the file is open and ask them to reply when they're done reviewing (or editing). After the user responds:
     - If they made edits to the file, re-read it and re-present the updated summary.
     - Ask `Queue this segment? (y / n / o)` again.

3. **After all segments are reviewed**, print a final summary:
   ```
   --- Review complete ---
   Queued: 001, 002, 003
   Dropped: (none, or list any removed during review)
   ---
   ```

#### Single-File Mode (`--no-segment`)

For whatever `{Task description}` is passed, do the following:
1. Determine the next available number: list all `.md` files directly in `QUEUE_DIR` (excluding subfolders — do NOT look inside `_completed/` or any other subfolder, and do NOT use prior conversation context or memory to infer past task numbers). Read the **first 3 characters** of each filename as its number. If there are no `.md` files, the next number is `001`. Otherwise, find the largest number and add 1. For instance, if the folder contains `003-active.md`, `004.md`, and `005-wip.md`, the numbers in use are `003`, `004`, and `005`, so the next file should be `006-wip.md`. If the folder is empty (all tasks completed/archived), the next file should be `001-wip.md`.
2. Create a new `.md` instruction file named `XXX-wip.md` (e.g., `006-wip.md`) in `QUEUE_DIR`.
3. In this file, write out any instructions that you come up with in response to the `{Task description}`. If you need any clarification or follow-up information, ask. Do NOT implement anything — write instructions for a future agent to follow. **If auto-queue is enabled (default)**, the very first line of the file must be `<!-- auto-queue -->` (an HTML comment that serves as a machine-readable marker recording that this file was auto-queued). The rest of the content follows after this marker line. **Every task instruction file MUST include a `## Scope` section** listing the files that will be created or modified. This enables parallel agents to detect overlap. If the exact files aren't known up front, list directories with globs (e.g., `src/components/Button/**`).
4. **If auto-queue is disabled (`--no-auto`)**: Once the instructions are fully written, provide a very concise summary and/or checklist of tasks for those instructions, and ask `Ready to queue?` as a `yes` or `no` question. If the user says `yes`, then remove the `-wip` suffix (e.g., rename `006-wip.md` → `006.md`). If the user says `no`, ask `What changes should we make?` and following this new response to further update the instructions file, then repeat this step to confirm if we're ready to queue the file.
5. **If auto-queue is enabled (default)**: Once the instructions are fully written, immediately rename `XXX-wip.md` → `XXX.md` (removing the `-wip` suffix) without asking for confirmation. Inform the user that the task has been auto-queued (e.g., "Task 009 has been auto-queued.").

---

## Internal: Task Execution in Worker Tree

> **This is an internal procedure used by the drain loop to execute claimed tasks. It is not a user-facing command.**

### Definition

This procedure creates a separate git worktree for a task, works within that worktree, and merges + cleans up when done.

IMPORTANT: When available, use the `worktree-manager` skill to manage this requirement, including removing the worktree once the work is successfully completed.

### Target Branch Resolution

Before creating the worktree, check the instruction file for a `<!-- target-branch: <branch> -->` directive. If present, use `<branch>` as the base and merge target. If absent, use the current branch (typically `main`).

### Heartbeat Updates During Execution

While working in the worktree, the agent MUST periodically update the `## Task Progress` section in the **active file** (which lives in the main working directory's `QUEUE_DIR`, NOT in the worktree). After completing each checklist item:
1. Check off the completed item.
2. Mark the next item with `**ACTIVE** →`.
3. Update `<!-- lat: ... -->` to the current UTC timestamp.
4. Add any useful notes to `### Handoff Context`.

This ensures that if the agent dies, the next agent can pick up where it left off.

### Merge Lifecycle

When merging a worktree back to the target branch, always follow this sequence:

1. **Commit all work** in the worktree branch.
2. **Rebase onto the latest target branch** before merging:
   ```bash
   # Inside the worktree
   git fetch origin
   git rebase origin/<target-branch>   # from directive, or main if no directive
   ```
   If there are rebase conflicts, resolve them in the worktree. This ensures the worktree branch incorporates all work that other agents may have merged since this branch was created.
3. **Switch to the target branch** and merge:
   ```bash
   git checkout <target-branch>   # from directive, or main if no directive
   git merge <worktree-branch> --no-ff
   ```
4. **Clean up** — remove the worktree and delete the branch via `worktree-manager`.

This rebase-before-merge step is what makes parallel work safe: each merge is guaranteed to be additive on top of all prior merges.
