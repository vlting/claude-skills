---
name: council
description: "Multi-persona planning skill that analyzes tasks from different engineering/design angles, then reconciles into a consensus plan."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.0.0
---

# Council

Analyzes a task from multiple expert perspectives independently, then synthesizes a single reconciled plan.

```
/council {task}                              — Auto-select relevant personas (4-7)
/council {task} --personas arch,pragma,dx    — Explicit subset
/council {task} --subroutine                 — Non-interactive (for /plan and /q callers)
```

---

## Personas

| Key | Persona | Lens | Standard |
|-----|---------|------|----------|
| `arch` | Fundamentals Architect | Type safety, abstractions, API contracts | "Would this survive a major refactor?" |
| `pragma` | Pragmatic Maximizer | Ship value, scope control, reversibility | "Smallest change for 80% of the value?" |
| `dx` | DX Perfectionist | API ergonomics, discoverability, errors | "Would a new dev understand without reading source?" |
| `ux` | UX Advocate | A11y, interaction quality, perceived perf | "Does this feel right for every user, every device?" |
| `design` | Design Purist | Design system coherence, tokens, rhythm | "Does this respect the system's visual language?" |
| `perf` | Performance Engineer | Bundle size, runtime cost, rendering | "What's the cost at 1000 components, slow 3G?" |
| `maint` | Maintainability Guardian | Readability, testability, coupling | "Will the next person curse or thank us?" |

**Conflict weights:** `pragma` on scope, `arch` on API contracts, `perf` on measurable perf, `ux`+`design` on user-facing, `maint` on long-term cost, `dx` on ergonomics.

---

## Auto-Selection (when `--personas` omitted)

- **Always:** `pragma` + `maint`
- **If UI/components:** + `ux`, `design`
- **If APIs/types:** + `arch`, `dx`
- **If rendering/bundle:** + `perf`
- **If tooling/workflow:** + `dx`
- **Default all 7** if broad/ambiguous
- **Minimum 4** — fill by: `arch` → `dx` → `perf` → `ux` → `design`

---

## `--subroutine` Flag

When called by `/plan` or `/q`: skip `EnterPlanMode`, resolve all open tensions via domain authority + confidence weighting, return plan directly. No `AskUserQuestion`. The caller handles user interaction.

When NOT set: enter plan mode, present open tensions for user resolution.

---

## Phase 1: EXPLORE

Launch one Explore agent (`subagent_type: "Explore"`, thoroughness: `"very thorough"`):

```
Explore the codebase for this task: {task}
Produce: 1) Affected files/modules 2) Existing patterns 3) Constraints
4) Prior art 5) Open questions. Check tests, types, and usage sites.
```

Parallel recall (fire together):
- `recall-prior-art` with task keywords (project-scoped)
- `recall-lateral` with task keywords (unscoped — cross-domain serendipity, limit 5)

Inject recall results into context brief as `## Prior Knowledge` and `## Lateral Connections` sections.

Output: structured context brief fed to all personas.

---

## Phase 2: DELIBERATE

Launch **all** persona agents in parallel (single batch). `subagent_type: "Plan"`, `mode: "plan"`.

Each persona gets identical context + task. Prompt:

```
You are the {PERSONA_NAME}. LENS: {LENS}. STANDARD: "{QUESTION}"

CONTEXT: {explore_brief}
TASK: {task}

Respond with EXACTLY:
## Proposal — 2-5 bullets, concrete and actionable
## Risks — 1-3 bullets on YOUR OWN proposal
## Non-Negotiables — 1-2 things you won't compromise on
## Concessions — 1-3 things you'd give up if pushed back
## Confidence — 1-5 rating + one sentence why
```

All personas launch simultaneously. They never see each other's output.

---

## Phase 3: RECONCILE

Synthesize directly from persona outputs (no agent). Four filters in order:

**3a. Agreements:** 3+ personas align → adopt as plan foundation.

**3b. Cherry-picks:** Unique idea from one persona, unchallenged → adopt with attribution.

**3c. Compromises:** Resolve conflicts via:
1. Pre-declared concessions
2. Confidence weighting (higher wins)
3. Domain authority (conflict weights above)
4. Synthesis (satisfy both constraints)

Document: "Conflict {A} vs {B} on {topic}: resolved by {reasoning}"

**3d. Open Tensions:**
- **Standard:** present both sides, recommend default, mark for user decision
- **`--subroutine`:** resolve all via domain authority, document reasoning

---

## Phase 4: PRESENT

```markdown
# Council Plan: {task_summary}

**Personas:** {list with keys}

## Plan
{Numbered actionable steps}

## Key Decisions
{Agreements, cherry-picks, compromises — briefly attributed}

## Open Tensions
{Standard: both sides + recommended default}
{--subroutine: omitted — all resolved under Key Decisions}

## Risk Summary
{Top 3-5 risks, deduplicated across personas}
```

**Standard mode:** If tensions → ask user to resolve. Suggest `/plan` or `/q` handoff.
**Subroutine mode:** Plan is final. Return to caller.

---

## Example

```
/council "Add dark mode toggle to the app"
```
→ Auto-selects all 7 (UI task touches all perspectives). Full deliberation. Presents reconciled plan with any open tensions for user resolution.

---

## Memory Integration

Recall enriches exploration. Store captures decisions. Read `~/.claude/skills/memory/MEMORY_OPS.md` for tool call templates.

| Phase | Action |
|-------|--------|
| **EXPLORE** | `recall-prior-art` + `recall-lateral` (parallel). Inject as `## Prior Knowledge` + `## Lateral Connections`. |
| **DELIBERATE** | Per-persona discipline recall: `arch` → "type safety abstractions", `ux` → "accessibility interaction", `design` → "design tokens visual". Others → `recall-prior-art` with task keywords. |
| **PRESENT** | `store-decision` with key decisions + rationale |
| **User resolves tension** | `store-feedback` with the resolution reasoning |

---

## Rules

1. **Plan mode enforced (standard).** `EnterPlanMode` first. Exception: `--subroutine`.
2. **Personas are independent.** Never see each other's output.
3. **Reconciliation = ONE plan.** Not a comparison table.
4. **Concessions make reconciliation tractable.**
5. **Confidence is honest.** 2/5 = "defer to others."
6. **Minimum 4 personas.** Fewer → just plan directly.
7. **pragma + maint always present** (unless `--personas` overrides).
