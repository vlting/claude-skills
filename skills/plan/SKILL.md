---
name: plan
description: "Interactive planning + orchestration. Approval-gated workflow covering saga→epic→task hierarchy via progressive scoping."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Plan

Interactive, approval-gated planning and orchestration. Every unit of work is reviewed before creation and before merge.

```
/plan {goal}          — start new initiative
/plan                 — resume current initiative
/plan status          — show hierarchy dashboard
```

---

## Flow

```
SCOPE → BREAKDOWN → EXECUTE → VERIFY → ADVANCE
  ↑        ↑          ↑         ↑         ↑
  gate     gate      (q runs)   gate      gate
```

Every gate = **Review Card**. User must approve before proceeding.

---

## Scope Detection

Determine hierarchy depth from the goal:

| Scope | Detection | Flow |
|-------|-----------|------|
| Small | Single task, clear files | Skip to EXECUTE |
| Medium | Multi-stage, one epic | BREAKDOWN into tasks |
| Large | Multi-epic initiative | SCOPE into epics first |

Always announce: `"Detected {scope} scope. {plan}."`
User can override: `"Actually, just one epic."`

---

## Council Integration (Mandatory)

`/council` is the quality firewall. Invoke via the `Skill` tool at these points:
- **SCOPE phase:** `/council {goal} --subroutine` — full deliberation on initiative design
- **BREAKDOWN phase:** `/council "Plan stage: {title}" --subroutine` — per-stage approach

Always full deliberation (4-7 personas). `--subroutine` returns the plan directly without user interaction — /plan handles all user gates via Review Cards.

---

## State

Single roadmap file per initiative: `.ai-plans/{slug}/roadmap.md`

```markdown
---
slug: {slug}
status: scoping | planning | in-progress | verifying | done | aborted
scope: small | medium | large
created: YYYY-MM-DD
current_epic: 1
current_stage: 1
phase: scope | breakdown | execute | verify | advance
---
# {Title}

## Overview
{Goals, scope, key decisions — from council}

## Epic 1: {title}
**Status:** pending | in-progress | done
**Branch:** epic/{slug}

### Stage 1.1: {title}
**Status:** pending | in-progress | done
**Branch:** feat/{slug}/{stage-slug}
**Acceptance criteria:**
- [ ] {criterion}
**Tasks:**
- [ ] {task description} → {files}
```

Committed to git — survives `/clear`. Everything else is derived.

For **small scope** (single task): roadmap has no epics/stages — just a task section.
For **medium scope** (single epic): roadmap has stages but no epic grouping.

---

## The Review Card

Universal format at every gate, every level. Use `AskUserQuestion` to present.

```
[LEVEL] Title
─────────────────────────────
Summary:  • bullet 1  • bullet 2  • bullet 3
Scope:    files/areas affected
SoW:      what the AI will do if approved (one line, active voice)
Risk:     one line

(y) approve  (n) reject + feedback  (?) expand  (o) open in IDE
```

### Rules
- ≤7 lines default view. Scannable in <5 seconds.
- `?` expands: acceptance criteria, alternatives considered, full detail
- `?3` drills into item 3
- `[LEVEL]` prefix: `[SAGA]`, `[EPIC]`, `[STAGE]`, `[TASK]`
- Auto-expand for `high` risk items

### Batch Review

When presenting multiple items at same level (e.g., 8 tasks):
1. Show numbered list (one line each)
2. Options: `(a)` approve all, `(1-8)` drill into one, `(w)` walkthrough sequentially
3. Batch summary highlights outliers (highest risk, largest scope)

### Rejection Flow

User responds `n` + feedback:
1. Refine ONLY the rejected item
2. Re-present its card
3. Max 3 iterations per item
4. After 3 → suggest: `(o)` open in IDE for manual edit
5. Never re-plan already-approved items

---

## Phase 1: SCOPE

