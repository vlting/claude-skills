---
name: orchestrate
description: "Plan, scope, and execute development initiatives — single-epic or multi-epic — through an iterative stage-based workflow."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.1.0
---

# Orchestrate

Plans and executes development goals through stages. Each stage breaks down into tasks queued for `/q` workers. Handles everything from single features to multi-epic initiatives.

All planning is done via `/council` — orchestrate never plans in isolation.

```
/orchestrate {goal}          — Start new initiative (council plans it)
/orchestrate                 — Resume active orchestration
/orchestrate --auto          — Start or resume with auto mode (council runs non-interactively, PRs auto-merge)
orchestrate init             — First-time repo setup
orchestrate update           — Modify an active roadmap
orchestrate status           — Show progress
orchestrate abort            — Abort (preserves all work)
```

**Disambiguation:**
- `/orchestrate` alone → resume active orchestration
- `/orchestrate {text}` → new initiative
- `/orchestrate --auto` → autonomous mode: `/council --auto` for planning, auto-merge for shipping
- `/orchestrate update` → interactively modify an active roadmap
- If `--auto` was set at creation, it persists — bare `/orchestrate` reads it automatically

---

## Architecture

```
orchestrate (this skill)              council (planning)         q (execution)
┌─────────────────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ SCOPE+PLAN ──────────────────────▶ │ /council {goal}  │      │                  │
│   (delegates to council)    │ ◀─── │ → reconciled plan│      │                  │
│ STRUCTURE (branch, roadmap) │      └──────────────────┘      │                  │
│ BREAKDOWN (per stage) ────────────────────────────────────▶  │ drain loop       │
│ EXECUTE (wait for q) ◀──────────────────────────────────────  │ (worktree tasks) │
│ VERIFY → ITERATE / ADVANCE │      │                  │      │                  │
│ SHIP (rebase, final PR)    │      │                  │      │                  │
└─────────────────────────────┘      └──────────────────┘      └──────────────────┘
```

**Terminal model:** T1 runs `/orchestrate`, T2-T4 run `/q`. Workers stay alive across stages and epics via relay events.

**File layout:**
```
.ai-orchestrate/
  config.yml                ← integrations list (optional)
  roadmaps/{slug}.md        ← active roadmaps (includes Overview)
  docs/{slug}/tech-spec.md  ← optional per-epic tech specs
  archive/                  ← completed roadmaps
.ai-queue/                  ← task files (gitignored)
.ai-relay/                  ← relay runtime (gitignored)
```

---

## Relay (inline)

The relay server enables instant inter-agent communication via Unix domain sockets. `server.js` lives at `~/.claude/skills/relay/server.js`.

**Check if running:**
```bash
RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
RELAY_RUNNING=false
if [ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]; then
  RELAY_RUNNING=true
fi
```

**Start (if not running):**
```bash
mkdir -p .ai-relay
nohup node ~/.claude/skills/relay/server.js "$(pwd)/.ai-relay" > .ai-relay/relay.log 2>&1 &
# Wait up to 2s for relay.sock to appear
```

**Send event:**
```bash
node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'event',event:process.argv[2]})+'\n');
setTimeout(() => s.destroy(), 500);
" "$RELAY_SOCK" "work-queued"
```

**Smart stop** (last agent out): Connect, query status. If `liveAgents === 0`, `kill $(cat .ai-relay/relay.pid)`. Otherwise no-op.

**Events:** `work-queued` (wake workers), `task-claimed`, `task-completed`, `epic-done` (workers exit).

---

## Phase 0+1: PLAN (via `/council`)

Planning is **fully delegated** to `/council`. Orchestrate never scopes or plans in isolation.

### Flow

1. **Invoke council:**
   - Standard: `/council {goal}` — enters plan mode, presents plan to user, user resolves any open tensions
   - Auto: `/council {goal} --auto` — runs non-interactively, all tensions auto-resolved, plan returned immediately

2. **Council output:** A reconciled plan with numbered steps, key decisions, and risk summary. This becomes the basis for the roadmap.

3. **If council surfaces open tensions (standard mode):** User resolves them interactively during the council phase. By the time council completes, the plan is fully resolved.

