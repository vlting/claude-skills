---
name: scope
description: "Interactive planning + orchestration. Approval-gated workflow covering saga→epic→task hierarchy via progressive scoping."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.4.0
---

# Scope

Interactive, approval-gated planning and orchestration. Every unit of work is reviewed before creation and before merge.

```
/scope {goal}          — start new initiative
/scope                 — resume active initiative; if none, read SCOPE.md (non-empty) from repo root
/scope status          — show hierarchy dashboard
/scope update          — modify an active roadmap
/scope watch           — monitor workers, verify tracking, then auto-resume
/scope clean           — audit + fix all PM tracking (roadmap, issues, PRs, board)
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

**Config validation (every run):** When `config.yml` lists an integration (e.g., `github`), verify the config block is complete. For GitHub: `owner`, `repo`, `project_number`, `project_node_id`, `status_field_id`, `status_options` must all be present. If missing → resolve field IDs via `gh project field-list` and write them. Never proceed with a half-configured integration — it causes silent side-effect failures in ADVANCE and SHIP.

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
   - **Integration: create stage sub-ticket** — `create-ticket` for the stage, linking to parent epic issue. Add to project board in **Todo** status.
   - Write task instruction files to `.ai-queue/`:
     ```markdown
     <!-- auto-queue -->
     <!-- target-branch: {prefix}/{slug}/{stage-slug} -->
     <!-- depends-on: NNN -->
     # Task: {title}
     {Implementation instructions with file paths and acceptance criteria}
     ```
   - **Integration: move stage ticket to In Progress** on board
   - Send `work-queued` event via relay
   - Update roadmap: stage status → `in-progress`, phase → `execute`

**Branch prefix:** `feat/`, `fix/`, `chore/`, or `docs/` based on stage nature.

**Dependency markers:** Add `<!-- depends-on: NNN -->` upfront when task ordering matters. Workers respect these — a task with unmet dependencies stays pending.

---

## Phase 3: EXECUTE

**The orchestrator does NOT implement.** Workers (`/q`) claim and execute tasks in worktrees.

1. **Verify workers are running.** Check relay for connected workers. If none:
   ```
   ⚠ No workers connected. Start /q in 1-3 separate terminals to begin execution.
   Waiting for workers...
   ```
   Do NOT proceed to implement the tasks yourself. Wait.

2. **Monitor via relay events:** `task-completed`, `worker-disconnected`
3. **Print progress:** `[{completed}/{total}] Stage {N}: {title}`
4. **Completion:** All tasks archived in `_completed/` → proceed to VERIFY.

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

> **Protocol:** Read `references/branch-protocol.md` before creating any PR. Stage PRs MUST target `epic/{slug}`, never `main`.

1. **Validate PR target** — assert base branch is `epic/{slug}`:
   ```bash
   BASE="epic/${SLUG}"
   # Verify epic branch exists and is up to date
   git fetch origin "$BASE" || { echo "ERROR: epic branch $BASE not found"; exit 1; }
   ```

2. **Create stage PR** to epic branch:
   ```bash
   gh pr create --base epic/{slug} --head {prefix}/{slug}/{stage-slug} \
     --title "Stage {N}: {title}" --body "Closes stage {N} of {slug}"
   ```

3. **Merge stage PR:**
   ```bash
   gh pr merge --merge --delete-branch
   ```

4. **Update roadmap:** Mark stage done (criteria already checked from VERIFY).

5. **Integration side-effects (mandatory when configured):**
   - [ ] `update-epic-pr` — check off `- [x] Stage {N}: {title} (#{stage_pr})` in epic PR body
   - [ ] `close-ticket` — close the stage sub-issue with "Completed."
   - [ ] `move-to-done` — move stage sub-issue to **Done** on project board

6. **More stages?** → BREAKDOWN for next stage.
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
4. **Integration side-effects (mandatory when configured):**
   - [ ] `update-saga-issue` — check off `- [x] Epic {N}: {title} (#{epic_pr})` in saga issue body
   - [ ] `update-epic-pr` — verify all stages checked off in epic PR body (should already be done in ADVANCE)
   - [ ] `move-to-done` — move epic PR to **Done** on project board (epics go from Planning → Done, never In Progress)
5. **Cleanup:** Update roadmap status. Commit.
6. **Multi-epic:** proceed to next epic's BREAKDOWN instead of sending `epic-done`.
7. **All epics done:** send `epic-done` via relay. Move saga issue + saga PR to **Done** on board. Print summary.

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

## `/scope watch`

Autonomous monitor → verify → resume cycle. Use during EXECUTE phase when workers are processing tasks.

### Behavior

Three sequential phases, fully autonomous (no user interaction until next gate):

**Phase A: Monitor (up to 9 minutes)**

1. Read roadmap to determine current stage, total task count, and stage issue number.
2. Poll `.ai-queue/` and `.ai-queue/_completed/` every 60 seconds:
   - Count remaining vs completed tasks
   - Print progress: `[{completed}/{total}] Stage {N}: {title} — {elapsed}`
   - If workers disconnect (no progress for 2+ cycles), re-send `work-queued` via relay
3. **Exit conditions:**
   - All tasks moved to `_completed/` → proceed to Phase B
   - 9 minutes elapsed with tasks remaining → print status, ask user whether to extend or intervene

**Phase B: Verify GitHub Tracking**

Once all tasks complete, audit integration side-effects for the current stage:

1. **Stage issue exists** and is in correct board status (In Progress)
2. **Epic PR body** has current stage listed (unchecked is fine — that happens in ADVANCE)
3. **Saga issue body** has current epic listed
4. **All completed task branches** merged to stage branch (workers handle this, but verify)
5. **No orphaned issues/PRs** from this stage

Fix any gaps silently (create missing issues, update board status, edit PR bodies). Print a one-line summary of what was fixed, or "Tracking clean — no fixes needed."

**Phase C: Resume Flow**

Continue the `/scope` lifecycle as if the user ran `/scope`:
1. Read roadmap frontmatter → current phase should be `execute`
2. Transition to **VERIFY** — run build/lint/test, check acceptance criteria
3. Present the `[VERIFY]` Review Card for user approval
4. On approval → ADVANCE → next stage BREAKDOWN (or SHIP if final stage)

This is the standard `/scope` resume flow from Phase 4 onward — watch simply automates the wait.

### Polling implementation

```bash
# Count remaining tasks (non-hidden files in .ai-queue/, excluding _completed/)
REMAINING=$(find .ai-queue -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
COMPLETED=$(find .ai-queue/_completed -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
```

Use the `/loop` skill pattern internally — but `/scope watch` is a single invocation, not recurring. The polling loop runs within the single command execution.

### Rules

- **No user interaction during Phase A/B.** Only Phase C (VERIFY gate) requires approval.
- **Re-send relay events** if workers appear stalled (no new completions for 2+ minutes).
- **9-minute ceiling is soft.** If 6/7 tasks done at 9 min, extend 3 min automatically. Only prompt if <50% done at 9 min.
- **Phase B is mandatory.** Never skip tracking verification, even if all tasks completed quickly.
- **Phase C is standard /scope resume.** Same gates, same rules as `/scope` with no arguments.

---

## `/scope clean`

Full-initiative audit + repair. Derives truth from **shipped code** (merged PRs, branch state), then reconciles roadmap + GH artifacts to match.

**Source of truth hierarchy:**
1. **Merged code** — PRs merged, branches merged = work is done
2. **Roadmap** — updated to reflect merged code
3. **GH issues/PRs** — updated to reflect roadmap
4. **Board** — updated to reflect issue/PR state

### Four Audit Passes (all autonomous, no user interaction)

**Pass 1: Code → Roadmap**

Scan merged PRs and branch state to determine what's actually shipped:
- For each stage: check if its branch was merged to epic branch (or PR merged). If merged but roadmap says `pending`/`in-progress` → mark `done`, check off acceptance criteria.
- For each epic: if all stages done but epic says `in-progress` → check if epic branch merged to main. If so → mark `done`.
- Update roadmap `current_epic`/`current_stage`/`phase` frontmatter to reflect actual state.
- Commit roadmap changes if any.

**Pass 2: Roadmap → GitHub Issues**

For each epic/stage in the roadmap:
1. If roadmap has `Issue: #N` — verify issue exists, has correct label (`epic`/`stage`), is open/closed appropriately (done → closed, in-progress → open)
2. If roadmap has NO issue reference — create missing issue, link to parent, add label, set board status, write issue # back to roadmap
3. Verify epic issue body lists all stages in checklist format
4. Verify saga issue body lists all epics in checklist format

**Pass 3: Roadmap → GitHub PRs**

For each epic with a PR:
1. Verify PR body has all stages in checklist format
2. Done stages checked off with PR link: `- [x] Stage N: title (#PR)`
3. In-progress/pending stages unchecked: `- [ ] Stage N: title`
4. Fix mismatches (missing checkoffs, missing PR links, missing entries)

**Pass 4: Board Status**

For each tracked issue:
1. Epic/saga issues: **Planning** (active) or **Done** (complete). Never Todo/InProgress/InReview.
2. Stage issues: `pending` → Todo, `in-progress` → In Progress, has PR → In Review, `done` → Done
3. Fix status mismatches

### Output

```
/scope clean — {title}
──────────────────────────────────
Fixed:
  • Roadmap: marked Stage 6.1 done (PR #209 merged)
  • Created missing issue for Stage 6.2 (#211)
  • Checked off Stage 6.1 in epic PR #209 body
  • Moved #208 from In Progress → Done
  • Added 'stage' label to #211

Clean:
  • Epic issue #206 ✓
  • Roadmap frontmatter ✓

{or "All clean — nothing to fix."}
```

### Rules

- No user interaction. Fix everything, report at end.
- Read `config.yml` for integration. No integration → "No integration configured, nothing to audit."
- Read `integrations/github.md` for concrete commands.
- Idempotent — safe to run repeatedly.
- CAN update roadmap (statuses, issue/PR references, frontmatter). Shipped code is ground truth.
- Commits roadmap changes if modified.

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

## `/scope` (resume / SCOPE.md)

`SCOPE.md` at repo root is the user's scratch pad for defining new initiatives. **Empty `SCOPE.md` = no pending scope** (equivalent to the file not existing). Never delete `SCOPE.md` — only empty it.

1. Scan `.ai-plans/` for roadmaps with `status` not `done` or `aborted`
2. **Active roadmap(s) found:**
   - If one → resume: read YAML frontmatter → determine current phase → re-enter flow at correct gate
   - If multiple → `AskUserQuestion` which to resume
   - If `SCOPE.md` has content → `AskUserQuestion`: resume active initiative or start new one from `SCOPE.md`?
3. **No active roadmap:** Check `SCOPE.md` at repo root
   - Has content → read contents, use as goal, enter Phase 1 (SCOPE)
   - Empty or missing → "No active initiative. Run `/scope {goal}` or write your goal in `SCOPE.md`."
4. Ensure relay is running

### SCOPE.md lifecycle

Once `/scope` reads `SCOPE.md` and creates the roadmap (Phase 1 approval + roadmap written), **empty the file** (write empty string). The goal now lives in the roadmap — `SCOPE.md` is free for the next initiative.

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

## Memory Integration

Recall at phase entries. Store on outcomes. Reinforce on use. Read `~/.claude/skills/memory/MEMORY_OPS.md` for tool call templates.

| Phase | Action |
|-------|--------|
| **SCOPE entry** | `recall-prior-art` with goal keywords + `recall-constraints` with "scope orchestrator" |
| **BREAKDOWN entry** | `recall-checklist` with "breakdown github tracking tickets" |
| **EXECUTE entry** | `recall-constraints` with "scope never implement execute monitor workers". Reinforce any recalled feedback memories. |
| **VERIFY** | `recall-prior-art` with test/lint patterns for this project |
| **ADVANCE** | `recall-checklist` with "advance integration side-effects PR board". Reinforce recalled checklist memories. |
| **SHIP** | `recall-checklist` with "ship merge saga close". `store-outcome` summarizing the initiative. |

**Auto-store on Review Card rejection:** When user responds `n` + feedback containing a directive (negation, "don't", "always", "never", corrective language), auto-store as `store-feedback`.

**Attribution:** When a recalled memory influences a decision, annotate the bullet in the Review Card with `[mem:short-name]`. Cap at 3 per section. In `?` expanded view, show full memory content.

---

## !! ROLE BOUNDARY !!

Scope is **orchestration-only**. A `/scope` orchestrator:
- **NEVER implements code directly** — no writing/modifying source files, components, tests, or application code
- **NEVER skips the queue** — ALL implementation work MUST go through `.ai-queue/` for `/q` workers
- **Only writes:** roadmap files, `.ai-queue/` task files, `config.yml`, and git/GitHub operations
- **EXECUTE phase = monitoring only** — block on relay events, print progress, wait for workers
- **If no workers are running:** tell the user to start `/q` workers in separate terminals. Do NOT do the work yourself.

This boundary exists because the orchestrator and workers operate in separate contexts. The orchestrator manages the lifecycle; workers do the implementation. Violating this boundary means work happens without proper isolation, worktree safety, or parallel execution.

---

## Rules

1. **Never execute without approval.** Every gate requires a review card.
2. **Council before code.** SCOPE and BREAKDOWN always invoke `/council --subroutine`.
3. **Never implement code.** Scope writes task files. Workers implement. No exceptions.
4. **Brevity in cards.** No paragraphs. Bullets only. Active voice.
5. **Consistent hierarchy.** Summary > Scope > SoW > Risk > Action. Always this order.
6. **Progressive disclosure.** Default = compressed. Detail on demand via `?`.
7. **Iterate, don't restart.** Rejection refines the item, not the whole plan.
8. **Level tags always.** `[SAGA]`/`[EPIC]`/`[STAGE]`/`[TASK]` prefix.
9. **One roadmap file.** `.ai-plans/{slug}/roadmap.md` — single source of truth.
10. **File-disjoint tasks.** Parallel-safe by construction.
11. **Commit state to git.** Roadmap survives `/clear`.
12. **Relay required.** No fallback polling — relay must be running for worker coordination.
13. **Integration side-effects are mandatory.** When `config.yml` lists an integration, every ADVANCE and SHIP phase MUST execute all side-effects (update PR body, update issue body, move board status). Never skip silently.
14. **Labels are mandatory.** Every saga issue gets `saga` label. Every epic issue gets `epic` label. Every stage issue gets `stage` label. Verify after creation.
15. **Checklist links are mandatory.** When checking off a stage in an epic PR/issue body, or an epic in a saga issue body, ALWAYS include the PR number: `- [x] Stage N: title (#PR_NUMBER)`. Never check off without linking.
16. **Board status transitions are mandatory.** Sagas/epics: Planning on creation → Done on merge (no other statuses ever). Stages: Todo → In Progress → In Review → Done. Never skip transitions.
17. **Verify after every side-effect.** After updating a PR body, issue body, or board status, re-read the target to confirm the change took effect. If it didn't, fix it immediately.