1. **Invoke `/council {goal} --subroutine`** via the `Skill` tool — full deliberation
2. **Parse council output** — extract plan steps, key decisions, risks
3. **Detect scope** (small/medium/large) from council's plan structure
4. **Present Review Card:**

For **large scope** (multi-epic):
```
[SAGA] {Title}
─────────────────────────────
Summary:  • {what}  • {why}  • {approach}
Scope:    {packages/areas affected}
SoW:      Break into {N} epics, execute sequentially
Risk:     {from council risk summary}

(y) approve  (n) reject + feedback  (?) expand
```

For **medium scope** (single epic):
```
[EPIC] {Title}
─────────────────────────────
Summary:  • {what}  • {why}
Scope:    {areas affected}
SoW:      Break into {N} stages
Risk:     {one line}

(y) approve  (n) reject + feedback  (?) expand
```

For **small scope**: present a `[TASK]` card and skip directly to EXECUTE.

5. **On approval:**
   - Create `.ai-plans/{slug}/roadmap.md`
   - Create epic branch: `git checkout main && git pull && git checkout -b epic/{slug}`
   - Commit roadmap to main
   - Create draft PR: `gh pr create --draft --base main --head epic/{slug}`
   - Proceed to BREAKDOWN for first stage (or EXECUTE for small scope)

---

## Phase 2: BREAKDOWN (per stage)

1. **Invoke `/council "Plan stage: {title}" --subroutine`** — deliberation on approach
2. **Research the codebase** — read relevant files, understand current state
3. **Segment into file-disjoint tasks** — each task touches different files (parallel-safe)
4. **Present batch Review Card:**

```
Stage {N}: {title} — {count} tasks
─────────────────────────────
1. {task title} — {files}
2. {task title} — {files}
3. {task title} — {files}
4. Integration task — {wiring}

(a) approve all  (1-4) drill into one  (w) walkthrough
```

5. **On approval:**
   - Create stage branch: `git checkout epic/{slug} && git checkout -b {prefix}/{slug}/{stage-slug}`
   - Write task instruction files to `.ai-queue/`:
     ```markdown
     <!-- auto-queue -->
     <!-- target-branch: {prefix}/{slug}/{stage-slug} -->
     # Task: {title}
     {Implementation instructions with file paths and acceptance criteria}
     ```
   - Send `work-queued` event via relay
   - Update roadmap: stage status → `in-progress`, phase → `execute`

**Branch prefix:** `feat/`, `fix/`, `chore/`, or `docs/` based on stage nature.

---

## Phase 3: EXECUTE

Workers (`/q`) claim and execute tasks in worktrees.

**Monitoring:**
- Ensure relay is running (see Relay section)
- Block on relay events: `task-completed`, `worker-disconnected`
- Fallback (no relay): poll `.ai-queue/` every 15s for remaining pending/active files
- Print progress: `[{completed}/{total}] Stage {N}: {title}`

**Completion:** All tasks in `_completed/` → proceed to VERIFY.

---

## Phase 4: VERIFY

1. **Checkout the stage branch.** Pull latest.
2. **Run verification:** `npm run build`, `npm run lint`, `npm test` (or project equivalents)
3. **Check acceptance criteria** from roadmap — check off each that passes
4. **Present Review Card:**

```
[VERIFY] Stage {N}: {title}
─────────────────────────────
Summary:  • {N}/{M} criteria pass  • {build/lint/test status}
Scope:    {files changed in this stage}
SoW:      Merge stage to epic branch (or iterate on failures)
Risk:     {assessment}

(y) approve + advance  (n) reject + feedback  (?) expand
```

5. **All pass + approved** → ADVANCE
6. **Failures** → write fix tasks to `.ai-queue/`, send `work-queued`, return to EXECUTE
7. **Iteration limit:** 5 per stage. Exceeding → present card explaining failures, ask user.

---

## Phase 5: ADVANCE

