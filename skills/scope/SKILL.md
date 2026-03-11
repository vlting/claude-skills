---
name: scope
description: "Interactive planning + orchestration. Approval-gated workflow covering saga→epic→task hierarchy via progressive scoping."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.0.0
---

# Scope

Interactive, approval-gated planning and orchestration. Every unit of work is reviewed before creation and before merge.

```
/scope {goal}          — start new initiative
/scope                 — resume current initiative
/scope status          — show hierarchy dashboard
/scope update          — modify an active roadmap
/scope abort           — abort (preserves all work)
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

Always full deliberation (4-7 personas). `--subroutine` returns the plan directly without user interaction — /scope handles all user gates via Review Cards.

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

## Metadata
- **Epic branch:** epic/{slug}
- **PR:** #{N}
- **Created:** YYYY-MM-DD
- **Integrations:** {from config.yml or "none"}
- **Risk summary:** {from council}

## Epic 1: {title}
**Status:** pending | in-progress | done

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

## Integrations

Core scope is PM-agnostic. Integrations are optional plugins that map abstract actions to concrete CLI commands.

**Config:** `.ai-plans/config.yml`
```yaml
integrations: [github]   # or: [] or omit entirely
```

**Loading:** When an abstract action is needed (e.g., "create tracking ticket"), check `config.yml`. If an integration is listed, read `~/.claude/skills/scope/integrations/{name}.md` for the concrete commands. If no integration configured → skip the action silently.

**Abstract actions** (referenced throughout phases):
- `create-ticket` — create a tracking issue/ticket
- `create-pr` — create a draft PR (git fallback: `gh pr create --draft`)
- `link-ticket` — link a sub-ticket to a parent
- `close-ticket` — close a ticket with comment
- `move-status` — update ticket status on a board
- `update-epic-pr` — check off completed stage in epic PR body
- `update-epic-issue` — check off completed stage in epic issue body
- `update-saga-issue` — check off completed epic in saga issue body
- `move-to-done` — move issue to Done on project board

**First-run detection:** If `.ai-plans/config.yml` doesn't exist, auto-detect available CLIs (`gh`, `linear`, `jira`), ask user which to activate, write config. Subsequent runs read config directly.

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
   - If integration configured: create tracking ticket, create draft PR linking to roadmap, add to project board in Planning status. Otherwise: `gh pr create --draft`
   - Ensure relay is running (see Relay section)
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
     <!-- depends-on: NNN -->
     # Task: {title}
     {Implementation instructions with file paths and acceptance criteria}
     ```
   - Send `work-queued` event via relay
   - Update roadmap: stage status → `in-progress`, phase → `execute`

**Branch prefix:** `feat/`, `fix/`, `chore/`, or `docs/` based on stage nature.

**Dependency markers:** Add `<!-- depends-on: NNN -->` upfront when task ordering matters. Workers respect these — a task with unmet dependencies stays pending.

---

## Phase 3: EXECUTE

Workers (`/q`) claim and execute tasks in worktrees.

**Monitoring:**
- Block on relay events: `task-completed`, `worker-disconnected`
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
6. **Failures** → ITERATE: analyze failures, write fix tasks to `.ai-queue/`, send `work-queued`, return to EXECUTE
7. **Iteration limit:** 5 per stage, 20 total across all stages. Exceeding → present card explaining failures, ask user.

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

4. **Integration side-effects:** If configured: update epic PR body (check off stage), update epic issue body, close stage sub-ticket, move to Done on board.

5. **More stages?** → BREAKDOWN for next stage.
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
4. **Cleanup:** Archive roadmap (`status: done`), commit. If integration: close tracking ticket, move board status Planning → Done.
5. **Multi-epic:** proceed to next epic's BREAKDOWN instead of sending `epic-done`.
6. **All epics done:** send `epic-done` via relay, print summary.

---

## Multi-Epic Mode

For broad goals that decompose into multiple epics.

### Planning (multi-epic)

Council is invoked once for the full initiative. The reconciled plan identifies natural epic boundaries. Scope converts these into the multi-epic roadmap format.

For each epic, council may be re-invoked for detailed stage planning:
- Simple epic (1-2 stages) → derive stages directly from council plan
- Complex epic (3+ stages) → `/council "Detail stages for epic: {title}" --subroutine`

### Roadmap format (multi-epic)

