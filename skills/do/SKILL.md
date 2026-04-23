---
name: do
description: "Run a task in an isolated worktree, present the diff for approval, then merge back. Lightweight alternative to /q for small, single-unit work."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.1.0
---

# Do

Run a single task in an isolated worktree. Review the diff. Merge or discard.

```
/do                       — read instructions from DO.md at repo root
/do <instructions>        — execute task in worktree, show preview, wait
```

No queue files. No relay. No drain loop. No auto-merge. Just: isolate → execute → preview → wait.

**Merging is out of scope for `/do`.** After execution, `/do` leaves the worktree alive with a running playground preview. Iterate by talking to Claude in the same conversation, or run `/merge` (a separate, token-gated skill) when you're ready to land the work.

### Session persistence (state MCP)

`/do` registers with the `state` MCP for dashboard visibility and worktree recovery.

**Scope key:** task slug derived from the first ~30 chars of instructions (slugified).

**Lifecycle:**
1. **Step 1 (VALIDATE):** `mcp__state__session_start(skill: "do", repo: {cwd}, scope: {task-slug}, payload: {instructions summary, origin_branch})`.
2. **Step 3 (EXECUTE):** `mcp__state__session_checkpoint(session_id, phase: "execute", state_json: {worktree_path, worktree_branch})`.
3. **Step 4 (PREVIEW):** `mcp__state__session_checkpoint(session_id, phase: "preview", state_json: {worktree_path, preview_url})`. Session stays **active** after `/do` returns — it completes when `/merge` or a discard happens.

**Recovery:** If a new conversation finds an active `do` session in `phase: "preview"`, check if the worktree still exists. If so, tell the user the worktree is still live (show path + origin branch) and suggest `/merge` or further iteration. If the worktree is gone, abandon the stale session and start fresh.

---

## When to use `/do` vs `/q`

| | `/do` | `/q` |
|---|---|---|
| **Tasks** | 1 | 1–N parallel |
| **Overhead** | Near zero | Queue files, relay, drain |
| **Use when** | Small, clear scope | Multi-task or needs file-disjoint parallelism |

---

## Execution

### Step 1: VALIDATE

- Record the current branch: `git rev-parse --abbrev-ref HEAD` → `$ORIGIN_BRANCH`
- Determine repo root: `git rev-parse --show-toplevel` → `$REPO_ROOT`

**If no inline instructions provided (bare `/do`):**

The scratch file lives at `$REPO_ROOT/.claude/DO.md` (co-located with other Claude project config). On first use, migrate any legacy `$REPO_ROOT/DO.md` to the new location.

1. **Migration** — if `$REPO_ROOT/DO.md` exists:
   - If `.claude/DO.md` does not exist, move it: `mkdir -p .claude && git mv DO.md .claude/DO.md` (or plain `mv` if not tracked). Remove any `/DO.md` line from `.gitignore`; ensure `/.claude/DO.md` is gitignored.
   - If `.claude/DO.md` exists, just `rm DO.md` and continue.