1. **Create stage PR** to epic branch:
   ```bash
   gh pr create --base epic/{slug} --head {prefix}/{slug}/{stage-slug} \
     --title "Stage {N}: {title}" --body "Closes stage {N} of {slug}"
   ```

2. **Merge stage PR:**
   ```bash
   gh pr merge --merge --delete-branch
   ```

3. **Update roadmap:** Mark stage done (criteria already checked from VERIFY).

4. **More stages?** → BREAKDOWN for next stage.
   **All stages done?** → SHIP.

### SHIP (epic complete)

1. **Rebase epic branch** on main:
   ```bash
   git checkout epic/{slug} && git fetch origin main && git rebase origin/main
   git push --force-with-lease origin epic/{slug}
   ```

2. **Present final Review Card:**
   ```
   [SHIP] {Epic title}
   ─────────────────────────────
   Summary:  • {stages completed}  • {key outcomes}
   Scope:    {total files changed}
   SoW:      Merge epic/{slug} to main
   Risk:     {one line}

   (y) merge  (n) hold  (?) expand with full diff
   ```

3. **On approval:** Mark PR ready for review. Wait for CI. If green → merge.
4. **Cleanup:** Archive roadmap (`status: done`), commit, send `epic-done` via relay.
5. **Multi-epic:** proceed to next epic's BREAKDOWN instead of sending `epic-done`.
6. **All epics done:** send `epic-done`, print summary.

---

## `/plan status`

```
{Title} ({scope})
Status: {phase} — {status}

Epics:
  1. {title} — done ✓
  2. {title} — in-progress
     Stage 2.1: {title} — done ✓
     Stage 2.2: {title} — in-progress [3/5 tasks]
     Stage 2.3: {title} — pending
  3. {title} — pending
```

For single-epic: omit epic grouping, show stages directly.
For small scope: show task status.

---

## `/plan` (resume)

1. Scan `.ai-plans/` for roadmaps with `status` not `done` or `aborted`
2. If multiple → `AskUserQuestion` which to resume
3. Read roadmap YAML frontmatter → determine current phase
4. Re-enter the flow at the correct gate
5. Ensure relay is running

---

## Relay Integration

Same patterns as `/q`:

**Start relay:**
```bash
RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
if ! ([ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]); then
  mkdir -p .ai-relay
  nohup node ~/.claude/skills/relay/server.js "$(pwd)/.ai-relay" > .ai-relay/relay.log 2>&1 &
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

**Events:** `work-queued` (wake workers), `task-completed`, `epic-done` (workers exit).

---

## Branch Strategy

```
main
└── epic/{slug}
    ├── feat/{slug}/{stage-1-slug}
    ├── fix/{slug}/{stage-2-slug}
    └── chore/{slug}/{stage-3-slug}
```

Epic branches merge to main. Stage branches merge to epic. Worker branches (`q-NNN`) merge to stage.

---

## Error Handling

| Error | Action |
|-------|--------|
| Stage iteration limit (5) | Present card explaining failures, ask user |
| Merge conflict | Attempt rebase. If unresolvable → present card |
| CI failure | Present verification card with failures |
| Relay down | Fall back to polling `.ai-queue/` |

---

## Rules

1. **Never execute without approval.** Every gate requires a review card.
2. **Council before code.** SCOPE and BREAKDOWN always invoke `/council --subroutine`.
3. **Brevity in cards.** No paragraphs. Bullets only. Active voice.
4. **Consistent hierarchy.** Summary > Scope > SoW > Risk > Action. Always this order.
5. **Progressive disclosure.** Default = compressed. Detail on demand via `?`.
6. **Iterate, don't restart.** Rejection refines the item, not the whole plan.
7. **Level tags always.** `[SAGA]`/`[EPIC]`/`[STAGE]`/`[TASK]` prefix.
8. **One roadmap file.** `.ai-plans/{slug}/roadmap.md` — single source of truth.
9. **File-disjoint tasks.** Parallel-safe by construction.
10. **Commit state to git.** Roadmap survives `/clear`.
