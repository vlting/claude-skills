---
name: council
description: "Multi-persona planning skill that analyzes tasks from different engineering/design angles, then reconciles into a consensus plan."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.1.0
---

# Council

Analyzes a task from multiple expert perspectives independently, then synthesizes a single reconciled plan — cherry-picking best ideas and resolving conflicts via concessions and confidence weighting.

```
/council {task}                              — Auto-select relevant personas (4-7)
/council {task} --personas arch,pragma,dx    — Explicit subset
/council {task} --auto                       — Non-interactive: resolve all tensions, skip plan mode
```

---

## Flags

### `--auto`

Autonomous execution mode. Changes behavior:
1. **Skip `EnterPlanMode`** — council runs in the caller's current mode (typically `acceptEdits` when invoked by `/orchestrate --auto`)
2. **Resolve all open tensions** — use best judgment via domain authority + confidence weighting instead of asking the user. Document the resolution reasoning, but don't block on user input.
3. **No handoff suggestion** — return the plan directly. The caller (e.g., `/orchestrate`) decides what to do with it.
4. **No `AskUserQuestion`** — the entire flow runs without user interaction.

When `--auto` is NOT set, council behaves as before: enters plan mode, presents open tensions for user resolution, and suggests `/orchestrate` or `/q` handoff.

---

## Personas

Seven available perspectives. Each brings a distinct lens and a grounding standard — a question they always ask.

| Key | Persona | Lens | Standard |
|-----|---------|------|----------|
| `arch` | Fundamentals Architect | Type safety, abstractions, API contracts | "Would this survive a major refactor?" |
| `pragma` | Pragmatic Maximizer | Ship real value, scope control, reversibility | "What's the smallest change that delivers 80% of the value?" |
| `dx` | DX Perfectionist | API ergonomics, discoverability, error messages | "Would a new dev understand this without reading the source?" |
| `ux` | UX Advocate | Accessibility, interaction quality, perceived perf | "Does this feel right for every user, on every device?" |
| `design` | Design Purist | Design system coherence, tokens, visual rhythm | "Does this respect the system's visual language?" |
| `perf` | Performance Engineer | Bundle size, runtime cost, rendering efficiency | "What's the cost at scale — 1000 components, slow 3G?" |
| `maint` | Maintainability Guardian | Readability, testability, coupling, migration paths | "Will the next person curse or thank us?" |

**Conflict-resolution weights** (used when personas disagree):
- `pragma` — weighted on scope decisions
- `arch` — weighted on API contracts and type boundaries
- `perf` — weighted on measurable performance claims
- `ux` + `design` — weighted on user-facing decisions
- `maint` — weighted on long-term maintenance cost
- `dx` — weighted on developer ergonomics

---

## Invocation Parsing

1. Parse `{task}` — everything after `/council` that isn't a flag
2. Parse `--personas` — comma-separated keys (e.g., `arch,pragma,dx`)
3. Parse `--auto` — boolean flag, enables autonomous mode
4. If `--personas` omitted → auto-select (see heuristic below)

**Auto-selection heuristic (4-7 personas):**
- **Always include:** `pragma` + `maint` (grounding voices)
- **Include if task mentions or touches:** UI/components → `ux`, `design`; APIs/types/abstractions → `arch`, `dx`; rendering/bundle/speed → `perf`; developer workflow/tooling → `dx`
- **Default to all 7** if the task is broad or ambiguous
- **Minimum 4** — if heuristic selects fewer, add by relevance order: `arch` → `dx` → `perf` → `ux` → `design`

---

## Execution Phases

### Phase 1: EXPLORE

Launch **one Explore agent** to gather codebase context relevant to the task.

**Agent config:**
- `subagent_type: "Explore"`
- Thoroughness: `"very thorough"`

**Prompt template:**
```
Explore the codebase to build a context brief for this task:

TASK: {task}

Produce a structured brief with these sections:
1. **Affected Area** — files, modules, packages touched
2. **Existing Patterns** — how similar things are currently done
3. **Constraints** — type boundaries, API contracts, dependencies
4. **Prior Art** — related implementations already in the codebase
5. **Open Questions** — ambiguities or unknowns that need resolution

Be thorough. Check tests, types, and usage sites — not just implementations.
```

**Output:** A structured context brief (plain text). This feeds into every persona agent.

---

### Phase 2: DELIBERATE

Launch **all** persona Plan agents in parallel (single batch). Each persona gets identical context but responds through its unique lens.

**Agent config:**
- `subagent_type: "Plan"`
- `mode: "plan"`

**Persona prompt template:**

```
You are the {PERSONA_NAME} on an engineering council.

YOUR LENS: {LENS_DESCRIPTION}
YOUR STANDARD: Before proposing anything, ask yourself: "{STANDARD_QUESTION}"

CONTEXT BRIEF:
{explore_brief}

TASK:
{task}

Respond with EXACTLY this structure:

## Proposal
Your recommended approach (2-5 bullet points, concrete and actionable).

## Risks
What could go wrong with YOUR OWN proposal (1-3 bullets).

## Non-Negotiables
1-2 things you will NOT compromise on, with justification.

## Concessions
Things you'd be willing to give up if other perspectives push back (1-3 bullets).
These are your pre-declared trade-offs — be specific about what you'd accept instead.

## Confidence
Rate 1-5 (5 = certain this is right, 1 = speculative).
One sentence explaining your confidence level.
```

**Parallelism:** All selected personas (4-7) launch simultaneously in a single `Agent` tool call batch. No sequential batching — personas are fully independent and never see each other's output.

---

### Phase 3: RECONCILE

