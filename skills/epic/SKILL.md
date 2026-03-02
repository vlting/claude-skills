---
name: epic
description: "Orchestrate multi-stage development initiatives through a plan-execute-verify-iterate loop."
license: MIT
metadata:
  author: Lucas Castro
  version: 7.0.0
---

# Epic

Orchestrates large development goals through a multi-stage iterative workflow. Each stage is broken down, executed via Q, verified, and iterated until production-ready. Each stage produces a focused PR to the epic branch, and the final epic PR to main is already fully pre-reviewed.

---

## Invocation

```
/epic                        — Resume epic execution (orchestrator mode)
/epic {goal description}     — Start a new epic
epic init                    — First-time repo setup (includes PM tool configuration)
epic configure               — (Re)configure PM integration, ownership mode, notifications
epic update                  — Update an existing epic (stages, criteria, metadata)
epic status                  — Show current epic progress
epic abort                   — Abort the current epic (preserves branches and files)
```

**Disambiguation:**
- `/epic` alone (no further text) → resume execution of the active epic
- `/epic {text}` → start new epic
- `epic init` → first-time setup (read `references/init.md` and follow its procedure)
- `epic configure` → reconfigure PM tool and ownership (read `references/pm-integration.md`)
- `epic update` → update an existing epic interactively
- `epic status` → show progress
- `epic abort` → abort

---

## Architecture

Epic is the orchestration layer. Q is the execution engine. Relay is the communication layer.

```
epic (orchestrator)              relay (communication)           q (execution engine)
┌──────────────────────┐         ┌─────────────────────┐        ┌───────────────────────┐
│ PLAN → BREAKDOWN ──────event──▶│ "work-queued"  ─────────────▶│ workers wake from RFX │
│ EXECUTE (/q) ─────────────────────────────────────────────────▶│ QTM drain loop        │
│ VERIFY → ITERATE ──────event──▶│ "work-queued"  ─────────────▶│ workers wake from RFX │
│ PR → COMPLETE ─────────event──▶│ "epic-done"    ─────────────▶│ workers exit          │
└──────────────────────┘         └─────────────────────┘        └───────────────────────┘
```

- **Epic** manages: roadmaps, stages, quality gates, iteration loops, PR creation, GitHub tracking.
- **Q** manages: task files, segmentation, worktree execution, parallel safety, context clearing.
- **Relay** manages: inter-agent events, role enforcement, disconnect detection.

### Multi-Agent Workflow

Epic supports running multiple agents in parallel via relay:

```
Terminal 1: /epic {goal}   → PLAN + BREAKDOWN → starts relay → exits
Terminal 1: /epic          → orchestrator (lifecycle loop + worker)
Terminal 2: /q             → worker (drains tasks, stays alive via relay)
Terminal 3: /q             → worker (drains tasks, stays alive via relay)
```

**Two agent roles:**

| Role | Command | Responsibilities |
|------|---------|-----------------|
| Orchestrator | `/epic` (bare) | Drives the lifecycle: BREAKDOWN → EXECUTE → VERIFY → ITERATE → ADVANCE → PR. Also participates as a worker during EXECUTE. |
| Worker | `/q` | Drains tasks from the queue. Stays alive between stages via relay events. |

**Role enforcement:** When `/epic` (bare) starts, it connects to relay as `orchestrator`. If another orchestrator is already connected, relay responds with `role-taken` and the agent falls back to `/q` (worker mode). Only one orchestrator per epic.

**Worker lifecycle with relay:**
1. Worker enters QTM, drains available tasks
2. Queue empties → enters RFX mode
3. RFX blocks on relay socket (no polling)
4. Orchestrator finishes VERIFY → ITERATE → BREAKDOWN → sends `work-queued`
5. Workers wake instantly, re-enter drain loop
6. Repeat until orchestrator sends `epic-done`

Both Q workers and the Epic orchestrator call `/relay stop` on exit. The smart stop refuses if agents are still connected — only the last agent out actually stops relay. This eliminates the race condition between Epic sending `epic-done` and workers disconnecting.

Q workers also start relay at QTM startup if it's not already running, so relay is always available even if workers start before the orchestrator.

### Feature Flags

Two levels of feature flags exist in the epic system:

1. **Skill-level flags** (`~/.claude/skills/epic/config/flags.json`) — control epic skill behavior itself (e.g., `branch_prefix_routing`). These are checked by the skill before using flagged behaviors.
2. **Project-level flags** (`config/flags.ts` in the project repo) — a single TypeScript module with a typed registry, runtime helper, and derived types. Every epic creates a project-level flag. See `references/feature-flags.md` for the full system.

### Reference Documents

- **Full architecture** → `references/architecture.md` (context isolation, storage model, skill topology, engineering best practices)
- **`epic init` procedure** → `references/init.md` (first-time repo setup, includes PM configuration)
- **PM integration** → `references/pm-integration.md` (tool abstraction, ownership modes, per-tool operations)
- **Feature flags** → `references/feature-flags.md` (project-level flags, single TS module, flag lifecycle)

### Project Board Integration

GitHub Projects v2 uses GraphQL node IDs for all mutations. To update a project item's status, you need three IDs: the **project node ID**, the **item node ID**, and the **status field option ID**. These are resolved once during Phase 1 and stored in the roadmap file for use in later phases.

**Resolving IDs (done once in Phase 1):**

