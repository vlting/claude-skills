---
name: audit
description: "Run the repo's reviewer agent fan-out on a branch, worktree, or PR. Parses each reviewer's Output Contract JSON and aggregates into a single verdict."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Audit

Runs the repo's contract reviewer agents in parallel and aggregates their verdicts.

```
/audit                   — audit current branch vs its merge-base with origin/main
/audit <branch>          — audit <branch> vs its merge-base with origin/main
/audit <worktree-path>   — audit uncommitted state in worktree (HEAD~1..HEAD)
/audit <PR#>             — fetch PR head, audit it (requires gh CLI)
```

Non-destructive, read-only. No commits, no merges. This is the standalone version of the review gate that `/q`, `/do`, and `/run` call internally.

## What it runs

Contract reviewers (emit fenced JSON block — parsed):
- `stl-enforcer` — token usage, styled()/stl prop discipline
- `a11y-reviewer` — ARIA, keyboard nav, focus management
- `design-critic` — spacing rhythm, visual hierarchy, composition
- `bundle-checker` — build delta, new exports, dep churn

Reviewers must live at `.claude/agents/<name>.md` in the target repo. If an agent is missing, audit skips it with a warning rather than failing.

## Execution

### Step 1: RESOLVE TARGET

Parse the argument:

| Shape | Resolution |
|---|---|
| (empty) | Current branch at cwd; diff vs `git merge-base HEAD origin/main` |
| bare integer (e.g. `123`) | `gh pr checkout <n>` in a temp worktree, diff vs PR base |
| path exists & is a worktree | Use that worktree; diff = `HEAD~1..HEAD` (most recent commit) |
| starts with `/` or `./` and path exists | Treat as worktree path, same as above |
| otherwise | Treat as branch name; diff vs `git merge-base <branch> origin/main` |

Compute changed files:
```bash
git -C {target} diff --name-only {base}..{head}
```

If no changed files → report "No changes to audit" and exit.

### Step 2: SELECT REVIEWERS

Include all 4 contract reviewers by default. Skip one only when clearly irrelevant given changed files:

| Skip | When |
|---|---|
| `stl-enforcer` | No `packages/stl*` edits AND no `.tsx`/`.ts` imports of `styled()` or `stl` prop |
| `a11y-reviewer` | No `.tsx` files changed AND no ARIA/role-related changes |
| `design-critic` | No `.tsx` files changed (pure logic/config/build scripts) |
| `bundle-checker` | No `package.json` diff AND no new exports in `src/index.ts` equivalents |

When in doubt, include. Prefer noise to missed findings.

### Step 3: SPAWN IN PARALLEL

Send all selected reviewers in a single message with multiple Agent tool calls:

```
Agent(
  subagent_type: "{reviewer}",
  name: "{reviewer}-audit",
  prompt: "Review changes in {target path}. Changed files: {list}. Diff range: {base}..{head}. End your response with the Output Contract JSON block."
)
```

### Step 4: PARSE

For each reviewer response, extract the fenced ```json block at the end:

```json
{
  "severity": "ok|warning|error",
  "blocking": true,
  "summary": "...",
  "findings": [
    { "file": "...", "line": 0, "rule": "...", "severity": "error|warning", "message": "..." }
  ]
}
```

- Missing reviewer agent file → record as skipped
- Malformed or missing JSON → record as `severity: "warning"`, synthetic finding
- Empty `findings` with `severity: "ok"` → pass

### Step 5: AGGREGATE

Compute top-line verdict:

| Condition | Verdict |
|---|---|
| Any reviewer returned `blocking: true` | ❌ **BLOCKING** |
| Any warnings, none blocking | ⚠️  **WARNINGS** |
| All `ok`, no findings | ✅ **CLEAN** |

### Step 6: REPORT

Print a single markdown block:

```markdown
## Audit — {target summary}

**Verdict:** {emoji} {verdict-label}
**Changed files:** {N}
**Reviewers:** {ran}/{selected} (skipped: {skipped-list})

### Findings ({total})

#### {reviewer-name} — {severity}
{summary line}

- `{file}:{line}` — `{rule}` — {message}
- ...

(repeat per reviewer that returned findings)

### Clean
{reviewers that returned ok, comma-separated}
```

If nothing blocking, no action. If any `blocking: true`, the user should fix those before merging — this skill does not auto-retry; that's the caller skills' job (`/q`, `/do`, `/run`).

### Step 7: CLEANUP (PR mode only)

If the target was a PR fetched into a temp worktree:
```bash
git worktree remove {temp-path} --force 2>/dev/null
git branch -D {temp-branch} 2>/dev/null
```

## Rules

1. **Read-only.** Never edit files, never commit, never merge.
2. **No auto-fix.** Report findings; the user (or `/q`/`/do`) decides whether to remediate.
3. **Never spawn non-contract reviewers.** `ui-tester` and `test-writer` are separate tools — call them explicitly when needed, not from `/audit`.
4. **Skip silently on missing agent files.** Record in the skipped list; do not error.
5. **Parallel only.** All reviewers spawn in a single message. Serial review defeats the point.