4. **Convert council plan → roadmap structure:**
   - Generate a slug (short, kebab-case)
   - Map council plan steps → stages with acceptance criteria
   - Council's key decisions → Overview section
   - Council's risk summary → preserved in roadmap metadata

### After council completes

5. **Create the epic branch:**
   ```bash
   git checkout main && git pull origin main
   git checkout -b epic/{slug}
   git push -u origin epic/{slug}
   ```

6. **Feature flag (optional).** If `config/flags.ts` exists, add a flag for the new feature (default `false`, overrides `{dev: true, staging: true}`). If no flags file → skip entirely.

7. **Write the roadmap** at `.ai-orchestrate/roadmaps/{slug}.md`:

   ```markdown
   ---
   slug: {slug}
   status: planning
   created: YYYY-MM-DD
   ---
   # {Title}

   ## Overview
   {From council plan — goals, scope, key decisions}

   ## Metadata
   - **Epic branch:** epic/{slug}
   - **PR:** #{N} (filled after step 8)
   - **Created:** YYYY-MM-DD
   - **Auto-merge:** {true if --auto, false otherwise}
   - **Integrations:** {from config.yml or "none"}
   - **Risk summary:** {from council}

   ## Stage 1: {title}
   **Branch prefix:** feat|fix|chore|docs
   **Acceptance criteria:**
   - [ ] {criterion}
   **Status:** pending

   ## Stage 2: {title}
   ...
   ```

8. **Load integrations** (see Integrations section). If configured: create tracking ticket, add it to project board in Planning status, create draft PR linking to roadmap. If none: just create the draft PR with `gh pr create --draft` (git is always available).

9. **Commit roadmap to main:**
   ```bash
   git checkout main
   git add .ai-orchestrate/roadmaps/{slug}.md
   git commit -m "docs({slug}): add roadmap"
   git push origin main
   git checkout epic/{slug}
   ```

10. **Orchestrator state file** — write `.ai-queue/.orchestrator-state.json`:
    ```json
    {
      "role": "orchestrator",
      "pid": $PPID,
      "epic": {
        "roadmap": ".ai-orchestrate/roadmaps/{slug}.md",
        "currentStage": 1,
        "returnTo": "breakdown"
      }
    }
    ```
    This enables post-`/clear` recovery. Always include a `saga` field when running multi-epic mode.

11. **Ensure relay is running.** Start if needed (see Relay section).

12. **Present summary** and proceed to BREAKDOWN for Stage 1.

---

## Integrations

Core orchestrate is PM-agnostic. Integrations are optional plugins that map abstract actions to concrete CLI commands.

**Config:** `.ai-orchestrate/config.yml`
```yaml
integrations: [github]   # or: [] or omit entirely
```

**Loading:** When an abstract action is needed (e.g., "create tracking ticket"), check `config.yml`. If an integration is listed, read `~/.claude/skills/orchestrate/integrations/{name}.md` for the concrete commands. If no integration configured → skip the action silently.

**Abstract actions** (referenced throughout phases):
- `create-ticket` — create a tracking issue/ticket
- `create-pr` — create a draft PR (git fallback: `gh pr create --draft`)
- `link-ticket` — link a sub-ticket to a parent
- `close-ticket` — close a ticket with comment
- `move-status` — update ticket status on a board

**`orchestrate init`** auto-detects available CLIs (`gh`, `linear`, `jira`) and asks which to activate. Writes `config.yml`.

---

## Phase 2: BREAKDOWN (per stage)

1. **Research the codebase** for this stage's scope. Read relevant files, understand current state.

2. **Create the stage branch:**
   ```bash
   git checkout epic/{slug}
   git checkout -b {prefix}/{slug}/{stage-title-slug}
   git push -u origin {prefix}/{slug}/{stage-title-slug}
   ```
   Prefix is `feat/`, `fix/`, `chore/`, or `docs/` based on stage nature.

