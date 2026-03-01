---
name: saga
description: "Define, scope, and orchestrate large initiatives from idea to shipped software through interactive requirements gathering, PRD creation, and multi-epic execution."
license: MIT
metadata:
  author: Lucas Castro
  version: 2.0.0
---

# Saga

Takes a high-level goal ("build a consulting dashboard") and guides it from idea through requirements, planning, and implementation across multiple epics. The DISCOVER and DEFINE phases are interactive (human-in-the-loop). EXECUTE and beyond are autonomous, delegating to the `epic` skill.

---

## Invocation

```
/saga                        — Resume saga execution (orchestrator mode)
/saga {goal description}     — Start a new saga
saga configure               — (Re)configure PM integration, ownership mode, notifications
saga update                  — Update an existing saga (PRD, epics, dependencies)
saga status                  — Show current saga progress
saga abort                   — Abort the current saga (preserves all work)
```

**Disambiguation:**
- `/saga` alone (no further text) → resume execution of the active saga
- `/saga {text}` → start new saga (interactive)
- `saga configure` → reconfigure PM tool and ownership (delegates to `epic configure`, since config is shared)
- `saga update` → update an existing saga interactively
- `saga status` → show progress
- `saga abort` → abort

---

## Architecture

Saga is the definition and scoping layer. Epic is the execution engine. Saga decomposes large goals into epics, then orchestrates their execution sequentially.

```
saga (definition + orchestration)     epic (execution engine)        q (task engine)
┌──────────────────────────────┐     ┌────────────────────────┐     ┌──────────────┐
│ DISCOVER (interactive Q&A)   │     │                        │     │              │
│ DEFINE (summarize + confirm) │     │                        │     │              │
│ DOCUMENT (write PRD)         │     │                        │     │              │
│ DECOMPOSE (plan epics)       │     │                        │     │              │
│ EXECUTE ─────────────────────────▶ │ PLAN + BREAKDOWN       │     │              │
│   (becomes epic orchestrator)│     │ EXECUTE ───────────────────▶ │ QTM drain    │
│                              │     │ VERIFY → ITERATE       │     │              │
│ REVIEW (between epics) ◀─────────  │ ADVANCE → PR           │     │              │
│ ADVANCE → next epic ─────────────▶ │ next epic...           │     │              │
│ COMPLETE                     │     │                        │     │              │
└──────────────────────────────┘     └────────────────────────┘     └──────────────┘
```

### Document Hierarchy

| Level | Document | Purpose | Location |
|-------|----------|---------|----------|
| Saga | PRD | What to build and why — requirements, user stories, constraints, non-goals | `.ai-sagas/docs/<slug>/prd.md` |
| Saga | Saga Roadmap | Epic list, dependencies, ordering, status | `.ai-sagas/roadmaps/<slug>.md` |
| Epic | Tech Spec | How to build this slice — architecture, APIs, data models | `.ai-epics/docs/<slug>/tech-spec.md` |
| Epic | Epic Roadmap | Stages, acceptance criteria, iteration counts | `.ai-epics/roadmaps/YYYY-MM-DD-<slug>.md` |

The saga PRD is the source of truth for *requirements*. Each epic's tech spec is the source of truth for *implementation*. They don't duplicate each other — the tech spec references the PRD for context.

### Terminal Model

```
Terminal 1: /saga {goal}   → interactive (DISCOVER → DEFINE → DOCUMENT → DECOMPOSE) → exits
Terminal 1: /saga           → saga orchestrator (runs epics sequentially, acts as epic orchestrator)
Terminal 2: /q              → worker (stays alive across epics via relay)
Terminal 3: /q              → worker (stays alive across epics via relay)
```

The saga orchestrator *becomes* the epic orchestrator for each epic. One agent wearing two hats at different times. Between epics, it wears the saga hat (reviewing, adjusting). During an epic, it wears the epic hat (the normal epic lifecycle). Workers stay alive across epic boundaries via relay — the saga sends `work-queued` (not `epic-done`) between epics to keep workers alive.

### Notifications

The saga skill can send push notifications when human attention is needed (e.g., REVIEW phase detects PRD drift, or a saga-level decision is required).

