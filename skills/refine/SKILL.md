---
name: refine
description: "Iterative refinement loop for modules/components. Research best practices, council-deliberate a spec, collect issues, implement in worktree, review — one target at a time, approval-gated. Auto mode for fully autonomous operation."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 3.0.0
---

# Refine

Iterative, approval-gated refinement loop for any module, component, or group thereof. Researches best practices, councils a spec, collects known issues, implements in a worktree, reviews with the user — then moves to the next target.

```
/refine <glob|file|list>           — refine targets one by one (auto-resumes interrupted sessions)
/refine <targets> --auto [context]  — fully autonomous: no approval gates, status tracked in .md file
```

---

## Flow (per target)

```
/refine <targets>
    |
    For each target:
    |
    RESEARCH   — web search + library survey for best practices
    |            User: approve findings / add notes
    |
    SPEC       — /council spec draft → user iteration loop
    |            User: approve / refine (loop)
    |
    ISSUES     — user lists implementation problems
    |            User: done listing / skip
    |
    IMPLEMENT  — /do in worktree (spec + code updates)
    |            User: merge / request changes / discard
    |
    SHIP       — commit, push, confirm → next target
```

---

## `--auto` — Autonomous Mode

Fully autonomous refinement. No `AskUserQuestion` gates. All decisions, status, issues, and questions are written to a status file instead of waiting for user input.

### When to use

- User explicitly wants unattended operation ("do this autonomously", "handle this overnight")
- Multiple targets that don't need per-target approval
- User wants to review the batch outcome, not each step

### Invocation

```
/refine <targets> --auto [additional context or instructions]
```

The second argument (optional) is free-form context: constraints, source of truth pointers, known issues, etc. This replaces the ISSUES phase — the user front-loads what they know.

### Status File: `REFINE_STATUS.md`

All output that would normally go to the user goes to `REFINE_STATUS.md` in the **repo root** (NOT the worktree). This file is the user's async review surface.

**Create at startup. Update after every phase. Structure:**

```markdown
# /refine --auto — Status

**Branch:** `{worktree branch}`
**Started:** {ISO date}
**Updated:** {ISO date}
**Status:** {IN PROGRESS | COMPLETE | FAILED}
**Targets:** {N total}, {N complete}, {N remaining}

---

## Progress

| # | Target | Status | Notes |
|---|--------|--------|-------|
| 1 | Button | done | aligned native tokens with web |
| 2 | Badge  | done | pill radius, size tokens |
| 3 | Dialog | in progress | ... |
| 4 | Tabs   | pending | |

## Current: {targetName} — {phase}

{Brief description of what's happening right now}

## Decisions Made

- {target}: {decision} — {rationale}
- ...

## Issues Found

- {target}: {issue description} — {status: fixed | deferred | needs-user-input}
- ...

## Questions for User

- {question} (context: {why this matters})
- ...

## Completed Targets

### {targetName}
**Changes:** {summary}
**Commit:** `{sha}`
**Files:** {list}
```

### Auto Mode Flow

```
/refine <targets> --auto [context]
    |
    INIT         — resolve targets, create worktree, create REFINE_STATUS.md
    |
    For each target (parallelizable when file-disjoint):
    |
    RESEARCH     — same as standard, but findings go to status file, not AskUserQuestion
    |              Decision: auto-continue (no gate)
    |
    SPEC         — /council --subroutine, auto-approve
    |              Decision: council output accepted (no refinement loop)
    |
    ISSUES       — skip (user context from invocation replaces this)
    |
    IMPLEMENT    — /do --yolo (auto-merge on success)
    |              On failure: log to status file, continue to next target
    |
    VERIFY       — visual comparison if applicable (Playwright web, Maestro/simctl native)
    |              Findings logged to status file; auto-fix what's obvious, defer rest
    |
    SHIP         — commit, update status file
    |
    REPORT       — final status file update, summary
```