3. **Segment the stage into file-disjoint tasks.** Each task touches different files (parallel-safe). Write instruction files to `.ai-queue/` using q's file naming (`XXX.md`). Include in each file:
   ```markdown
   <!-- auto-queue -->
   <!-- target-branch: {prefix}/{slug}/{stage-title-slug} -->
   # Task: {title}
   {Implementation instructions with specific file paths and acceptance criteria}
   ```

4. **Send `work-queued` event** via relay. Workers wake instantly.

5. **Update state file:** `currentStage: N`, `returnTo: "execute"`.

---

## Phase 3: EXECUTE

Enter the wait loop. Workers (`/q`) claim and execute tasks.

- With relay: block on socket events (`task-completed`, `worker-disconnected`).
- Monitor progress: check `.ai-queue/` for remaining pending/active files.
- When all tasks for this stage are in `_completed/` → proceed to VERIFY.

---

## Phase 4: VERIFY

1. **Checkout the stage branch.** Pull latest.
2. **Run verification:**
   - `npm run build` (or project equivalent)
   - `npm run lint`
   - `npm test`
   - Check each acceptance criterion from the roadmap stage. **Check off (`- [x]`) each criterion that passes** in the roadmap file.
3. **Result:**
   - All pass → ADVANCE
   - Failures → ITERATE (already-checked criteria stay checked)

---

## Phase 5: ITERATE

1. Analyze failures. Identify root cause.
2. Write fix instruction files to `.ai-queue/` targeting the same stage branch.
3. Send `work-queued`. Return to EXECUTE.

**Limits:** 5 iterations per stage, 20 total across all stages. Exceeding → HALT (notify user, pause).

---

## Phase 6: ADVANCE

1. **Create stage PR** to epic branch:
   ```bash
   gh pr create --base epic/{slug} --head {prefix}/{slug}/{stage-title-slug} \
     --title "Stage N: {title}" --body "Closes stage N of {slug}"
   ```

2. **Merge stage PR** (squash or merge):
   ```bash
   gh pr merge --merge --delete-branch
   ```

3. **Update epic PR body (REQUIRED):** Check off the completed stage and link the stage PR number. Use `update-epic-pr` integration action. This keeps the epic PR as a living progress summary.

4. **Update epic issue body (REQUIRED):** Check off the completed stage checkbox and link the stage PR number. Use `update-epic-issue` integration action.

5. **Update roadmap:** Mark stage done (all acceptance criteria should already be `- [x]` from VERIFY). If integration: close sub-ticket, move board status to Done. **Epic/saga tickets go directly from Planning → Done at SHIP. NEVER move them to Todo, In Progress, or In Review.**

6. **More stages?** → BREAKDOWN for next stage.
   **All stages done?** → SHIP.

7. **Update state file** for next stage or ship phase.

---

## Phase 7: SHIP

1. **Rebase epic branch on main:**
   ```bash
   git checkout epic/{slug} && git fetch origin main && git rebase origin/main
   git push --force-with-lease origin epic/{slug}
   ```

2. **Remove feature flag** (if one was added). Delete the flag from `config/flags.ts`, remove all flag checks from code.

3. **Update the epic PR:** Mark ready for review. Update body with completed stages checklist.

4. **Auto-merge (if enabled):** Wait for CI (`gh pr checks` every 15s, timeout 10min). If green → `gh pr merge --merge --delete-branch`. On conflict → rebase + resolve + retry once. On failure → notify, fall back to manual.

5. **Update saga tracking (multi-epic only):**
   - Use `update-saga-issue` action: check off the completed epic checkbox in the saga issue body, linking the epic PR
   - This keeps the saga issue as a living progress summary across epics

6. **Cleanup:**
   - Archive roadmap: move to `.ai-orchestrate/archive/`
   - Delete orchestrator state file
   - If integration: close tracking ticket, move board status directly from Planning → Done (see `move-to-done` in integration docs). **Epic/saga tickets skip Todo/In Progress/In Review entirely.**
     - For multi-epic: move the individual epic issue from Planning → Done on the board
     - After final epic: also move the saga issue from Planning → Done on the board
   - Send `epic-done` via relay (workers exit)
   - Call relay smart stop
   - Commit archive to main

7. **Print summary:**
   ```
   --- Shipped: {title} ---
   PR: #{N} — ready for review (or merged if auto-merge)
   Stages delivered: {N}
   ---
   ```