**Configuration** (in `.ai-sagas/docs/project-setup.md` or `.ai-epics/docs/project-setup.md`):

```markdown
- **Notification channel:** ntfy
- **Notification topic:** {your-ntfy-topic}
```

**Sending a notification:**

```bash
# ntfy (primary — push to phone)
curl -s -d "$MESSAGE" "ntfy.sh/$TOPIC" > /dev/null 2>&1

# osascript (fallback — desktop notification on macOS)
osascript -e "display notification \"$MESSAGE\" with title \"Saga\""
```

If no notification channel is configured, fall back to `osascript` (desktop). If neither is available, just print to the terminal and wait — the orchestrator will be blocked until the human returns.

**When to notify:**
- REVIEW phase detects PRD drift and pauses for human input
- A saga-level HALT (epic failed too many times)
- Saga execution completes (all epics done)

---

## Phase 1: DISCOVER

**Context scope:** Broad — understand what the user wants to build. This phase is interactive.

### Procedure

1. **Acknowledge the goal.** Restate what the user wants to build in one sentence to confirm understanding.

2. **Ask clarifying questions.** Target ~10 questions, grouped by concern. Ask 2-3 at a time (not all 10 at once — that's overwhelming). Adapt follow-up questions based on answers.

   **Question categories** (not all categories apply to every saga):

   | Category | Example questions |
   |----------|------------------|
   | **Users** | Who are the primary users? Are there distinct roles? What's the expected scale? |
   | **Scope** | What's the MVP vs. full vision? What's explicitly out of scope? |
   | **Functional requirements** | What are the core workflows? What data does the system manage? |
   | **Non-functional requirements** | Performance targets? Accessibility requirements? Offline support? |
   | **Technical constraints** | Required stack/framework? Existing systems to integrate with? Deployment target? |
   | **Design** | Brand/visual guidelines? Reference apps or designs? Responsive/multi-platform? |
   | **Auth & security** | Authentication model? Authorization levels? Data privacy requirements? |
   | **Integration** | External APIs? Webhooks? Data import/export? |

3. **Adapt the depth.** Some goals need 5 questions, others need 15. Use judgment:
   - If the goal is narrow and well-defined ("add GitHub status sync to existing app"), fewer questions.
   - If the goal is broad ("build a consulting dashboard from scratch"), more questions.
   - Stop asking when you have enough information to write a PRD with confidence.

4. **Proceed to Phase 2 (DEFINE)** once you have sufficient clarity. Do not ask the user if you should proceed — just transition naturally by presenting the summary.

---

## Phase 2: DEFINE

**Context scope:** Narrow — synthesize the answers from DISCOVER into a clear summary.

### Procedure

1. **Summarize the requirements.** Present a concise summary structured as:

   ```
   --- Summary ---

   **Product:** {one-line description}
   **Users:** {who uses it}
   **Core workflows:**
   1. {workflow 1}
   2. {workflow 2}
   ...

   **Technical approach:** {stack, deployment, key architectural decisions}
   **Scope boundary:** {what's in vs. out}
   **Key constraints:** {anything that limits design choices}
   ---
   ```

2. **Ask for confirmation.** "Does this capture what you want to build? Anything to add, change, or remove?"

3. **Handle the response:**
   - **Confirmed ("yes", "looks good", "proceed"):** → Proceed to Phase 3 (DOCUMENT).
   - **Corrections or additions:** Incorporate feedback, present updated summary, ask again. Loop until confirmed.
   - **Major pivot:** If the user fundamentally changes direction, return to Phase 1 (DISCOVER) with the new context.

---

## Phase 3: DOCUMENT

**Context scope:** Focused — write the PRD from the confirmed summary.

### Procedure

1. **Read project setup.** If `.ai-sagas/docs/project-setup.md` or `.ai-epics/docs/project-setup.md` exists, read it to obtain `owner`, `repo`, and `project_number`.

2. **Generate a saga slug.** Derive a short, kebab-case slug from the goal (e.g., `consulting-dashboard`, `task-manager`).

3. **Write the PRD** at `.ai-sagas/docs/<slug>/prd.md`:

   ```markdown
   ---
   saga: {slug}
   status: draft
   created: YYYY-MM-DD
   author: {user} + Claude
   ---

   # {Product Title}

   ## Overview
   {2-3 sentence product description}

   ## Users & Roles
   {Who uses this and what can each role do}

   ## Functional Requirements

   ### FR-1: {Requirement title}
   {Description}
   **User story:** As a {role}, I want to {action}, so that {benefit}.
   **Acceptance criteria:**
   - [ ] {criterion}

   ### FR-2: {Requirement title}
   ...

   ## Non-Functional Requirements
   - **Performance:** {targets}
   - **Accessibility:** {requirements}
   - **Security:** {requirements}

   ## Technical Constraints
   {Stack, deployment, integrations, etc.}

   ## Scope Boundary
   **In scope:** {what's included}
   **Out of scope:** {what's explicitly excluded}

   ## Open Questions
   - {Any unresolved questions that may affect implementation}
   ```

4. **Commit the PRD:**
   ```bash
   git checkout main
   git checkout -b saga/<slug>
   git add .ai-sagas/docs/<slug>/prd.md
   git commit -m "docs(<slug>): add PRD for <slug> saga"
   git push -u origin saga/<slug>
   ```

   **Note:** The saga branch (`saga/<slug>`) is used only for saga-level documents (PRD, saga roadmap). Each epic creates its own `epic/<slug>` branch from `main` for actual code changes. The saga branch does not accumulate code — it's a documentation branch.

5. **Update the PRD status** to `active`.

6. **Present the PRD to the user** with a brief summary. Ask: "PRD looks good? If yes, I'll break this down into epics."

   - **Confirmed:** Proceed to Phase 4 (DECOMPOSE).
   - **Changes needed:** Edit the PRD, re-present, loop until confirmed.

---

## Phase 4: DECOMPOSE

**Context scope:** Medium — read the PRD + codebase structure to determine the right epic breakdown.

### Procedure

1. **Research the codebase** (if an existing project). Understand the project structure, existing patterns, and technical landscape.

2. **Break the PRD into epics.** Each epic should be:
   - **Self-contained** — delivers user value on its own (behind a feature flag)
   - **Coherent** — has a clear theme (e.g., "auth system", "dashboard views", "GitHub integration")
   - **Ordered** — dependencies are explicit
   - **Sized appropriately** — achievable in a few stages (not a saga of its own)

   **Decomposition heuristic:** Group related functional requirements into epics. If an epic would require more than ~5 stages, consider splitting it further.

3. **Determine dependencies.** For each epic, list which other epics must complete first. Common dependency patterns:
   - **Foundation first:** Data models, auth, config → everything else
   - **Core before extensions:** CRUD operations → integrations, advanced features
   - **Independent features:** Features that don't share data or APIs can be parallel-ready

4. **Create a saga roadmap** at `.ai-sagas/roadmaps/<slug>.md`:

   ```markdown
   ---
   saga: {slug}
   status: planning
   created: YYYY-MM-DD
   ---

   # Saga: {title}

   - **Branch:** saga/{slug}
   - **PRD:** `.ai-sagas/docs/<slug>/prd.md`
   - **GitHub Issue:** #{number}   ← filled after step 6
   - **Created:** YYYY-MM-DD
   - **Status:** planning

   ## Epic 1: {title}
   **Objective:** {what this epic delivers to users}
   **PRD coverage:** FR-1, FR-2   ← which functional requirements this epic addresses
   **Dependencies:** none
   **Estimated stages:** ~N
   **Epic slug:** {epic-slug}
   **Epic Roadmap:** (filled during EXECUTE)
   **Status:** pending

   ## Epic 2: {title}
   **Objective:** {what this epic delivers}
   **PRD coverage:** FR-3, FR-4
   **Dependencies:** Epic 1
   **Estimated stages:** ~N
   **Epic slug:** {epic-slug}
   **Status:** pending

   ## Epic 3: {title}
   **Objective:** {what this epic delivers}
   **PRD coverage:** FR-5
   **Dependencies:** Epic 1
   **Estimated stages:** ~N
   **Epic slug:** {epic-slug}
   **Status:** pending

   ## Epic 4: {title}
   **Objective:** {what this epic delivers}
   **PRD coverage:** FR-6, FR-7
   **Dependencies:** Epic 2, Epic 3
   **Estimated stages:** ~N
   **Epic slug:** {epic-slug}
   **Status:** pending
   ```

5. **Create the saga issue in the configured PM tool.**

   Read the PM configuration from `.ai-epics/docs/project-setup.md` (see epic's `references/pm-integration.md`):
   - **owner mode:** Create the saga issue using the configured PM tool.
   - **contributor mode:** Ask the user for the existing issue ID/URL. Skip issue creation.
   - **none:** Skip all PM operations.

   The examples below show GitHub (owner mode). For other tools, consult epic's `references/pm-integration.md`.

   **Create the saga GitHub Issue (owner mode):**

   ```bash
   gh issue create \
     --title "Saga: {title}" \
     --label "saga" \
     --repo OWNER/REPO \
     --body "$(cat <<'EOF'
   ## {title}

   **PRD:** `.ai-sagas/docs/{slug}/prd.md`
   **Saga Roadmap:** `.ai-sagas/roadmaps/{slug}.md`
   **Branch:** `saga/{slug}`

   ### Epics
   - [ ] Epic 1: {title}
   - [ ] Epic 2: {title} (depends on: Epic 1)
   - [ ] Epic 3: {title} (depends on: Epic 1)
   - [ ] Epic 4: {title} (depends on: Epic 2, Epic 3)

   ### Success Criteria
   - [ ] All epics complete
   - [ ] All PRD requirements addressed
   - [ ] All tests pass
   - [ ] All accessibility audits pass
   EOF
   )"
   ```

   If the `saga` label doesn't exist, create it first:
   ```bash
   gh label create "saga" --description "Large multi-epic initiative" --color "7B61FF" --repo OWNER/REPO 2>/dev/null || true
   ```

   Update the saga roadmap with the issue number.

6. **Commit the saga roadmap:**
   ```bash
   git add .ai-sagas/roadmaps/<slug>.md
   git commit -m "docs(<slug>): add saga roadmap with epic breakdown"
   git push
   ```

7. **Present the epic breakdown to the user.** Show:
   ```
   --- Saga: {title} ---
   PRD: .ai-sagas/docs/{slug}/prd.md
   Roadmap: .ai-sagas/roadmaps/{slug}.md
   Issue: #{number}

   Epics (execution order):
     1. {title} — no dependencies
     2. {title} — depends on: Epic 1
     3. {title} — depends on: Epic 1 (parallel-ready with Epic 2)
     4. {title} — depends on: Epic 2, Epic 3

   To start execution:
     Terminal 1: /saga        (orchestrator — runs epics sequentially)
     Terminal 2: /q           (worker — stays alive across epics)
     Terminal 3: /q           (worker — stays alive across epics)
   ---
   ```

8. **Exit.** The `/saga {goal}` agent exits here. Execution happens via `/saga` (bare) in a fresh context.

---

## Phase 5: EXECUTE

**Context scope:** Per-epic — the saga orchestrator context-switches between saga-level concerns (between epics) and epic-level concerns (during an epic).

This phase runs when `/saga` (bare) is invoked.

### Procedure

1. **Find the active saga roadmap.** Scan `.ai-sagas/roadmaps/` for a file with `Status: planning` or `Status: in-progress`. If none found, print "No active saga found. Use `/saga {goal}` to start one." and exit. If multiple found, use most recently modified and warn.

2. **Read the saga roadmap.** Extract epic list, dependencies, and statuses.

3. **Update saga status** to `in-progress` (if not already).

4. **Ensure relay is running.** Invoke `/relay`.

5. **Find the next ready epic.** Scan for the first epic whose:
   - Status is `pending`
   - All dependencies have status `complete`

   If no epic is ready (dependency deadlock or all complete), handle accordingly:
   - All complete → proceed to Phase 7 (COMPLETE)
   - Deadlock → HALT and notify the user

6. **Write the tech spec** for this epic. Read the PRD + the saga roadmap + the current codebase state. Create the tech spec at `.ai-epics/docs/<epic-slug>/tech-spec.md`:

   ```markdown
   ---
   epic: {epic-slug}
   saga: {saga-slug}
   prd: ../.ai-sagas/docs/{saga-slug}/prd.md
   created: YYYY-MM-DD
   ---

   # Tech Spec: {Epic Title}

   ## Context
   {Which PRD requirements this epic addresses — reference FR numbers}
   {What prior epics have established (if any)}

   ## Architecture

   ### Data Model
   {New or modified models/schemas}

   ### API Surface
   {New endpoints, hooks, or interfaces}

   ### Component Structure
   {New components or modifications to existing ones}

   ## Implementation Approach
   {Key decisions: libraries, patterns, migration strategy}

   ## Dependencies
   {External packages, APIs, or services needed}

   ## Risks & Mitigations
   {What could go wrong and how to handle it}

   ## Acceptance Criteria
   {Derived from PRD — specific, testable criteria for this epic}
   ```

   Commit the tech spec:
   ```bash
   git checkout main
   git add .ai-epics/docs/<epic-slug>/tech-spec.md
   git commit -m "docs(<epic-slug>): add tech spec for <epic-slug> epic"
   git push
   ```

7. **Update the saga roadmap:** Set this epic's status to `in-progress`. Record the epic roadmap path once created.

8. **Invoke epic PLAN.** Execute the epic skill's Phase 1 (PLAN) for this epic. The epic goal description should reference both the PRD and the tech spec:

   ```
   /epic {Epic title}: {Epic objective}.
   PRD: .ai-sagas/docs/{saga-slug}/prd.md
   Tech Spec: .ai-epics/docs/{epic-slug}/tech-spec.md
   Saga: .ai-sagas/roadmaps/{saga-slug}.md
   ```

   This creates the epic branch, feature flag, epic roadmap, GitHub issues, and draft PR.

9. **Transition to epic orchestrator mode.** Execute the epic's lifecycle loop:
   - BREAKDOWN → EXECUTE → VERIFY → ITERATE/ADVANCE → PR
   - This is the standard `/epic` (bare) behavior, but driven by the saga orchestrator instead of a separate invocation.
   - Workers (`/q`) in other terminals participate as usual.

   **Orchestrator state file integration:** When the epic's Phase 3 (EXECUTE) writes the orchestrator state file, it MUST include the `saga` field so that post-clear recovery can trace back to the saga context:
   ```json
   {
     "role": "orchestrator",
     "pid": 36295,
     "saga": {
       "roadmap": ".ai-sagas/roadmaps/<slug>.md",
       "currentEpic": <N>
     },
     "epic": {
       "roadmap": ".ai-epics/roadmaps/YYYY-MM-DD-<epic-slug>.md",
       "currentStage": <N>,
       "stageBranch": "<prefix>/<slug>/<stage-title-slug>",
       "returnTo": "verify"
     }
   }
   ```
   The `saga` field is what distinguishes a saga-driven epic from a standalone epic. It enables the agent to recover the full saga → epic → stage context after any `/clear`.

10. **When the epic completes** (Phase 7: PR is done, PR is created and ready for review), the epic's COMPLETION phase will detect the `saga` field in the state file and **skip deleting it**. Control returns to the saga orchestrator. Update the state file to reflect that the epic is done and the saga should proceed to REVIEW:
    ```bash
    # Update state file — remove epic, keep saga context
    cat > .ai-queue/.orchestrator-state.json << EOF
    {
      "role": "orchestrator",
      "pid": $PPID,
      "saga": {
        "roadmap": ".ai-sagas/roadmaps/<slug>.md",
        "currentEpic": <N>,
        "returnTo": "review"
      }
    }
    EOF
    ```
    Proceed to Phase 6 (REVIEW).

---

## Phase 6: REVIEW

**Context scope:** Saga-level — compare what was built against the PRD. This phase runs between epics.

### Procedure

1. **Clear context:** `/clear`

2. **Read the PRD and saga roadmap.** Check what was expected vs. what was delivered.

3. **Assess PRD alignment.** For each functional requirement covered by the just-completed epic:
   - Was it fully addressed?
   - Did implementation reveal new requirements?
   - Do remaining epics need adjustment?

4. **Decision:**

   - **No drift detected (common case):** Auto-continue to next epic. Log "REVIEW: Epic {N} aligned with PRD. Advancing."
   - **Minor drift:** Update the saga roadmap with notes. Auto-continue but log the drift for the user to see later.
   - **Significant drift:** PAUSE. This means the PRD assumptions were wrong in a way that affects remaining epics. Actions:
     1. **Notify the user** (ntfy push notification + desktop notification + terminal message):
        ```bash
        # ntfy
        curl -s -d "Saga paused: PRD drift detected after Epic $N. Review needed." \
          "ntfy.sh/$TOPIC" > /dev/null 2>&1
        # macOS desktop
        osascript -e 'display notification "PRD drift detected after Epic '"$N"'. Review needed." with title "Saga: '"$TITLE"'"'
        ```
     2. Print a clear summary of the drift and what needs to change.
     3. Wait for the user to return and provide direction.
     4. Update the PRD if needed. Adjust remaining epics if needed.
     5. Resume.

5. **Update the saga roadmap:** Set the completed epic's status to `complete`.

6. **Check off the epic in the saga GitHub issue body:**
   ```bash
   BODY=$(gh issue view $SAGA_ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
   UPDATED=$(echo "$BODY" | sed "s/- \[ \] Epic $EPIC_NUMBER: /- [x] Epic $EPIC_NUMBER: /")
   gh issue edit $SAGA_ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED"
   ```

7. **Check for more epics:**
   - **More epics ready:** Return to Phase 5 (EXECUTE) for the next epic.
   - **All epics complete:** Proceed to Phase 7 (COMPLETE).

### Worker Lifecycle Across Epics

Between epics, keep workers alive. Do NOT send `epic-done` after each individual epic (that would kill the workers). Instead:

- After each epic's PR phase completes, send `work-queued` via relay to signal "more work is coming."
- Workers stay in RFX mode between epics, ready to wake when the next epic's BREAKDOWN queues segments.
- Only send `epic-done` after the **last** epic in the saga completes. This is the signal for workers to exit.

---

## Phase 7: COMPLETE

### Procedure

1. **Send `epic-done` event via relay** (if relay is running). This signals all workers to exit.

2. **Update the saga roadmap:** Set status to `done`.

3. **Update the PRD status** to `shipped`.

4. **Close the saga GitHub Issue** with a comment:
   ```bash
   gh issue close $SAGA_ISSUE_NUMBER --repo OWNER/REPO \
     --comment "Saga completed. All epics delivered."
   ```

5. **Notify the user:**
   ```bash
   # ntfy
   curl -s -d "Saga complete: $TITLE. All epics delivered." \
     "ntfy.sh/$TOPIC" > /dev/null 2>&1
   # macOS desktop
   osascript -e 'display notification "All epics delivered." with title "Saga Complete: '"$TITLE"'"'
   ```

6. **Archive:**
   - Move the saga roadmap to `.ai-sagas/archive/`
   - The PRD stays in `.ai-sagas/docs/<slug>/` (it's a permanent reference)
   - Commit and push on the saga branch

7. **Delete the orchestrator state file.** The saga is complete — no more orchestration context is needed:
   ```bash
   rm -f .ai-queue/.orchestrator-state.json
   ```

8. **Call `/relay stop`** (smart stop — last agent out turns off the lights).

9. **Print final summary:**
   ```
   --- Saga Complete: {title} ---
   PRD: .ai-sagas/docs/{slug}/prd.md
   Epics delivered: {N}
   Total PRs: {N}

   All epic PRs are ready for review.
   ---
   ```

---

## `saga status`

Print a summary of the current saga:

```
Saga: {title}
PRD:    .ai-sagas/docs/{slug}/prd.md
Status: {status}
Issue:  #{number}

Epics:
  1. {title} — complete ✓
  2. {title} — in-progress (Stage 2 of 4)
  3. {title} — pending (depends on: Epic 1) — ready
  4. {title} — pending (depends on: Epic 2, Epic 3) — blocked

Roadmap: .ai-sagas/roadmaps/{slug}.md
```

Read the saga roadmap and each referenced epic roadmap to generate this output.

---

## `saga abort`

Abort the current saga without destroying work:

1. **Do NOT delete** any branches, roadmaps, PRDs, or completed work.
2. **Update the saga roadmap:** Set status to `aborted`.
3. **Abort any in-progress epic** by invoking `epic abort` for it.
4. **Close the saga issue** (owner mode only) with a comment: "Saga aborted. All work preserved." In contributor mode, add a comment but do not close.
5. **Notify the user.**
6. **Inform the user** where to find preserved work (branches, PRDs, tech specs).

---

## `saga configure`

(Re)configure PM integration, ownership mode, and notifications. Delegates to `epic configure` since the configuration is shared (both saga and epic read from `.ai-epics/docs/project-setup.md`).

### Procedure

1. Run the `epic configure` flow (see epic's SKILL.md → `epic configure`).
2. That's it — saga reads the same config file.

If `epic configure` hasn't been run yet (no project-setup.md exists), `saga configure` will create it with the full configuration flow.

---

## `saga update`

Update an existing saga interactively — modify the PRD, add/remove/reorder epics, change dependencies.

### Procedure

1. **Find active sagas.** Scan `.ai-sagas/roadmaps/` for files with status that is NOT `done` or `aborted`.

2. **Select the saga:**
   - If **only one** active saga: select it automatically. Print: "Active saga: {title}."
   - If **multiple** active sagas: present a numbered list and ask the user to choose.
   - If **none**: print "No active sagas found." and exit.

3. **Read the selected saga's roadmap and PRD.** Show current state: epics, dependencies, statuses.

4. **Ask what to update.** Present options:
   ```
   What would you like to update?
   a) Update the PRD (requirements have changed)
   b) Add an epic
   c) Remove or skip an epic
   d) Reorder epics or change dependencies
   e) Update saga metadata (title, scope boundary)
   f) Link to an existing PM ticket
   g) Something else
   ```

5. **Walk through the changes conversationally:**

   **(a) Update the PRD:**
   - Ask what changed. New requirements? Changed scope? Removed features?
   - Read the current PRD.
   - Make the edits. Update functional requirements, scope boundary, or constraints.
   - Check if the changes affect any existing epics. If so, note which epics may need adjustment.
   - Commit the updated PRD.

   **(b) Add an epic:**
   - Ask for the epic title, objective, PRD coverage (which FRs), and estimated stages.
   - Ask where it fits in the dependency graph (depends on which epics? blocks which epics?).
   - Add the epic to the saga roadmap.
   - Create a PM issue for it if in owner mode.
   - Commit the updated roadmap.

   **(c) Remove or skip an epic:**
   - Show the list of non-complete epics.
   - Ask which one to remove/skip.
   - Set its status to `skipped` (don't delete — preserve audit trail).
   - Check if any other epics depend on it. If so, warn the user and ask how to handle (remove dependency, skip those too, etc.).
   - Update the roadmap.

   **(d) Reorder epics or change dependencies:**
   - Show current order and dependency graph.
   - Ask for the changes.
   - Validate: completed epics can't be reordered. Circular dependencies are rejected.
   - Update the roadmap.

   **(e) Update saga metadata:**
   - Show current metadata.
   - Ask what to change. Title and scope boundary can be updated.

   **(f) Link to PM ticket:**
   - Ask for the issue ID/URL.
   - Store it in the roadmap.

   **(g) Something else:**
   - Free-form. Parse the user's request and make the appropriate changes.

6. **Commit the updated files:**
   ```bash
   git add .ai-sagas/
   git commit -m "docs({slug}): update saga roadmap/PRD"
   git push
   ```

7. **Confirm** the changes and show the updated state.

---

## `/saga` (bare) — Resume Saga Execution

When invoked without arguments, `/saga` resumes execution of the active saga.

### Procedure

1. **Check for orchestrator state file first.** Before scanning roadmaps, check if `.ai-queue/.orchestrator-state.json` exists and its `pid` matches `$PPID`. If the state file has a `saga` field, this agent is recovering from a `/clear` during an active saga orchestration session. Read the saga roadmap path and `returnTo` phase from the state file, then skip to step 4 using the state file data. If the state file also has an `epic` field, the agent was mid-epic — resume at the epic level first (delegate to `/epic` bare resume logic which will handle the epic `returnTo` phase, then return to saga context). This is the **post-clear recovery path**.

2. **Find the active saga roadmap.** Scan `.ai-sagas/roadmaps/` for a file with `Status: in-progress`. If none found, print "No active saga found. Use `/saga {goal}` to start one." and exit.

3. **Read the saga roadmap.** Extract epic list, dependencies, statuses, PRD path.

4. **Ensure relay is running.** Invoke `/relay`.

5. **Determine the current state** (from the roadmap, or from the state file's `returnTo` if using post-clear recovery):

   | State | Action |
   |-------|--------|
   | State file says `returnTo: "review"` | Enter Phase 6 (REVIEW) for the current epic |
   | An epic is `in-progress` | Resume that epic (enter epic orchestrator mode for it) |
   | No epic is in-progress, ready epics exist | Enter Phase 5 (EXECUTE) for the next ready epic |
   | All epics `complete` | Enter Phase 7 (COMPLETE) |
   | Dependency deadlock | HALT and notify |

6. **Enter the execution loop.** Follow the EXECUTE → REVIEW → ADVANCE cycle until all epics are complete.

---

## Error Handling

### Epic Fails Too Many Times

If an epic hits the iteration limit (5 per stage or 20 total) and HALTs:
1. The saga orchestrator notes the failure in the saga roadmap.
2. **Notify the user** via ntfy + desktop notification.
3. Wait for human intervention. The user can:
   - Fix the issue and resume (`/saga`)
   - Skip the epic (`saga skip {N}`) — marks it as `skipped` and moves on
   - Abort the saga (`saga abort`)

### PRD Drift Detection

During REVIEW, the saga compares the epic's output against PRD requirements. Drift is detected when:
- An epic's implementation deviated significantly from its PRD coverage
- New requirements emerged that aren't in the PRD
- A requirement turned out to be infeasible

Minor drift is logged. Significant drift pauses for human review.

### Dependency Deadlock

If no pending epic has all dependencies met and not all epics are complete, the saga is in deadlock (usually a planning error). HALT and notify.

---

## Context Isolation Rules

| Phase | Fresh Context? | Reads | Interactive? |
|-------|---------------|-------|-------------|
| DISCOVER | No (first phase) | User's answers | Yes |
| DEFINE | No (continues from DISCOVER) | Accumulated Q&A | Yes |
| DOCUMENT | No (continues from DEFINE) | Summary | Yes (confirmation) |
| DECOMPOSE | No (continues from DOCUMENT) | PRD + codebase | Yes (confirmation) |
| EXECUTE | Yes (`/clear`) | Saga roadmap + PRD + epic context | No |
| REVIEW | Yes (`/clear`) | PRD + saga roadmap + epic output | Conditional |
| COMPLETE | No (follows REVIEW) | Saga roadmap | No |

**Between epics:** Always clear context (`/clear`). Each epic starts fresh. The saga roadmap and PRD are the durable state that persists across context boundaries.

---

## Saga Roadmap File Format

```markdown
---
saga: {slug}
status: planning | in-progress | done | aborted
created: YYYY-MM-DD
---

# Saga: {title}

- **Branch:** saga/{slug}
- **PRD:** `.ai-sagas/docs/<slug>/prd.md`
- **GitHub Issue:** #{number}
- **Created:** YYYY-MM-DD
- **Status:** planning | in-progress | done | aborted
- **Notification topic:** {ntfy-topic}   ← optional

## Epic 1: {title}
**Objective:** {what this epic delivers}
**PRD coverage:** FR-1, FR-2
**Dependencies:** none
**Estimated stages:** ~N
**Epic slug:** {epic-slug}
**Epic Roadmap:** .ai-epics/roadmaps/YYYY-MM-DD-{epic-slug}.md
**Tech Spec:** .ai-epics/docs/{epic-slug}/tech-spec.md
**Status:** pending | in-progress | complete | skipped | aborted
**Review notes:** {any drift or adjustments noted during REVIEW}

## Epic 2: {title}
...
```

**Location:** `.ai-sagas/roadmaps/<slug>.md`
**Archive:** Move to `.ai-sagas/archive/` on completion or abort.