**No agent** — synthesize directly from persona outputs. This is the critical thinking step.

Process all persona responses through these four filters, in order:

#### 3a. Agreements
Scan for proposals where **3+ personas align** on the same approach or recommendation.
- These form the **plan foundation** — adopt directly
- Note which personas agreed (for attribution)

#### 3b. Cherry-picks
Find **unique ideas** proposed by only one persona that **no other persona contradicts**.
- Adopt with attribution: "Per {persona}: {idea}"
- Only cherry-pick if the idea is concrete and actionable

#### 3c. Compromises
Identify **conflicts** where personas disagree. Resolve using:
1. **Concessions** — check if one side pre-declared willingness to concede on this point
2. **Confidence weighting** — higher-confidence persona gets more weight
3. **Domain authority** — use conflict-resolution weights (e.g., `perf` wins on measurable performance, `ux` wins on user-facing)
4. **Synthesis** — sometimes both sides are right; find the approach that satisfies both constraints

Document the resolution: "Conflict between {A} and {B} on {topic}: resolved by {reasoning}"

#### 3d. Open Tensions

**Standard mode:** Genuine trade-offs where no clean resolution exists:
- Present both sides clearly
- State the recommended default (with reasoning)
- Mark as requiring user decision

**`--auto` mode:** Resolve ALL tensions using best judgment:
- Apply domain authority weights and confidence scores
- Choose the recommended default
- Document: "Auto-resolved: {topic} — chose {approach} because {reasoning}"
- No tensions remain open; the plan is immediately actionable

---

### Phase 4: PRESENT

Output the reconciled plan in this format:

```markdown
# Council Plan: {task_summary}

**Personas consulted:** {list with keys}

## Plan
{Numbered steps — the reconciled, actionable plan}

## Key Decisions
{Agreements, cherry-picks, and compromise resolutions — briefly attributed}

## Open Tensions
{Standard mode: present both sides, recommend default, ask user to decide}
{--auto mode: omit this section — all tensions auto-resolved under Key Decisions}

## Risk Summary
{Top 3-5 risks aggregated across all personas, deduplicated}

---
*Reconciled from {N} independent perspectives. Hand off to `/orchestrate` or `/q` for execution.*
```

**After presenting (standard mode):**
- If **open tensions exist** → ask the user to resolve each one before proceeding
- If **no tensions** → the plan is ready for execution
- Suggest handoff: `/orchestrate {task}` for multi-step initiatives, `/q {task}` for single-scope work

**After presenting (`--auto` mode):**
- Plan is immediately final — no user interaction
- No handoff suggestion — the caller drives next steps
- The footer line changes to: `*Reconciled from {N} independent perspectives. Auto-resolved — ready for execution.*`

---

## Full Execution Flow (copy-paste reference)

```
1. If NOT --auto → enter plan mode (EnterPlanMode tool)
   If --auto → skip plan mode, run in caller's mode
2. Parse invocation → extract {task}, {personas}, {auto}
3. If no --personas → auto-select 4-7 using heuristic
4. EXPLORE
   └─ 1× Explore agent (very thorough) → context brief
5. DELIBERATE
   └─ All persona Plan agents launched in parallel (single batch)
      └─ Each gets: persona identity + context brief + task
      └─ Each outputs: proposal, risks, non-negotiables, concessions, confidence
6. RECONCILE (direct synthesis, no agent)
   └─ Agreements (3+ align) → foundation
   └─ Cherry-picks (unique + unchallenged) → adopt
   └─ Compromises (conflicts) → resolve via concessions + confidence + domain weight
   └─ Open tensions:
      └─ Standard: present both sides + recommend default
      └─ --auto: resolve via domain authority, document reasoning
7. PRESENT
   └─ One coherent plan (not a comparison table)
   └─ Standard: open tensions → ask user to resolve; suggest handoff
   └─ --auto: plan is final, no user interaction, no handoff suggestion
```

---

## Example Invocations

**Broad task (all 7 fire):**
```
/council "Add dark mode toggle to the app"
```
→ Auto-selects all 7: UI-facing task touches design, UX, performance, architecture, DX, maintenance, and scope.

**Scoped task (explicit subset):**
```
/council "Refactor styled() to support compound variants" --personas arch,dx,perf
```
→ Only 3 personas fire. Focused on API contracts, ergonomics, and runtime cost.

**Infrastructure task (auto-selects 4-5):**
```
/council "Migrate build from rollup to tsup"
```
→ Auto-selects: `pragma` (scope), `maint` (migration path), `dx` (dev workflow), `perf` (build speed), `arch` (output contracts).

**Autonomous mode (called by orchestrate):**
```
/council "Build user auth system with OAuth2" --auto
```
→ Full council deliberation, all tensions auto-resolved, plan returned without blocking on user input.

---

## Rules

1. **Plan mode enforced (standard)** — call `EnterPlanMode` as the very first action; council never edits code or files. **Exception:** `--auto` skips plan mode.
2. **Personas are independent** — they never see each other's output during DELIBERATE
3. **Reconciliation synthesizes** — it produces ONE plan, not a comparison table
4. **Concessions make reconciliation tractable** — without them, every conflict is a deadlock
5. **Confidence is honest** — a persona rating 2/5 is signaling "I'm not sure, defer to others"
6. **Open tensions are real (standard mode)** — don't force a resolution; some trade-offs need human judgment
7. **Auto-resolve is decisive (`--auto`)** — make the best call using domain weights and move on; never block
8. **Minimum 4 personas** — fewer than 4 doesn't justify the council overhead; just plan directly
9. **pragma + maint always present** — unless explicitly excluded via `--personas`