```bash
# 1. Get the project node ID
PROJECT_NODE_ID=$(gh project list --owner OWNER --format json | jq -r ".projects[] | select(.number == $PROJECT_NUMBER) | .id")

# 2. Add the issue and capture the item node ID
ITEM_NODE_ID=$(gh project item-add $PROJECT_NUMBER --owner OWNER --url "$ISSUE_URL" --format json | jq -r '.id')

# 3. Get the Status field ID and option IDs
FIELD_JSON=$(gh project field-list $PROJECT_NUMBER --owner OWNER --format json)
STATUS_FIELD_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .id')

# Extract option IDs (names depend on your board's configuration — common defaults shown)
echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .options[] | "\(.name): \(.id)"'
```

**Updating status (used in later phases):**

```bash
gh project item-edit \
  --project-id "$PROJECT_NODE_ID" \
  --id "$ITEM_NODE_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPTION_ID"
```

**Updating issue body checkboxes (for acceptance criteria):**

```bash
# Read current body, toggle a checkbox, write it back
BODY=$(gh issue view $ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
UPDATED=$(echo "$BODY" | sed 's/- \[ \] {criterion text}/- [x] {criterion text}/')
gh issue edit $ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED"
```

**All project board operations are best-effort.** If any `gh project` command fails (auth scope, network, project not found), log the error and continue. The epic workflow must never block on a board update.

**Stored in the roadmap metadata** (added during Phase 1):

```markdown
- **Project Node ID:** PVT_xxxxx
- **Project Item ID:** PVTI_xxxxx          ← epic issue's board item
- **Status Field ID:** PVTSSF_xxxxx
- **Status Options:** Planning=xxx, Todo=xxx, In Progress=xxx, In Review=xxx, Done=xxx
```

Each stage in the roadmap also stores its own board item ID (see Phase 1, step 7).

---

## Phase 1: PLAN

**Context scope:** Broad — read codebase structure, README, existing patterns widely.

### Procedure

1. **Research the codebase.** Understand the project structure, conventions, and existing patterns relevant to the goal. Read `AI_CONSTITUTION.md`, `DESIGN_CONSTITUTION.md`, and any relevant `*.spec.md` or `*.contract.md` files.

2. **Read project setup.** If `.ai-epics/docs/project-setup.md` exists, read it to obtain `owner`, `repo`, and `project_number`. These values are used in steps 6–7 for GitHub integration. If this file does not exist, auto-detect owner/repo from `git remote get-url origin` and skip project board integration. Consider suggesting `epic init` if the file is missing.

3. **Generate an epic slug.**
   - Derive a short, kebab-case slug from the goal (e.g., `kitchen-sink-a11y`, `auth-overhaul`).
   - The epic branch always uses the `epic/` prefix. Stage-level prefix classification happens in Phase 2 (BREAKDOWN).

4. **Create the epic branch:**
   ```bash
   git checkout -b epic/<slug> main
   git push -u origin epic/<slug>
   ```

4.5. **Create the epic's feature flag.**

   Read the `flags_dir` path from `.ai-epics/docs/project-setup.md` (default: `config`).
   Derive the flag name from the slug: replace hyphens with underscores (e.g., `kitchen-sink-a11y` → `kitchen_sink_a11y`).

   If `{flags_dir}/flags.ts` does not exist yet (first epic in the repo), create it from the template in `references/feature-flags.md`.

   Add the flag entry to the `flagRegistry` object in `{flags_dir}/flags.ts`. Insert as the **first entry** (newest first). Write a brief, one-sentence description of what the flag gates.

   ```ts
   const flagRegistry = {
     {flag_name}: {
       description: '{one-sentence description}',
       added: '{YYYY-MM-DD}',
       default: false,
       overrides: { dev: true, staging: true },
     },
     // ... existing flags
   } as const satisfies Record<string, FlagDefinition>;
   ```

   Commit the flag file on the epic branch:
   ```bash
   git add {flags_dir}/flags.ts
   git commit -m "feat(<slug>): add feature flag for <slug> epic"
   git push
   ```

   See `references/feature-flags.md` for full schema details.

5. **Create a roadmap file** at `.ai-epics/roadmaps/YYYY-MM-DD-<slug>.md`:
   ```markdown
   # Epic: {title}

   - **Branch:** epic/{slug}
   - **Feature flag:** {flag_name}
   - **GitHub Issue:** #{number}   ← filled after step 6
   - **Epic PR:** #{pr_number}   ← filled after step 10
   - **Created:** YYYY-MM-DD
   - **Status:** planning

   ## Stage 1: {title}
   **Objective:** {what this stage accomplishes}
   **Estimated scope:** ~N files, ~N lines
   **GitHub Sub-Issue:** #{sub_issue_number}   ← filled after step 6
   **Stage Branch:** {prefix}/{slug}/{stage-title-slug}   ← filled in Phase 2
   **Stage PR:** #{stage_pr_number}   ← filled in Phase 6
   **Acceptance criteria:**
   - [ ] {criterion 1}
   - [ ] {criterion 2}
   **Status:** pending

   ## Stage 2: {title}
   ...
   ```

   **Staging guidelines:**
   - Each stage should produce a coherent, testable increment
   - Stages are sequential — later stages may build on earlier ones
   - Aim for stages small enough that their segments total < 999 lines
   - If a stage will clearly exceed 999 lines, split it into sub-stages