---

## Multi-Epic Mode

For broad goals that decompose into multiple epics. Same roadmap file, epics grouped as top-level sections.

### Planning (multi-epic)

Council is invoked once for the full initiative. The reconciled plan identifies natural epic boundaries. Orchestrate converts these into the multi-epic roadmap format.

For each epic, council may be re-invoked for detailed stage planning if the epic scope warrants it:
- Simple epic (1-2 stages) → orchestrate derives stages directly from the council plan
- Complex epic (3+ stages) → `/council "Detail stages for epic: {title}" --auto` (always `--auto` for sub-planning, even in standard mode)

### Roadmap format (multi-epic)

```markdown
---
slug: {slug}
status: in-progress
created: YYYY-MM-DD
---
# {Title}

## Overview
{Goals, scope, key decisions from council plan}

## Metadata
- **Created:** YYYY-MM-DD
- **Auto-merge:** false
- **Integrations:** github

## Epic 1: {title}
**Objective:** {what this delivers}
**Dependencies:** none
**Epic slug:** {epic-slug}
**Epic branch:** epic/{epic-slug}
**Tech spec:** .ai-orchestrate/docs/{epic-slug}/tech-spec.md
**Status:** pending | in-progress | complete | skipped

### Stage 1.1: {title}
...

## Epic 2: {title}
**Dependencies:** Epic 1
...
```

### Execution

1. **Sequentially execute epics** in dependency order. For each epic:
   - Write tech spec at `.ai-orchestrate/docs/{epic-slug}/tech-spec.md`
   - Create epic branch, run the full PLAN → BREAKDOWN → EXECUTE → VERIFY → ITERATE → ADVANCE → SHIP cycle.
   - Between epics: `/clear` context. Compare output against Overview (drift check).

2. **Worker lifecycle:** Between epics send `work-queued` (keeps workers alive). Only send `epic-done` after the **last** epic completes.

3. **Drift check:** Minor drift → log and continue. Significant drift → pause, notify user.

4. **State file** includes `saga` field for multi-epic recovery:
   ```json
   {
     "role": "orchestrator",
     "pid": $PPID,
     "saga": {
       "roadmap": ".ai-orchestrate/roadmaps/{slug}.md",
       "currentEpic": 2,
       "autoMerge": true
     },
     "epic": {
       "roadmap": ".ai-orchestrate/roadmaps/{slug}.md",
       "currentStage": 1,
       "returnTo": "verify"
     }
   }
   ```

---

## Roadmap Format (single epic)

```markdown
---
slug: {slug}
status: planning | in-progress | done | aborted
created: YYYY-MM-DD
---
# {Title}

## Overview
{Goals, scope, key decisions — from council plan}

## Metadata
- **Epic branch:** epic/{slug}
- **PR:** #{N}
- **Created:** YYYY-MM-DD
- **Auto-merge:** false
- **Integrations:** {list or "none"}

## Stage 1: {title}
**Branch prefix:** feat
**Acceptance criteria:**
- [ ] {criterion}
**Stage PR:** #{N}
**Status:** pending | in-progress | done
**Iterations:** 0

## Stage 2: {title}
...
```

---

## `orchestrate status`

```
{Title}
Status: {status}
Roadmap: .ai-orchestrate/roadmaps/{slug}.md

Stages:
  1. {title} — done ✓
  2. {title} — in-progress (iteration 2)
  3. {title} — pending
```

For multi-epic, show epic-level progress with stage summaries.

---

## `orchestrate abort`

1. Do NOT delete branches, roadmaps, or completed work.
2. Set roadmap status to `aborted`.
3. If integration: close ticket with "Aborted. Work preserved."
4. Send `epic-done` (workers exit). Smart stop relay.
5. Print where to find preserved work.

---

## `orchestrate init`

1. Auto-detect git remote (`owner/repo`).
2. Create directories: `.ai-orchestrate/{roadmaps,docs,archive}`, `.ai-queue/`, `.ai-relay/`.
3. Detect available CLIs: `gh --version`, `linear --version`, `jira --version`.
4. Ask user which integration to activate (or none).
5. Write `.ai-orchestrate/config.yml`.
6. Add `.ai-queue/` and `.ai-relay/` to `.gitignore` if not present.
7. Print summary.