2. Check for `$REPO_ROOT/.claude/DO.md`.
3. **File does not exist** → `mkdir -p .claude`, create an empty `.claude/DO.md`. Ensure `/.claude/DO.md` is in `.gitignore` (append if missing, don't duplicate). Tell the user:
   > Created `.claude/DO.md`. Awaiting instructions (inline or via DO.md).
   Then **stop** — do not proceed to Step 2.
4. **File exists but is empty** → tell the user:
   > Awaiting instructions (inline or via `.claude/DO.md`).
   Then **stop**.
5. **File exists and has content** → read the full contents into `$INSTRUCTIONS`, then **immediately** overwrite `.claude/DO.md` with an empty file (Write tool, empty string). Proceed with `$INSTRUCTIONS`.

**If inline instructions provided:** use them directly.

### Step 2: CREATE WORKTREE

**IMPORTANT:** Do NOT use `Agent(isolation: "worktree")` — it branches from `origin/main` instead of the current HEAD. Create the worktree manually:

```bash
WORKTREE_ID="do-$(date +%s)"
WORKTREE_PATH=".worktrees/$WORKTREE_ID"
WORKTREE_BRANCH="do/$WORKTREE_ID"

git worktree add -b "$WORKTREE_BRANCH" "$WORKTREE_PATH"
```

This branches from the current HEAD, preserving all local work.

Symlink `node_modules` so the worktree can resolve dependencies:
```bash
ln -sf "$(pwd)/node_modules" "$WORKTREE_PATH/node_modules"
```

### Step 3: EXECUTE

Spawn a single Agent — **no `isolation` parameter** (the worktree already exists):

```
Agent(
  prompt: <see worker prompt below>,
  mode: "bypassPermissions",
  description: "do: <first 5 words of instructions>"
)
```

**Worker prompt:**

```
You are a worker. Execute this task completely:

{instructions}

Your working directory is: {absolute path to worktree}
All file reads, edits, and git commands MUST use this directory.
Do NOT modify files outside this worktree.

Rules:
- Implement the task fully. Do not ask questions.
- Commit your work with a conventional commit message.
- If you encounter a blocker you cannot resolve, commit what you have
  and note the blocker in your commit message.
- Read any relevant CONSTITUTION.md, *.spec.md, or *.ai.md files
  before making changes.
- All styling via STL (styled() or stl prop). No plain style={}.
- Use STL shorthands (bg, p, px, radius, etc).
```

### Step 3b: REVIEW

After the worker returns, run specialist review agents against the worktree. Reviewers with the **Output Contract** (see `.claude/agents/<name>.md`) emit a fenced JSON block the gate parses to decide retry/proceed.

**Selection** — include by default, skip only when clearly irrelevant:

| Agent | Skip when |
|---|---|
| `stl-enforcer` | No `packages/stl*` edits, no `styled()`/`stl=` usage |
| `a11y-reviewer` | No interactive or visible UI, no ARIA-relevant changes |
| `design-critic` | No UI/visual changes |
| `bundle-checker` | No new deps, no new exports, no build-affecting changes |

When in doubt, include.

**Spawn** selected reviewers **in parallel** (all read-only, no conflicts):
```
Agent(
  subagent_type: "{reviewer}",
  name: "{reviewer}-do",
  prompt: "Review changes in {WORKTREE_PATH}. Focus on files: {changed files list}. End with the Output Contract JSON block.",
)
```

**Parse** each response for the fenced ```json block:
```json
{ "severity": "ok|warning|error", "blocking": true, "summary": "...", "findings": [...] }
```

**Verdict:**
- All `severity: "ok"` → proceed silently
- Warnings only (no blocking) → surface in final summary, proceed
- Any `blocking: true` → re-spawn worker with collected findings (max 1 retry), re-review
- Still blocking after retry → proceed to PREVIEW anyway; flag blocking findings prominently in summary
- Malformed/missing JSON → treat as `warning`, surface in summary, no retry

### Step 4: PREVIEW & HAND OFF

When reviews complete:

1. **Start playground preview** in the worktree (web Vite dev server):
   ```bash
   cd {WORKTREE_PATH} && yarn dev:playground > /tmp/$WORKTREE_ID.log 2>&1 &
   PREVIEW_PID=$!

   for i in $(seq 1 40); do
     URL=$(grep -oE 'http://localhost:[0-9]+/?' /tmp/$WORKTREE_ID.log 2>/dev/null | head -1)
     [ -n "$URL" ] && break
     sleep 1
   done
   ```
   If the dev server errors with a missing `packages/stl/dist`, symlink it from the main repo:
   ```bash
   ln -sf {REPO_ROOT}/packages/stl/dist {WORKTREE_PATH}/packages/stl/dist
   ```

2. **Create the `.PREVIEWED` marker** (kept for compatibility with the older `worktree-preview-gate.sh` hook). The authoritative merge gate is now the token-based `do-merge-gate.sh`, but this marker is still required by the legacy hook:
   ```bash
   touch {WORKTREE_PATH}/.PREVIEWED
   ```

3. Show the user a summary:

   ```markdown
   ## `/do` complete — worktree standing by

   **Branch:** `{WORKTREE_BRANCH}`
   **Worktree:** `{WORKTREE_PATH}`
   **Origin:** `{ORIGIN_BRANCH}`
   **Preview:** {URL}

   ### Changes
   {agent's summary of what was done}

   ### Diff
   {run `git -C {WORKTREE_PATH} diff HEAD~1` to show the committed diff}

   ---

   The worktree is still live. Iterate in this conversation, or run `/merge` when ready to land.
   ```

4. **Single `AskUserQuestion`** — the ONLY question at end of `/do`:
   - Question: "Run `/sim-source` on this worktree?"
   - Header: "Sim source"
   - Options:
     - **Yes** — invoke the `sim-source` skill pointed at `{WORKTREE_PATH}` so the iOS Simulator loads from the worktree.
     - **No** — leave Metro untouched.
   - `multiSelect: false`

5. **After the question is answered**, STOP. Do not ask anything else. Do not offer merge. Do not offer discard. Wait for the user's next instruction (further iteration, or `/merge`).

### NEVER in /do

- **Never merge.** Merging only happens via `/merge`, which is token-gated by the `do-merge-gate.sh` hook. Attempting `git merge do/*` inside `/do` will be blocked by the hook — this is intentional.
- **Never run `git worktree remove` on a `do/*` worktree.** Also hook-blocked.
- **Never run `git branch -d do/*`.** Also hook-blocked.
- **Never call `claude-merge-token` or read `~/.claude-merge-key`.** Both are hook-blocked; the user generates tokens in their own terminal.

---

## Edge cases

- **Agent makes no changes:** still hook-blocked from removing the worktree. Tell the user "No changes made" and surface the worktree path; they can discard via `/merge`.
- **Agent returns error:** Show the error. The worktree stays. User decides next step.
- **Dev server won't start:** surface the log tail, leave worktree alive, don't merge.

---

## Rules

1. **Never queue.** `/do` is not `/q`. No queue files, no relay, no drain.
2. **One task, one agent.** No parallelism within `/do`.
3. **Worktree placement:** `.worktrees/do-{id}` subfolder convention.
4. **No merging, no discarding.** Those are `/merge`'s job and require user-supplied tokens.
5. **Never use `Agent(isolation: "worktree")`** — it branches from `origin/main`, not HEAD. Always create the worktree manually with `git worktree add`.