6. **Create the epic issue and stage sub-issues.**

   Read the PM configuration from `.ai-epics/docs/project-setup.md`. The behavior depends on the configured tool and ownership mode (see `references/pm-integration.md`):

   - **owner mode:** Create the epic issue and stage sub-issues using the configured PM tool.
   - **contributor mode:** Ask the user for the existing epic issue ID/URL. Skip sub-issue creation.
   - **none:** Skip all PM operations.

   The examples below show GitHub (owner mode). For other tools, consult `references/pm-integration.md`.

   First, create the **parent epic issue** (owner mode only):
   ```bash
   gh issue create \
     --title "Epic: {title}" \
     --label "epic" \
     --repo OWNER/REPO \
     --body "$(cat <<'EOF'
   ## {title}

   **Roadmap:** `.ai-epics/roadmaps/YYYY-MM-DD-{slug}.md`
   **Branch:** `epic/{slug}`
   **Feature flag:** `{flag_name}` (disabled in prod until epic completes)

   ### Stages
   - [ ] Stage 1: {title}
   - [ ] Stage 2: {title}
   ...

   ### Acceptance Criteria
   - [ ] All tests pass
   - [ ] Accessibility audits pass
   - [ ] PR(s) under 999 lines each
   EOF
   )"
   ```

   Capture the parent issue number: `EPIC_ISSUE_NUMBER`.

   Then, create a **sub-issue for each stage**:
   ```bash
   gh issue create \
     --title "Stage {N}: {stage title}" \
     --label "stage" \
     --repo OWNER/REPO \
     --body "$(cat <<'EOF'
   **Parent epic:** #{EPIC_ISSUE_NUMBER}
   **Branch:** `epic/{slug}`
   **Feature flag:** `{flag_name}`

   ## Objective
   {stage objective from roadmap}

   ## Acceptance Criteria
   - [ ] {criterion 1}
   - [ ] {criterion 2}
   EOF
   )"
   ```

   After creating each sub-issue, set it as a sub-issue of the parent:
   ```bash
   gh issue edit <SUB_ISSUE_NUMBER> --add-parent EPIC_ISSUE_NUMBER --repo OWNER/REPO
   ```

   > **Note:** If `gh issue edit --add-parent` is not available (older gh version),
   > use the GitHub API or fall back to adding "Parent: #EPIC_ISSUE_NUMBER" in the sub-issue body.

   Update the roadmap file with both the epic issue number and each stage's sub-issue number.

7. **Add to project board and resolve IDs** (if `project_number` from step 2 is available):

   Follow the **Project Board Integration** procedure in the Architecture section to:
   1. Get the project node ID
   2. Add the epic issue to the board and capture the item node ID
   3. Resolve the Status field ID and all option IDs
   4. Set the epic issue's initial status to **"Planning"**:
      ```bash
      gh project item-edit \
        --project-id "$PROJECT_NODE_ID" \
        --id "$ITEM_NODE_ID" \
        --field-id "$STATUS_FIELD_ID" \
        --single-select-option-id "$PLANNING_OPTION_ID"
      ```
      The epic stays in "Planning" for its entire lifecycle until COMPLETION moves it to "Done".
   5. Add each stage sub-issue to the board, capture their item node IDs, and set their initial status to **"Todo"**:
      ```bash
      # For each stage sub-issue
      SUB_ITEM_NODE_ID=$(gh project item-add $PROJECT_NUMBER --owner OWNER --url "$SUB_ISSUE_URL" --format json | jq -r '.id')

      # Set initial status to "Todo"
      gh project item-edit \
        --project-id "$PROJECT_NODE_ID" \
        --id "$SUB_ITEM_NODE_ID" \
        --field-id "$STATUS_FIELD_ID" \
        --single-select-option-id "$TODO_OPTION_ID"
      ```

   Store these in the roadmap file metadata (see format in Project Board Integration section). Each stage in the roadmap should include its board item node ID:
   ```markdown
   **Board Item ID:** PVTI_xxxxx   ← per-stage, for board status updates
   ```

   If any step fails (missing scope, project not found), log the error and continue without board tracking — set `project_number` to null in the roadmap so later phases know to skip board updates.

8. **Update roadmap status** to `in-progress`.

9. **Commit the roadmap file** on the epic branch:
   ```bash
   git add .ai-epics/roadmaps/YYYY-MM-DD-<slug>.md
   git commit -m "docs(<slug>): add roadmap for <slug> epic"
   git push
   ```
   This ensures the roadmap is tracked in git immediately — the user should not have to manage it manually.

10. **Create a draft PR from the epic branch to main.** This PR will accumulate all stage work as it merges in, and will be marked ready for review when all stages are complete.

    ```bash
    PR_URL=$(gh pr create \
      --base main \
      --head epic/<slug> \
      --title "Epic: {title}" \
      --draft \
      --body "$(cat <<'EOF'
    ## {title}

    **Roadmap:** `.ai-epics/roadmaps/YYYY-MM-DD-{slug}.md`
    **Feature flag:** `{flag_name}` (disabled in prod until epic completes)

    ### Stages
    - [ ] Stage 1: {title}
    - [ ] Stage 2: {title}
    ...

    > Each stage is reviewed via its own PR to `epic/<slug>`. Links appear as stages complete.

    Closes #{EPIC_ISSUE_NUMBER}

    Generated with [Claude Code](https://claude.com/claude-code)
    EOF
    )")
    ```

    Capture the PR number and update the roadmap file's `**Epic PR:**` field. Push the update.

11. **Start the relay server.** Invoke `/relay` to ensure the relay is running. This allows worker agents (`/q`) in other terminals to connect immediately. If relay is already running, this is a no-op.

12. **Exit with instructions.** After PLAN + BREAKDOWN complete, print:
    ```
    --- Epic created: {title} ---
    Branch: epic/{slug}
    Draft PR: {PR_URL}
    Roadmap: .ai-epics/roadmaps/YYYY-MM-DD-{slug}.md
    Issue: #{number}
    Stage 1 queued: {N} segments

    To start execution:
      Terminal 1: /epic        (orchestrator — runs lifecycle + works tasks)
      Terminal 2: /q           (worker — drains tasks)
      Terminal 3: /q           (worker — drains tasks)
    ---
    ```
    The `/epic {goal}` agent exits here. Execution happens via `/epic` (bare) in a fresh context.

