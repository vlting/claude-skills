---
name: think
description: "Lightweight plan-to-queue pipeline. Explores codebase, runs council deliberation, presents plan for approval, then enqueues and executes via /q."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Think

One command from goal to execution. Plans read-only, approval gates the handoff, then auto-enqueues and drains via `/q`.

```
/think {goal}
```

No flags. No modes. One input, one approval gate.

---

## Flow

```
/think {goal}
    |
    EXPLORE  — Explore agents research codebase (read-only)
    |
    PLAN     — /council {goal} --subroutine (multi-persona deliberation)
    |
    PRESENT  — Review card + plan summary
    |          User: approve / reject / refine (loop on refine)
    |
    ENQUEUE  — /q segments plan into file-disjoint tasks
    |
    EXECUTE  — /q (bare) to drain queue as a worker
```

---

## Phase 1: EXPLORE

Launch one Explore agent (`subagent_type: "Explore"`, thoroughness: `"very thorough"`):

```
Explore the codebase for this task: {goal}
Produce: 1) Affected files/modules 2) Existing patterns 3) Constraints
4) Prior art 5) Open questions. Check tests, types, and usage sites.
```

Output: structured context brief. Stored for PLAN phase.

**Read-only.** No edits, no file creation.

---

## Phase 2: PLAN

Invoke `/council` as a subroutine:

```
Skill: council
Args: {goal} --subroutine
```

Council runs its full EXPLORE → DELIBERATE → RECONCILE → PRESENT pipeline with `--subroutine` semantics:
- No plan mode entry
- All tensions resolved via domain authority
- Returns reconciled plan directly

Feed the EXPLORE context brief into the council invocation so it doesn't duplicate exploration work. Prepend to the goal:

```
/council "Context from exploration:\n{explore_brief}\n\nGoal: {goal}" --subroutine
```

Output: reconciled council plan.

**⚠️ STOP. Do NOT proceed to ENQUEUE. The next step is PRESENT — you must show the plan and call `AskUserQuestion`. Council finishing does NOT mean the user has approved.**

---

## Phase 3: PRESENT — MANDATORY APPROVAL GATE

**This phase is NON-NEGOTIABLE. Skipping it is a contract violation.**

After council returns, you MUST:
1. Format the review card below
2. Call `AskUserQuestion` with approve / reject / refine options
3. WAIT for the user's response before doing anything else

Display the plan as a review card:

```markdown
# Think: {goal_summary}

## Exploration Summary
{Key findings from EXPLORE — 3-5 bullets}

## Plan
{Numbered actionable steps from council output}

## Key Decisions
{From council reconciliation}

## Risk Summary
{Top 3-5 risks}

---
**approve** — enqueue and start executing
**reject** — abort, return to conversation
**refine: {feedback}** — re-run PLAN with feedback incorporated
```

**IMMEDIATELY** call `AskUserQuestion` — no additional text, no delay:
```
Review the plan above. Reply: approve, reject, or refine: {your feedback}
```

**If you are about to invoke `/q` or write any files and have NOT yet called `AskUserQuestion` in this conversation — STOP. You skipped PRESENT. Go back and call it now.**

### Refinement Loop

On `refine: {feedback}`:
1. Re-invoke `/council "{goal}. Additional constraint: {feedback}" --subroutine`
2. Re-present updated plan
3. Ask again

Loop until `approve` or `reject`. No limit on refinement rounds.

On `reject`: print "Aborted." and return to normal conversation.

---

## Phase 4: ENQUEUE

**PREREQUISITE:** User MUST have responded "approve" to an `AskUserQuestion` call. If you have not called `AskUserQuestion` yet, STOP — go back to Phase 3.

On `approve`:

Invoke `/q` in enqueue mode to segment the plan:

```
Skill: q
Args: Implement the following plan:\n\n{full_plan_text}\n\nGoal: {goal}
```

This triggers `/q`'s segment mode:
- Researches codebase for file-disjoint splitting
- Creates numbered `.ai-queue/` instruction files with `<!-- auto-queue -->` headers
- Prints the task walkthrough

**`/q` handles `--no-auto` implicitly when called from enqueue mode** — it creates files but does not start draining, because `/think` controls the transition to execution.

Pass `--no-auto` explicitly:

```
Skill: q
Args: {plan} --no-auto
```

---

## Phase 5: EXECUTE

Immediately after enqueue completes, invoke `/q` bare to enter worker mode:

```
Skill: q
```

This starts the drain loop. The current agent becomes a worker and processes its own queued tasks. Other workers can pick up remaining tasks in parallel from other terminals.

---

## Rules

1. **No plan mode.** Never call `EnterPlanMode`. The skill is read-only by convention during EXPLORE/PLAN/PRESENT. Code changes only happen in EXECUTE (via `/q` worker).
2. **Always council.** Every task gets `/council --subroutine`. No complexity branching, no "too simple to council" shortcut.
3. **Single approval gate.** One `approve` from user triggers enqueue + execute. No intermediate confirmations.
4. **Lightweight.** No roadmap files, no saga/epic hierarchy, no GitHub integration. That's `/scope`'s job.
5. **Self-sufficient.** After enqueue, this agent becomes a worker. It can drain all tasks alone. Additional `/q` workers are optional parallelism.
6. **No edits before approval.** EXPLORE and PLAN phases are strictly read-only. The first write to disk is `.ai-queue/` files in ENQUEUE.

---

## Role Boundary

- `/think` = orchestrate plan -> approve -> enqueue -> become worker
- `/council` = deliberation engine (called as `--subroutine`)
- `/q` = task segmentation (enqueue) + execution (worker mode)
- `/scope` = full saga/epic lifecycle (not involved here)

`/think` is NOT an orchestrator in the `/scope` sense. It doesn't manage epics, stages, or GitHub tracking. It's a convenience pipeline: plan once, approve once, execute.