### Phase Details (auto mode overrides)

#### INIT

1. Resolve targets (same as standard).
2. Create worktree manually (same as `/do` Step 2): `git worktree add -b "refine/auto-{timestamp}" ".worktrees/refine-auto-{timestamp}"`
3. Symlink `node_modules`.
4. Create `REFINE_STATUS.md` at **repo root** with initial structure.
5. Start state session: `mcp__state__session_start(skill: "refine", repo: {cwd}, scope: "auto", payload: {initial state})`.

#### RESEARCH (auto)

Same research agent as standard mode, but:
- Findings written to status file under the current target section
- No `AskUserQuestion` — auto-continue
- If the user provided context at invocation, include it as additional research input

#### SPEC (auto)

- Invoke `/council --subroutine` (same as standard)
- Auto-approve the council output — no refinement loop
- Spec content written to status file and stored in state
- If an existing `*.spec.md` exists, update it; if not, create one

#### ISSUES (auto)

- **Skipped entirely.** The user's invocation context replaces this phase.
- Any issues discovered during RESEARCH or IMPLEMENT are logged to the status file under "Issues Found"

#### IMPLEMENT (auto)

Spawn implementation agent directly (not via `/do` — avoid the nested approval gate):

```
Agent(
  prompt: {worker prompt with spec + research + user context},
  mode: "bypassPermissions"
)
```

Worker runs in the worktree. On completion:
- If changes made → commit with conventional message
- If no changes → log "no changes needed" to status file
- If error → log error to status file, mark target as "failed", continue to next

No user confirmation. No preview server.

#### VERIFY (auto)

**Optional phase — only runs when visual comparison is possible.**

If the target is a UI component and visual tooling is available:

1. **Web reference:** Start web playground (`vite`), use Playwright to screenshot the component section at mobile viewport (390×844).
2. **Native comparison:** If Maestro + Java 17+ available AND a simulator is booted, use Maestro to navigate to the component section and screenshot. Otherwise, skip native screenshots.
3. **Compare:** Read both screenshots. Note visual discrepancies.
4. **Auto-fix:** If discrepancies are clearly token/styling issues (wrong spacing, color, radius), fix them in the worktree and re-commit.
5. **Defer:** If discrepancies require design decisions or are ambiguous, log to status file under "Questions for User".

**Skip conditions:**
- Target is not a UI component (e.g., utility, hook, config)
- No web playground section exists for the target
- Playwright not available

#### SHIP (auto)

- Push the worktree branch (but do NOT merge to main — user merges after review)
- Update status file: mark target as "done", add commit SHA and change summary
- Checkpoint state
- Continue to next target

#### REPORT (auto)

After all targets:
1. Update `REFINE_STATUS.md` with final summary
2. Complete state session
3. Print one-line notification: `"/refine --auto complete — {N} targets. Review REFINE_STATUS.md"`

### Parallelization in Auto Mode

Unlike standard `/refine` (strictly serial), auto mode **MAY parallelize** targets when they are file-disjoint:

1. After INIT, analyze target directories for overlap.
2. Group file-disjoint targets into batches.
3. Within each batch, spawn parallel agents (max 5, same as `/run --workers`).
4. Between batches, serialize (wait for all in batch N before starting batch N+1).
5. Status file updates must be serialized (one writer at a time — agent results collected by the orchestrator, not written by workers directly).

### Auto Mode Rules

1. **No `AskUserQuestion`.** Ever. Everything goes to the status file.
2. **No merge to main.** Auto mode pushes a branch. User merges after review.
3. **Status file is the contract.** User reviews `REFINE_STATUS.md` for decisions, issues, questions.
4. **Fail forward.** If a target fails, log it and continue. Don't abort the batch.
5. **Conventional commits.** Each target gets its own commit (or commits) with conventional messages.
6. **Same worktree for all targets.** One worktree, sequential commits. Parallelized agents all write to the same worktree (serialized merge back).
7. **User context replaces ISSUES.** Whatever the user passed at invocation is the issue list.
8. **Council is non-negotiable.** Even in auto mode, specs go through `/council --subroutine`. No shortcutting the multi-persona deliberation.