---

## Phase 2: BREAKDOWN

**Context scope:** Medium — read only the current stage's roadmap section + relevant source directories. Use a fresh context (run `/clear` before starting this phase if prior phases accumulated context).

### Procedure (per stage)

1. **Clear context** if needed: `/clear`

2. **Read the roadmap file** — only the current stage's section. Understand the objective and acceptance criteria.

3. **Deep-research** the relevant codebase areas. Read the files that will be modified or that define patterns to follow.

4. **Assess scope to decide auto-queue vs manual-queue.**

   The risk of wasted compute and cascading errors grows with scope. Use `--no-auto` for large-scope stages so the user can review the task breakdown before agents begin executing.

   **Use `--no-auto` when ANY of these apply:**
   - Stage touches **>15 files** (estimated from research in step 3)
   - Stage involves **cross-cutting concerns** (shared types, provider structure, config, build system)
   - Stage is expected to produce **>5 segments**
   - Stage has **architectural implications** (new patterns, structural changes, dependency changes)

   **Use default auto-queue when:**
   - Stage is scoped to a single module or directory
   - Stage involves leaf-level work (adding/modifying individual components)
   - Estimated segment count is **<=5** and files are clearly disjoint

5. **Create the stage branch.** Classify the branch prefix based on the nature of this stage's work:

     | Prefix | When to use | Examples |
     |--------|------------|---------|
     | `feat/` | New features, new capabilities (default) | "Add theme tokens", "Build auth flows" |
     | `fix/` | Bug fixes | "Fix a11y violations", "Resolve race conditions" |
     | `chore/` | Maintenance, refactoring, tooling | "Refactor module structure", "Update deps" |
     | `docs/` | Documentation-only | "Write API docs", "Add usage examples" |

   Default to `feat/` if the classification is ambiguous. Derive a short stage title slug from the stage objective (e.g., `theme-tokens`, `a11y-fixes`).

   ```bash
   git checkout epic/<slug>
   git pull origin epic/<slug>
   git checkout -b <prefix>/<slug>/<stage-title-slug> epic/<slug>
   git push -u origin <prefix>/<slug>/<stage-title-slug>
   ```

   Update the roadmap's `**Stage Branch:**` field for this stage.

6. **Queue the stage via Q:**
   ```
   q [--no-auto] {Detailed stage description referencing the acceptance criteria.
   All segments should target the stage branch: <!-- target-branch: <prefix>/<slug>/<stage-title-slug> -->
   New behavior should be gated behind the feature flag: {flag_name}}
   ```
   Q will segment the work into file-disjoint instruction files with `<!-- target-branch: <prefix>/<slug>/<stage-title-slug> -->` directives.

   **If `--no-auto` was chosen:** Q will run its **Segment Review Walkthrough** — presenting an executive summary of each segment one at a time and asking the user to approve, refine, or drop each one. Segments with `depends-on` directives correctly block on `-wip.md` files, so it's safe for some segments to be queued while others are still under review. Once the walkthrough completes, all approved segments are queued and ready for execution.

   **If auto-queue was used:** All segments are immediately queued. No review step.

7. **Update the roadmap:** Set this stage's status to `executing` (or `awaiting-review` if `--no-auto` was used and the walkthrough has not yet completed).