```markdown
---
slug: {slug}
status: in-progress
scope: large
created: YYYY-MM-DD
current_epic: 1
current_stage: 1
phase: breakdown
---
# {Title}

## Overview
{Goals, scope, key decisions from council plan}

## Metadata
- **Created:** YYYY-MM-DD
- **Integrations:** github

## Epic 1: {title}
**Objective:** {what this delivers}
**Dependencies:** none
**Epic slug:** {epic-slug}
**Epic branch:** epic/{epic-slug}
**Status:** pending | in-progress | complete | skipped

### Stage 1.1: {title}
**Branch prefix:** feat
**Acceptance criteria:**
- [ ] {criterion}
**Status:** pending

## Epic 2: {title}
**Dependencies:** Epic 1
...
```

### Execution

1. **Sequentially execute epics** in dependency order. For each epic:
   - Create epic branch, run the full SCOPE → BREAKDOWN → EXECUTE → VERIFY → ADVANCE → SHIP cycle.
   - Between epics: `/clear` context. Compare output against Overview (drift check).

2. **Worker lifecycle:** Between epics send `work-queued` (keeps workers alive). Only send `epic-done` after the **last** epic completes.

3. **Drift check:** Minor drift → log and continue. Significant drift → pause, present card to user.

---

## Relay Integration

Fixed socket path: `~/.claude/relay.sock`. One relay per machine, started on first use.

**Start relay (if not running):**
```bash
RELAY_SOCK="$HOME/.claude/relay.sock"
RELAY_PID="$HOME/.claude/relay.pid"
if ! ([ -f "$RELAY_PID" ] && kill -0 "$(cat "$RELAY_PID")" 2>/dev/null && [ -S "$RELAY_SOCK" ]); then
  nohup node ~/.claude/skills/relay/server.js > ~/.claude/relay.log 2>&1 &
  # Wait up to 2s for relay.sock to appear
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

**Events sent by /scope:**
- `work-queued` — after writing task files to `.ai-queue/` (wakes workers)
- `epic-done` — after all epics complete (workers exit)

---

## `/scope status`

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

Reads from `.ai-plans/` — scan for all roadmaps, display active ones.

---

## `/scope update`

Interactively modify an active roadmap.

1. **List active roadmaps.** Scan `.ai-plans/` for roadmaps where `status` is not `done` or `aborted`. If none → "No active roadmaps." Otherwise AskUserQuestion with numbered list.

2. **Read selected roadmap.** Parse type (saga vs single-epic), full structure, per-stage/epic statuses.

3. **Prompt for changes.** AskUserQuestion: "What changes do you want to make to this roadmap?"

4. **Generate diff summary.** Compact before/after:
   - `+` additions (new stages/epics/criteria)
   - `~` modifications (title, criteria, or scope changes)
   - `-` removals (deleted pending stages/epics/criteria)

5. **Confirm loop.** AskUserQuestion: "Apply these changes?" Max 3 loops → stop and print diff for manual editing.

6. **Apply changes.** Write updated roadmap. Preserve all execution metadata: PR numbers, issue IDs, iteration counts, checkmarks.

7. **Side-effects:**
   - Adjust `current_stage` / `current_epic` in frontmatter if structure shifted
   - New epics: create branch, create tracking ticket if integration configured
   - Title changes: `gh issue edit` if GitHub integration active
   - Removed pending items: close associated tickets with "Removed from roadmap."

8. **Commit.** Roadmap to main.

### Constraints
- Cannot update `done` or `aborted` roadmaps.
- Cannot remove or reorder `in-progress` or `done` stages/epics — only `pending` items.
- Editing titles/criteria on `in-progress` stages is allowed (scope refinement).

---

## `/scope abort`

1. Do NOT delete branches, roadmaps, or completed work.
2. Set roadmap `status` to `aborted`.
3. If integration: close ticket with "Aborted. Work preserved."
4. Send `epic-done` via relay (workers exit).
5. Print where to find preserved work.

---

## `/scope` (resume)

1. Scan `.ai-plans/` for roadmaps with `status` not `done` or `aborted`
2. If multiple → `AskUserQuestion` which to resume
3. Read roadmap YAML frontmatter → determine current phase
4. Re-enter the flow at the correct gate
5. Ensure relay is running

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
| Total iteration limit (20) | Present card explaining failures, ask user |
| Merge conflict | Attempt rebase. If unresolvable → present card |
| CI failure | Present verification card with failures |
| Dependency deadlock (multi-epic) | Present card, ask user |

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
11. **Relay required.** No fallback polling — relay must be running for worker coordination.