### Example

```
/refine "ButtonGroup, Badge, Card, Dialog, Sheet, Toast" --auto on NATIVE only: Card should default to raised. Checkbox small icon gets cutoff. Use web playground as source of truth for visual comparison.
```

→ Resolves 6 targets. Creates worktree. For each: researches, councils a spec, implements, verifies visually, commits. Status tracked in `REFINE_STATUS.md`. User reviews the file and the branch when ready.

---

## Input

Accepts any of:
- **Glob:** `"src/components/Button/**"` — expands to matching dirs/files
- **File path:** `"src/components/Menu/Menu.tsx"` — single target
- **Comma-separated list:** `"Button, Menu, Dialog"` — resolved via codebase search
- **Bare names:** searched as component/module names in the repo

### Target Resolution

1. If input is a glob → expand with Glob tool, group by parent directory (one target = one directory).
2. If input is a file path → target is that file's parent directory.
3. If input is a name → search for `**/{name}/**` or `**/{name}.tsx` and resolve to directory.
4. Deduplicate. Sort alphabetically.
5. Print the target list and ask user to confirm or reorder before starting.

---

## State Tracking (session-persisted)

State is persisted via the `state` MCP server. Sessions survive conversation disconnects.

### State shape (JSON payload)

```json
{
  "targets": ["Button", "Menu", "Dialog"],
  "currentIndex": 0,
  "currentPhase": "RESEARCH",
  "completedTargets": [],
  "researchBrief": null,
  "specContent": null,
  "issueList": null
}
```

### Session lifecycle

**On startup (before target resolution):**

1. Call `mcp__state__session_resume(skill: "refine", repo: {cwd})`.
2. If result is **not null** → interrupted session found:
   - Parse last checkpoint's `state_json` to recover state
   - If last checkpoint has `git_ref`, verify it: `git cat-file -t {git_ref}` (exists = phase completed)
   - Show: `"Found interrupted /refine session ({currentIndex+1}/{total}, phase: {phase}). Resume or discard?"`
   - `AskUserQuestion` with options: **resume** / **discard**
   - On discard → `mcp__state__session_abandon(session_id)`, then proceed fresh
   - On resume → skip to the recovered phase/target
3. If result is **null** → fresh start. After target resolution + user confirmation:
   - `mcp__state__session_start(skill: "refine", repo: {cwd}, payload: {initial state JSON})`

**At each phase transition:**

Call `mcp__state__session_checkpoint` with:
- `session_id`: the active session ID
- `phase`: current phase name (e.g., "RESEARCH", "SPEC", "ISSUES", "IMPLEMENT", "SHIP")
- `state_json`: full state snapshot (JSON stringified)
- `git_ref`: commit SHA if a commit was made (SHIP phase), omit otherwise

**On completion:**

Call `mcp__state__session_complete(session_id)` after all targets are done.

**On abort:**

Call `mcp__state__session_abandon(session_id)` when user chooses `abort`.

### Phase header

At the start of each phase, print:

```
[{currentIndex + 1}/{totalTargets}] {targetName} — {currentPhase}
```

---

## Phase 1: RESEARCH

**Goal:** Gather conventions, standards, and best practices for this type of component/module.

**Checkpoint:** At the start of this phase, call `mcp__state__session_checkpoint` with `phase: "RESEARCH"` and the current state snapshot.

1. Identify what kind of component/module the target is (e.g., Dialog, Menu, Tabs, Form).

2. Read the target's existing files — source, spec (`*.spec.md`, `*.ai.md`), tests, stories.

3. Launch a research agent (`subagent_type: "general-purpose"`) with web search:

```
Research best practices, conventions, and API design for a {component_type} component/module.

Look at what is established in top libraries:
- shadcn/ui
- Radix UI
- React Aria (Adobe)
- MUI (Material UI)
- Headless UI
- Ark UI
- Melt UI

For each library, note:
1. Props / API surface
2. Accessibility patterns (ARIA roles, keyboard nav)
3. Composition model (compound components, slots, render props)
4. State management approach
5. Notable design decisions or conventions

Synthesize into a unified "best practices" summary covering:
- Must-have features
- Accessibility requirements (WCAG)
- Keyboard interaction model
- Common pitfalls to avoid
- API design consensus across libraries

Be thorough but concise. Bullet points, not prose.
```

4. Present findings to the user:

```markdown
## Research: {targetName}

### Component Type
{identified type}

### Best Practices Summary
{synthesized findings}

### Current State
{summary of what exists in the target today}

### Gaps
{what the current implementation is missing vs. best practices}
```

5. `AskUserQuestion`:
```
Review the research above. Reply:
- **continue** — proceed to spec drafting
- **add: {notes}** — append your own findings, then continue
- **skip-to: spec|issues|implement** — jump ahead
```

On `add:` → append notes to the research brief, confirm, then proceed.

---

## Phase 2: SPEC

**Checkpoint:** Call `mcp__state__session_checkpoint` with `phase: "SPEC"` and state including `researchBrief`.

**Goal:** Draft or update the target's spec via council deliberation, iterated with the user.

1. Invoke `/council` as a subroutine:

```
Skill: council
Args: "Draft a component spec for {targetName} ({component_type}).

Context from research:
{research_brief}

Current implementation:
{summary of existing code, props, behavior}

Existing spec (if any):
{contents of *.spec.md or *.ai.md, or 'None'}

Produce a complete spec covering:
- Purpose & when to use
- Anatomy (parts/slots)
- Props / API surface
- Variants & states
- Accessibility (ARIA, keyboard interaction model)
- Responsive behavior
- Do's and Don'ts

Format as a spec.md document." --subroutine
```

2. Present the council's spec draft:

```markdown
## Proposed Spec: {targetName}

{council output — the full spec draft}
```

3. `AskUserQuestion`:
```
Review the spec draft above. Reply:
- **approve** — lock this spec, move to issues
- **refine: {feedback}** — revise and show again
- **skip** — keep existing spec, move to issues
```

### Refinement Loop

On `refine: {feedback}`:
1. Re-invoke `/council` with the feedback as an additional constraint.
2. Re-present the updated spec.
3. Ask again.

Loop until `approve` or `skip`. No limit on rounds.

On `skip`: proceed with the existing spec (or no spec if none exists).

---

## Phase 3: ISSUES

**Checkpoint:** Call `mcp__state__session_checkpoint` with `phase: "ISSUES"` and state including `specContent`.

**Goal:** Collect the user's known issues with the current implementation.

1. `AskUserQuestion`:
```
List any issues with the current {targetName} implementation.
Examples: broken behavior, missing features, wrong patterns, style violations, a11y gaps.

Reply:
- **{your list}** — I'll incorporate these into the implementation
- **skip** — no known issues, proceed to implement
```

2. On response: store the issue list. Confirm:
```
Got it — {N} issues noted. Moving to implementation.
```

On `skip`: proceed with spec + research only.

---

## Phase 4: IMPLEMENT

**Checkpoint:** Call `mcp__state__session_checkpoint` with `phase: "IMPLEMENT"` and state including `issueList`.

**Goal:** Apply all gathered context (research + spec + issues) in an isolated worktree.

Invoke `/do` with a comprehensive instruction set:

```
Skill: do
Args: "Refine {targetName} based on the following:

## Approved Spec
{spec content — from Phase 2, or existing spec if skipped}

## Research Summary
{research brief from Phase 1}

## Issues to Fix
{issue list from Phase 3, or 'None'}

## Instructions
1. Update the spec file ({spec_path}) with the approved spec content.
2. Update the component/module implementation to match the spec.
3. Fix all listed issues.
4. Ensure accessibility requirements are met.
5. Run any existing tests; fix if broken.
6. Do NOT modify files outside this target's directory unless strictly necessary."
```

`/do` handles: worktree creation → agent execution → diff preview → user confirmation (merge/open/discard).

### If discarded

`AskUserQuestion`:
```
Implementation discarded. What next?
- **retry: {feedback}** — re-run /do with adjustments
- **skip** — move to next target without changes
- **abort** — stop the entire /refine session
```

On `retry:` → re-invoke `/do` with the additional feedback appended.

---

## Phase 5: SHIP

After `/do` merges successfully:

1. Push the current branch:
```bash
git push
```

2. Get the commit SHA: `git rev-parse HEAD`

3. **Checkpoint with git_ref:** Call `mcp__state__session_checkpoint` with `phase: "SHIP"`, updated state (target added to `completedTargets`, `currentIndex` advanced), and `git_ref: {commit SHA}`.

4. Confirm:
```
{targetName} complete. [{currentIndex + 1}/{totalTargets}] done.
```

5. If more targets remain → advance `currentIndex`, reset `currentPhase` to RESEARCH, continue loop.

6. If all targets done:
   - Call `mcp__state__session_complete(session_id)`.
   - Print:
```
All {totalTargets} targets refined:
{bulleted list of completedTargets}
```

---

## Skip Gates

At any `AskUserQuestion`, the user can jump phases:

| Command | Effect |
|---------|--------|
| `skip` | Skip current phase, proceed to next |
| `skip-to: {phase}` | Jump to named phase |
| `abort` | Stop the entire session → `session_abandon` |
| `next` | Skip remaining phases for this target, move to next target |

These allow fast-tracking simple targets while keeping the full loop for complex ones.

---

## Memory Integration

Read `~/.claude/skills/memory/MEMORY_OPS.md` for tool call templates.

| Point | Action |
|-------|--------|
| **RESEARCH start** | `recall-prior-art` with component type keywords |
| **SPEC approved** | `store-decision` with key spec decisions + rationale |
| **User refines spec** | `store-feedback` with refinement reasoning |
| **SHIP complete** | `store-decision` with summary of what changed and why |

---

## Rules

1. **One target at a time.** Never parallelize across targets — the user reviews each. *(Auto mode exception: file-disjoint targets may parallelize.)*
2. **Approval gates are mandatory.** Every phase transition requires explicit user input via `AskUserQuestion`. *(Auto mode exception: all gates replaced by status file logging.)*
3. **Research is real.** Use web search, not hallucinated library APIs. Cite specifics.
4. **Council for specs.** Always use `/council --subroutine` for spec drafts. No shortcutting.
5. **Implementation via `/do`.** Always in a worktree. Never edit the main tree directly. *(Auto mode: direct agent in worktree with `--yolo` semantics.)*
6. **Composable.** This skill calls `/council` and `/do` — it does not reimplement them.
7. **Resumable.** Sessions are persisted via `state` MCP. `session_resume` at startup auto-detects interrupted work.
8. **No edits before IMPLEMENT.** Phases 1-3 are strictly read-only + research. First write happens inside `/do`.
9. **Push after merge.** SHIP always pushes so progress is saved before moving on.
10. **Auto mode: never merge to main.** Push the branch. User merges after reviewing `REFINE_STATUS.md`.

---

## Example

```
/refine "Menu, Dialog, Tooltip, Popover"
```

Resolves to 4 target directories. For each one:
- Researches best practices across top libraries
- Councils a spec draft, iterates with user
- Collects known issues
- Implements in worktree via `/do`
- Pushes, moves to next

```
/refine "src/components/**"
```

Expands glob. If a previous session was interrupted, auto-detects and offers to resume from where it left off.