8. **Send `work-queued` event via relay** (if relay is running). This wakes any worker agents (`/q`) that are waiting in RFX mode:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'event',event:'work-queued',detail:'stage segments queued'})+'\n');
   setTimeout(() => s.destroy(), 500);
   " "$(pwd)/.ai-relay/relay.sock"
   ```
   Skip this step if relay is not running (no `.ai-relay/relay.sock`).

9. **Proceed to Phase 3 (EXECUTE).** When running as the orchestrator (`/epic` bare), immediately continue to EXECUTE — do not wait for user input. When running as `/epic {goal}` (new epic creation), exit after BREAKDOWN (see Phase 1 step 12).

---

## Phase 3: EXECUTE

**Context scope:** Narrow — Q handles all context management. Each segment runs in its own worktree with its own context.

### Procedure

1. **Move the current stage's sub-issue to "In Progress"** on the project board (if configured):
   ```bash
   gh project item-edit \
     --project-id "$PROJECT_NODE_ID" \
     --id "$STAGE_ITEM_NODE_ID" \
     --field-id "$STATUS_FIELD_ID" \
     --single-select-option-id "$IN_PROGRESS_OPTION_ID"
   ```
   Read the stage's board item ID from the roadmap metadata. Skip if project board is not configured.

2. **Write the orchestrator state file** before entering QTM. This tells QTM to run in orchestrator mode (drain-and-return, no RFX, no `/clear` between tasks):
   ```bash
   cat > .ai-queue/.orchestrator-state.json << EOF
   {
     "role": "orchestrator",
     "pid": $PPID,
     "epic": {
       "roadmap": "<epic-roadmap-path>",
       "currentStage": <N>,
       "stageBranch": "<prefix>/<slug>/<stage-title-slug>",
       "returnTo": "verify"
     }
   }
   EOF
   ```
   If a saga is driving this epic, include the `saga` field as well (see Saga skill docs).

3. **Enter QTM:**
   ```
   /q
   ```
   Because the orchestrator state file exists, QTM will run in **orchestrator mode**: the agent claims and executes segments (like a worker), but when the queue is drained, it **exits QTM and returns control here** instead of entering RFX. Each segment runs in a worktree branched off the stage branch and merges back to the stage branch (not the epic branch or main).

4. **QTM has returned.** All claimable segments have been drained. Verify that all segments of the current stage are archived in `.ai-queue/_completed/`. If some remain active (owned by other agents), wait briefly and re-check, or proceed if only dependency-blocked tasks remain (they'll be handled in a subsequent iteration).

5. **Update the roadmap:** Set this stage's status to `verifying`.

6. **Proceed to Phase 4 (VERIFY).** Continue the lifecycle — do NOT exit or wait for user input.

---

## Phase 4: VERIFY

**Context scope:** Narrow — fresh context. Read only test output + stage acceptance criteria.

### Procedure

1. **Clear context:** `/clear`

2. **Switch to the stage branch:**
   ```bash
   git checkout <prefix>/<slug>/<stage-title-slug>
   git pull origin <prefix>/<slug>/<stage-title-slug>
   ```

3. **Run the test suite:**
   ```bash
   npm test   # or: yarn test, bun test — match the project's test runner
   ```

4. **Run accessibility audits** (if AccessLint MCP is available):
   - Use `audit_html` on key component output
   - Use `diff_html` if fixing prior issues to verify no regressions

5. **Run linting:**
   ```bash
   npm run lint   # or: biome check, etc.
   ```

6. **Evaluate acceptance criteria.** Read the stage's criteria from the roadmap file and check each one.

7. **Update acceptance criteria checkboxes.** For each criterion that passed verification, check it off in the **stage sub-issue** body on GitHub:
   ```bash
   BODY=$(gh issue view $STAGE_SUB_ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
   # For each passing criterion, replace "- [ ] {text}" with "- [x] {text}"
   UPDATED=$(echo "$BODY" | sed 's/- \[ \] {criterion text}/- [x] {criterion text}/')
   gh issue edit $STAGE_SUB_ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED"
   ```
   This keeps the GitHub issue in sync with actual verification results. Criteria that failed remain unchecked — they'll be addressed in ITERATE.

8. **Decision:**
   - **All criteria met, tests pass, no a11y regressions:** → Proceed to Phase 6 (ADVANCE)
   - **Failures or unmet criteria:** → Proceed to Phase 5 (ITERATE)

---

## Phase 5: ITERATE

**Context scope:** Medium — fresh context. Read failure analysis + relevant source files.

### Procedure

1. **Clear context:** `/clear`

2. **Analyze failures.** Read test output, lint output, and a11y audit results. Identify root causes.

3. **Check iteration count.** Read the roadmap to see how many times this stage has been iterated.
   - If **5 iterations** for this stage: **HALT** — escalate to human (see Error Handling below).
   - If total iterations across all stages reach **20**: **HALT** — escalate to human.

4. **Queue fix tasks:**
   ```
   q {Detailed description of what needs to be fixed, referencing specific test failures
   or a11y violations. All segments should target the stage branch: <!-- target-branch: <prefix>/<slug>/<stage-title-slug> -->}
   ```
   Include the stage sub-issue number in the fix task description for traceability
   (e.g., "Fixes for Stage 2 (#42): ...").

5. **Update the roadmap:** Increment the iteration count for this stage. Set status to `iterating`.

6. **Send `work-queued` event via relay** (if relay is running) — same as BREAKDOWN step 8.

7. **Immediately proceed to Phase 3 (EXECUTE).** Do not wait for user input — enter QTM right away to drain the fix tasks. Phase 3 will write/update the orchestrator state file before entering QTM.

---

## Phase 6: ADVANCE

### Procedure

1. **Update the roadmap:** Set the completed stage's status to `complete`.

1.5. **Create a PR from the stage branch to the epic branch.**
   ```bash
   STAGE_PR_URL=$(gh pr create \
     --base epic/<slug> \
     --head <prefix>/<slug>/<stage-title-slug> \
     --title "{Conventional Commits style title for this stage}" \
     --body "$(cat <<'EOF'
   ## Stage {N}: {stage title}

   **Epic:** #{EPIC_ISSUE_NUMBER}
   **Stage issue:** #{STAGE_SUB_ISSUE_NUMBER}

   ### Summary
   - {bullet points describing the stage changes}

   ### Acceptance Criteria
   - [x] {criterion 1}
   - [x] {criterion 2}

   Part {N} of {total_stages} — Epic: {title}

   Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )")
   ```
   Update the roadmap's `**Stage PR:**` field for this stage with the PR number.

   **Merge the stage PR** into the epic branch:
   ```bash
   gh pr merge "$STAGE_PR_URL" --merge --delete-branch
   ```
   Then update the local epic branch:
   ```bash
   git checkout epic/<slug>
   git pull origin epic/<slug>
   ```

1.6. **Check off the stage in the epic draft PR body and link the stage PR.** Read the epic PR body, find the checkbox for this stage, and replace the full line with a checked entry that includes the stage PR number (GitHub auto-links `#N`, giving reviewers one-click access to the stage diff):
   ```bash
   STAGE_PR_NUMBER=$(echo "$STAGE_PR_URL" | grep -o '[0-9]*$')
   EPIC_PR_NUMBER=$(gh pr list --base main --head epic/<slug> --json number -q '.[0].number')
   BODY=$(gh pr view $EPIC_PR_NUMBER --repo OWNER/REPO --json body -q '.body')
   UPDATED=$(echo "$BODY" | sed "s|- \[ \] Stage $STAGE_NUMBER: .*|- [x] Stage $STAGE_NUMBER: $STAGE_TITLE (#$STAGE_PR_NUMBER)|")
   gh pr edit $EPIC_PR_NUMBER --repo OWNER/REPO --body "$UPDATED"
   ```

1.7. **Close the stage sub-issue and update its board status.**
   ```bash
   gh issue close <STAGE_SUB_ISSUE_NUMBER> --repo OWNER/REPO \
     --comment "Stage completed. All acceptance criteria met. PR: $STAGE_PR_URL"
   ```
   Then move it to "Done" on the project board (if configured):
   ```bash
   gh project item-edit \
     --project-id "$PROJECT_NODE_ID" \
     --id "$STAGE_ITEM_NODE_ID" \
     --field-id "$STATUS_FIELD_ID" \
     --single-select-option-id "$DONE_OPTION_ID"
   ```
   Read the stage's board item ID from the roadmap metadata. Skip if project board is not configured.

1.8. **Check off the stage in the epic issue body.** Read the epic issue body, find the checkbox for this stage (e.g., `- [ ] Stage 2: {title}`), and mark it complete:
   ```bash
   BODY=$(gh issue view $EPIC_ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
   UPDATED=$(echo "$BODY" | sed "s/- \[ \] Stage $STAGE_NUMBER: /- [x] Stage $STAGE_NUMBER: /")
   gh issue edit $EPIC_ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED"
   ```
   This gives a visual progress indicator on the epic issue — anyone viewing it can see which stages are done at a glance.

2. **Check for more stages:**
   - **More stages remain:** Return to Phase 2 (BREAKDOWN) for the next stage.
   - **All stages complete:** Proceed to Phase 7 (PR).

---

## Phase 7: PR

**Context scope:** Diff-scoped — the draft PR already exists from Phase 1. All stage work has been merged via individual stage PRs.

### Procedure

1. **Rebase the epic branch on latest main:**
   ```bash
   git checkout epic/<slug>
   git pull origin epic/<slug>
   git fetch origin main
   git rebase origin/main
   ```
   Resolve any conflicts. Push the rebased branch:
   ```bash
   git push --force-with-lease origin epic/<slug>
   ```

2. **Remove the feature flag.** Commit the flag removal on the epic branch so it's included in the final PR:
   - Remove the epic's flag entry from the `flagRegistry` object in `{flags_dir}/flags.ts`
   - Remove all code guards that check this flag — the "enabled" code path becomes the only code path
   - Commit:
     ```bash
     git add .
     git commit -m "chore(<slug>): remove {flag_name} feature flag — shipping to production"
     git push origin epic/<slug>
     ```

   **With `--keep-flag`:** If the user explicitly requests to keep the flag, or if the roadmap contains `keep-flag: true`, change the flag entry to `default: true` and remove overrides instead of removing it entirely.

3. **Run final verification** on the rebased epic branch:
   ```bash
   npm test
   npm run lint
   ```
   If anything fails, fix it on the epic branch and push.

4. **Mark the draft PR as ready for review:**
   ```bash
   EPIC_PR_NUMBER=$(gh pr list --base main --head epic/<slug> --json number -q '.[0].number')
   gh pr ready $EPIC_PR_NUMBER
   ```

5. **Update the roadmap:** Set status to `in-review`.

7. **Open the PR in the default browser** and inform the user:
   ```bash
   PR_URL=$(gh pr view $EPIC_PR_NUMBER --json url -q '.url')
   open "$PR_URL"   # macOS; use xdg-open on Linux
   ```
   Print the PR URL to the terminal. Note that each stage was already reviewed via its own PR — the final review is primarily to verify the rebase and flag removal.

---

## Phase 8: COMPLETION

After the human merges the epic PR:

0. **Send `epic-done` event via relay** (if relay is running). This signals all worker agents to exit gracefully:
   ```bash
   node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'event',event:'epic-done'})+'\n');
   setTimeout(() => s.destroy(), 500);
   " "$(pwd)/.ai-relay/relay.sock"
   ```
   Then call `/relay stop`. This is a **smart stop** — it checks connected clients before shutting down. If Q workers haven't disconnected yet (they're still processing the `epic-done` event), the stop is refused and relay stays alive. Each Q worker also calls `/relay stop` on its way out, so the last agent to exit will be the one that actually stops relay. This "last one out turns off the lights" pattern avoids the race between Epic sending `epic-done` and workers disconnecting.

