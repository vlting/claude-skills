---
name: refine
description: "Iterative refinement loop for modules/components. Research best practices, council-deliberate a spec, collect issues, implement in worktree, review — one target at a time, approval-gated."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Refine

Iterative, approval-gated refinement loop for any module, component, or group thereof. Researches best practices, councils a spec, collects known issues, implements in a worktree, reviews with the user — then moves to the next target.

```
/refine <glob|file|list>           — refine targets one by one
/refine <glob|file|list> --skip N  — skip first N targets (resume)
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

## State Tracking

Track across the loop:

```
currentIndex: number     — which target (0-based)
currentPhase: string     — RESEARCH | SPEC | ISSUES | IMPLEMENT | SHIP
totalTargets: number     — total count
completedTargets: string[] — names of finished targets
```

At the start of each phase, print:

```
[{currentIndex + 1}/{totalTargets}] {targetName} — {currentPhase}
```

---

## Phase 1: RESEARCH

**Goal:** Gather conventions, standards, and best practices for this type of component/module.

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

2. Confirm:
```
{targetName} complete. [{currentIndex + 1}/{totalTargets}] done.
```

3. Add to `completedTargets`.

4. If more targets remain → advance `currentIndex`, reset `currentPhase` to RESEARCH, continue loop.

5. If all targets done:
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
| `abort` | Stop the entire session |
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

1. **One target at a time.** Never parallelize across targets — the user reviews each.
2. **Approval gates are mandatory.** Every phase transition requires explicit user input via `AskUserQuestion`.
3. **Research is real.** Use web search, not hallucinated library APIs. Cite specifics.
4. **Council for specs.** Always use `/council --subroutine` for spec drafts. No shortcutting.
5. **Implementation via `/do`.** Always in a worktree. Never edit the main tree directly.
6. **Composable.** This skill calls `/council` and `/do` — it does not reimplement them.
7. **Resumable.** `--skip N` lets the user resume a session that was interrupted.
8. **No edits before IMPLEMENT.** Phases 1-3 are strictly read-only + research. First write happens inside `/do`.
9. **Push after merge.** SHIP always pushes so progress is saved before moving on.

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
/refine "src/components/**" --skip 3
```

Expands glob, skips the first 3 (already done), continues from target #4.