---

## `orchestrate update`

Interactively modify an active roadmap with safe guards and integration side-effects.

1. **List active roadmaps.** Scan `.ai-orchestrate/roadmaps/` for files where frontmatter `status` is not `done` or `aborted`. If none → print "No active roadmaps." and stop. Otherwise AskUserQuestion with a numbered list.

2. **Read selected roadmap.** Parse type (saga vs single-epic), full structure, and per-stage/epic statuses.

3. **Prompt for changes.** AskUserQuestion: "What changes do you want to make to this roadmap?"

4. **Generate diff summary.** Compact before/after showing:
   - `+` additions (new stages/epics/criteria)
   - `~` modifications (title, criteria, or scope changes)
   - `-` removals (deleted pending stages/epics/criteria)

5. **Confirm loop.** AskUserQuestion: "Apply these changes?" Options: "Yes, apply" / "Let me revise" (free-text). Loop steps 3–5 until confirmed or user cancels. Max 3 loops → stop and print the last diff for manual editing.

6. **Apply changes.** Write updated roadmap. Preserve all execution metadata: PR numbers, issue IDs, board IDs, iteration counts, checkmarks on completed criteria, stage PR references.

7. **Side-effects:**
   - **State file:** Adjust `currentStage` / `currentEpic` indices in `.ai-queue/.orchestrator-state.json` if structure shifted (e.g., stage inserted before current).
   - **New epics (saga):** Create branch (`epic/{epic-slug}`), create tracking ticket if integration configured.
   - **Title changes:** `gh issue edit` if GitHub integration active and issue exists for the item.
   - **Removed pending items:** Close associated tickets/issues with comment "Removed from roadmap."

8. **Commit.**
   ```bash
   git checkout main
   git add .ai-orchestrate/roadmaps/{slug}.md
   git commit -m "docs({slug}): update roadmap"
   git push origin main
   git checkout -   # return to previous branch
   ```

9. **Print summary.** Show what changed: additions, modifications, removals, and any integration actions taken.

### Constraints

- **Cannot update `done` or `aborted` roadmaps.** Filter these out in step 1.
- **Cannot remove or reorder `in-progress` or `done` stages/epics** — only `pending` items can be removed or reordered.
- **Editing titles/criteria on `in-progress` stages is allowed** (scope refinement) but not status changes.

---

## Resume (`/orchestrate` bare)

1. **Check state file first.** If `.ai-queue/.orchestrator-state.json` exists and `pid` matches `$PPID`, recover from it. If it has `saga` + `epic` fields → resume mid-epic. If `saga` only with `returnTo: "review"` → resume drift check between epics.

2. **No state file?** Scan `.ai-orchestrate/roadmaps/` for `status: in-progress`. If none → "No active orchestration. Use `/orchestrate {goal}` to start one."

3. **Read `Auto-merge` from roadmap metadata.** If `true`, behave as if `--auto` was passed (auto-merge enabled).

4. **Ensure relay running.** Determine current state from roadmap/state file.

5. **Enter the appropriate phase** and continue the lifecycle loop.

---

## Error Handling

| Error | Action |
|-------|--------|
| Stage iteration limit (5/stage) | HALT. Notify user. Wait for input. |
| Total iteration limit (20) | HALT. Notify user. Wait for input. |
| Merge conflict (auto-merge) | Rebase + resolve. Retry once. Fall back to manual. |
| CI failure (auto-merge) | Notify. Fall back to manual. |
| Dependency deadlock (multi-epic) | HALT. Notify user. |
| Relay fails to start | Continue without relay (q falls back to polling). |

**Notifications:** If ntfy topic configured in roadmap metadata (`notification-topic: {topic}`):
```bash
curl -s -d "$MESSAGE" "ntfy.sh/$TOPIC" > /dev/null 2>&1
```
Fallback: `osascript -e "display notification \"$MSG\" with title \"Orchestrate\""`. Last resort: print to terminal.