1. **Close any remaining open stage sub-issues and move them to "Done" on the board.**
   If any stage sub-issues are still open, close them and update their board status:
   ```bash
   # For each open stage sub-issue
   gh issue close <SUB_ISSUE_NUMBER> --repo OWNER/REPO \
     --comment "Epic completed and merged to main."

   # Move to "Done" on board (if configured)
   gh project item-edit \
     --project-id "$PROJECT_NODE_ID" \
     --id "$STAGE_ITEM_NODE_ID" \
     --field-id "$STATUS_FIELD_ID" \
     --single-select-option-id "$DONE_OPTION_ID"
   ```
   Read each stage's board item ID from the roadmap metadata. Skip board updates if project board is not configured.

2. **Move the epic issue to "Done"** on the project board (if configured):
   ```bash
   gh project item-edit \
     --project-id "$PROJECT_NODE_ID" \
     --id "$ITEM_NODE_ID" \
     --field-id "$STATUS_FIELD_ID" \
     --single-select-option-id "$DONE_OPTION_ID"
   ```
   Read the IDs from the roadmap metadata. Skip if project board is not configured.

3. **Close the GitHub Issue** (should auto-close from `Closes #N` in the epic PR body).

4. **Archive roadmap and delete branch** — handled automatically by the `epic-cleanup.yml` GitHub Actions workflow (if installed). The workflow updates the roadmap status to `done`, moves it to `.ai-epics/archive/`, and deletes the remote epic branch. If the workflow is **not** installed, perform these steps manually:
   - Update the roadmap status to `done`
   - Move the roadmap file to `.ai-epics/archive/`
   - Delete the epic branch:
     ```bash
     git branch -d epic/<slug>
     git push origin --delete epic/<slug>
     ```

   **Note:** Stage branches are already deleted by `gh pr merge --delete-branch` in Phase 6. The feature flag was already removed in Phase 7.

5. **Clean up the orchestrator state file.** If `.ai-queue/.orchestrator-state.json` exists and belongs to this agent (PID matches), delete it:
   ```bash
   rm -f .ai-queue/.orchestrator-state.json
   ```
   If a saga is driving this epic, do NOT delete the state file — the saga skill will update it for the next epic. Only delete if this is a standalone epic (no `saga` field in the state file).

---

## `epic status`

Print a summary of the current epic:

```
Epic: {title}
Branch: epic/{slug}
Flag:   {flag_name} (dev: ✓ | staging: ✓ | prod: ✗)
Issue: #{number}
Status: {status}

Stages:
  1. {title} — {status} (N iterations) — #{sub_issue_number}
  2. {title} — {status} — #{sub_issue_number}
  ...

Roadmap: .ai-epics/roadmaps/YYYY-MM-DD-{slug}.md
```

Read the roadmap file to generate this output.

---

## `epic abort`

Abort the current epic without destroying work:

1. **Do NOT delete** the epic branch, roadmap, or any completed work
2. **Update the roadmap:** Set status to `aborted`
3. **Close the GitHub Issue** with a comment: "Epic aborted. Branch `epic/{slug}` preserved."
4. **Close all stage sub-issues** with a comment: "Epic aborted."
5. **Inform the user** that the epic is aborted and where to find the preserved work

**Note:** The feature flag and any code guards remain in the codebase. If flagged code was already merged to main, queue a `chore/` task to remove the flag entry from `config/flags.ts` and strip the code guards (keeping only the legacy/disabled code path, since the feature is being abandoned).

**PM Integration:** In contributor mode, do NOT close issues — only add a comment noting the abort. In `none` mode, skip PM operations entirely.

---

## `epic configure`

(Re)configure PM integration, ownership mode, and notifications. This can be run at any time to change settings.

### Procedure

1. **Read current configuration** from `.ai-epics/docs/project-setup.md` (if it exists). Show current values.

2. **Walk through the configuration questions** (see `references/pm-integration.md` → Configuration Flow):
   - Which PM tool? (GitHub Issues / Linear / Jira / None)
   - Do you own epics? (owner / contributor)
   - Tool-specific questions (project board, team key, etc.)
   - Notification topic? (ntfy, optional)

3. **Write the updated configuration** to `.ai-epics/docs/project-setup.md`.

4. **Commit the change:**
   ```bash
   git add .ai-epics/docs/project-setup.md
   git commit -m "chore: update PM integration configuration"
   ```

---

## `epic update`

Update an existing epic interactively — add/remove stages, change criteria, adjust metadata.

### Procedure

1. **Find active epics.** Scan `.ai-epics/roadmaps/` for files with status that is NOT `done` or `aborted`.

2. **Select the epic:**
   - If **only one** active epic: select it automatically. Print: "Active epic: {title}."
   - If **multiple** active epics: present a numbered list and ask the user to choose.
   - If **none**: print "No active epics found." and exit.

3. **Read the selected epic's roadmap.** Show current state: stages, statuses, criteria.

4. **Ask what to update.** Present options:
   ```
   What would you like to update?
   a) Add a stage
   b) Remove or skip a stage
   c) Update a stage's objective or acceptance criteria
   d) Reorder stages
   e) Update epic metadata (title, linked issues)
   f) Link to an existing PM ticket
   g) Something else
   ```

5. **Walk through the changes conversationally:**

   **(a) Add a stage:**
   - Ask for the stage title, objective, and acceptance criteria.
   - Ask where to insert it (after which stage).
   - Add the stage to the roadmap with status `pending`.
   - If the epic is in-progress, note that existing stage numbering may shift.

   **(b) Remove or skip a stage:**
   - Show the list of non-complete stages.
   - Ask which one to remove/skip.
   - Set its status to `skipped` (don't delete — preserve audit trail).
   - Update the roadmap.

   **(c) Update stage objective or criteria:**
   - Ask which stage to update.
   - Show current objective and criteria.
   - Ask for the changes.
   - Update the roadmap and the corresponding GitHub sub-issue (if PM is configured).

   **(d) Reorder stages:**
   - Show current order.
   - Ask for the new order.
   - Validate that completed stages stay in place (can't reorder finished work).
   - Update the roadmap.

   **(e) Update epic metadata:**
   - Show current metadata (title, branch, flag, issue).
   - Ask what to change. Title and linked issues can be updated. Branch and flag cannot (they're structural).

   **(f) Link to PM ticket:**
   - Ask for the issue ID/URL.
   - Store it in the roadmap.
   - Useful in contributor mode when the epic was created before PM tickets existed.

   **(g) Something else:**
   - Free-form. Parse the user's request and make the appropriate changes.

6. **Commit the updated roadmap:**
   ```bash
   git add .ai-epics/roadmaps/YYYY-MM-DD-{slug}.md
   git commit -m "docs({slug}): update epic roadmap"
   git push
   ```

7. **Confirm** the changes and show the updated state.

---

## `/epic` (bare) — Resume Epic Execution

When invoked without arguments, `/epic` resumes execution of the active epic as the **orchestrator**. This is the entry point for the lifecycle loop after `/epic {goal}` has created the epic.

### Procedure

1. **Check for orchestrator state file first.** Before scanning roadmaps, check if `QUEUE_DIR/.orchestrator-state.json` exists and its `pid` matches `$PPID`. If so, this agent is recovering from a `/clear` during an active orchestration session — read the state file to determine the epic roadmap and `returnTo` phase, then skip to step 5 using the state file data. This is the **post-clear recovery path**.

2. **Find the active roadmap.** Scan `.ai-epics/roadmaps/` for a file with `Status: in-progress`. If none found, print "No active epic found. Use `/epic {goal}` to start one." and exit. If multiple are found, use the most recently modified one and warn.

3. **Read the roadmap.** Extract the epic metadata: branch, flag, issue number, stage list with statuses.

4. **Ensure relay is running.** Invoke `/relay` (start or reclaim).

5. **Claim the orchestrator role.** Connect to relay and identify as `orchestrator`:
   ```bash
   RESULT=$(node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'identify',role:'orchestrator',pid:+process.argv[2]})+'\n');
   s.on('data', d => {
     for (const line of d.toString().split('\n').filter(Boolean)) {
       try { const msg = JSON.parse(line); console.log(JSON.stringify(msg)); } catch {}
     }
     s.destroy();
   });
   setTimeout(() => s.destroy(), 2000);
   " "$(pwd)/.ai-relay/relay.sock" "$PPID")
   ```
   - If `role-taken` → print "Another orchestrator is running (pid {X}). Falling back to worker mode." → invoke `/q` instead and exit this procedure.
   - If `state` response with `orchestrator: true` → role accepted, continue.

6. **Determine the current phase** from the roadmap (or from the state file's `returnTo` if using post-clear recovery). Find the first stage that is NOT `complete`:

   | Stage status | Action |
   |-------------|--------|
   | `pending` | Enter Phase 2 (BREAKDOWN) for this stage |
   | `awaiting-review` | Enter Phase 2 (BREAKDOWN) — review walkthrough may be needed |
   | `executing` | Enter Phase 3 (EXECUTE) — resume QTM |
   | `verifying` | Enter Phase 4 (VERIFY) |
   | `iterating` | Enter Phase 5 (ITERATE) |
   | All stages `complete` | Enter Phase 7 (PR) |

   **State file override:** If the state file's `returnTo` is `"verify"` but the roadmap shows `executing`, trust the state file — QTM has already drained and the orchestrator should proceed to VERIFY.

7. **Enter the lifecycle loop.** Execute the determined phase and continue the normal phase flow (EXECUTE → VERIFY → ITERATE/ADVANCE → next stage → PR → COMPLETION). Each phase transition follows the standard epic flow.

### Context freshness

`/epic` (bare) starts with a clean context. The orchestrator state file preserves the return path across context boundaries, so `/clear` between phases does not break the lifecycle. After clearing, the agent re-reads the state file to recover its position in the lifecycle.

---

## Error Handling

### Stage Fails Verification 5 Times

**Action:** HALT. Do not iterate further.

Print:
```
HALT: Stage {N} "{title}" has failed verification 5 times.

Recent failures:
- {failure summary 1}
- {failure summary 2}
- ...

The epic branch epic/{slug} is preserved with all work so far.
Human intervention is needed to resolve the remaining issues.
```

Update the roadmap with the failure summary.

### Total Iterations Exceed 20

**Action:** HALT. Same behavior as above but triggered by the global iteration count.

### Tests Cannot Be Run

If the test suite fails to execute (not test failures, but infrastructure issues):
1. Attempt to fix the test infrastructure
2. If unfixable, inform the user and skip VERIFY phase for this iteration
3. Document the issue in the roadmap

### GitHub API Failures

If `gh` CLI calls fail (auth issues, rate limits):
1. Log the error
2. Continue the epic workflow without GitHub tracking
3. Document the issue so it can be resolved later

---

## Context Isolation Rules

| Phase | Fresh Context? | Reads |
|-------|---------------|-------|
| PLAN | No (first phase) | Broad codebase |
| BREAKDOWN | Yes (`/clear`) | Roadmap stage section + relevant source |
| EXECUTE | No (orchestrator preserves context; Q workers clear per-task) | Instruction file + scoped files |
| VERIFY | Optional (`/clear` if context is large; recover via state file) | Test output + acceptance criteria |
| ITERATE | Optional (`/clear` if context is large; recover via state file) | Failure analysis + relevant source |
| PR | No (follows ADVANCE) | Git diff |
| COMPLETION | No (follows PR) | Roadmap file |

**Note:** The orchestrator state file (`.ai-queue/.orchestrator-state.json`) preserves the return path across `/clear` boundaries. If the orchestrator needs to `/clear` for context management, it MUST re-read the state file immediately after to recover its position in the lifecycle.

---

## Iteration Limits

| Limit | Value | Action on Exceed |
|-------|-------|-----------------|
| Per-stage iterations | 5 | HALT + escalate to human |
| Total epic iterations | 20 | HALT + escalate to human |

---

## Roadmap File Format

```markdown
# Epic: {title}

- **Branch:** epic/{slug}
- **Feature flag:** {flag_name}
- **GitHub Issue:** #{number}
- **Epic PR:** #{pr_number}
- **Created:** YYYY-MM-DD
- **Status:** planning | in-progress | in-review | done | aborted

## Stage 1: {title}
**Objective:** ...
**Estimated scope:** ~N files, ~N lines
**GitHub Sub-Issue:** #{sub_issue_number}
**Stage Branch:** {prefix}/{slug}/{stage-title-slug}
**Stage PR:** #{stage_pr_number}
**Acceptance criteria:**
- [ ] ...
**Status:** pending | awaiting-review | executing | verifying | iterating | complete
**Iterations:** 0

## Stage 2: {title}
...
```

**Location:** `.ai-epics/roadmaps/YYYY-MM-DD-<slug>.md` (tracked in git)
**Archive:** Move to `.ai-epics/archive/` on completion or abort.
