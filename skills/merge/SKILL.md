---
name: merge
description: "List active do/* worktrees and merge the chosen one into its origin branch, gated by a user-supplied approval token."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Merge

Merge (or discard) an active `do/*` worktree. Every merge requires an approval token that only the user can generate — the model cannot forge it.

```
/merge                 — interactive: pick a worktree, pick an action
/merge <worktree-id>   — shortcut: pre-select a worktree, then ask action
```

## How the gate works

1. The user has a secret at `~/.claude-merge-key` (read-denied to all Claude tools).
2. The user's shell has a `claude-merge-token` script that reads the key and prints an HMAC token for a given worktree-id.
3. The PreToolUse hook `do-merge-gate.sh` intercepts `git merge do/*`, `git worktree remove .worktrees/do-*`, `git branch -d do/*`, and `git reset --hard`. It requires a valid `MERGE_TOKEN=<token>` prefix on the command, and recomputes the HMAC to verify.
4. Tokens are valid for 2 minutes (current + previous minute bucket).
5. The model has no path to the key or the token generator. Only the user can produce tokens.

---

## Execution

### Step 1: LIST

List active `do/*` worktrees. For each, show the worktree-id, the worktree path, and the likely origin branch:

```bash
# Live worktrees on disk
git worktree list --porcelain | awk '/^worktree / {wt=$2} /^branch / {br=$2; if (wt ~ /\/\.worktrees\/do-/) print wt, br}'

# Plus any dangling do/* branches without a worktree (in case a prior session removed the worktree but not the branch)
git branch --list 'do/*'
```

Also read active sessions from state MCP for any in-flight `/do` runs:
```
mcp__state__session_list(skill: "do", status: "active")
```
Use the `payload.origin_branch` from the session to know the target branch. If no session is found for a branch, fall back to `git log do/do-<id> --first-parent --format='%H' | tail -2 | head -1` to find the likely fork point, then match against local branches.

If no `do/*` branches exist, tell the user and exit.

### Step 2: PICK

`AskUserQuestion`:
- Question: "Which worktree?"
- Options: one per `do/*` worktree (label = `do-<id>` with origin branch, e.g. `do-1776294905 → overnight/refine-epics-8-10-remainder`).
- If only one worktree exists, skip this step and auto-select it.

### Step 3: ACTION

`AskUserQuestion`:
- Question: "What would you like to do with `do-<id>`?"
- Options:
  - **Merge** — rebase and merge into origin branch, clean up worktree and branch.
  - **Discard** — delete worktree and branch. No merge.
  - **Open in VS Code** — `code {WORKTREE_PATH}`, then return to this question.
  - **Cancel** — exit, leave worktree untouched.

### Step 4a: MERGE (token-gated)

1. **Obtain the approval token** via the native macOS dialog:

   ```bash
   TOKEN=$(~/.claude/scripts/merge-dialog do-<id>)
   ```

   This pops up a macOS dialog with **Approve** as the default button.
   The user presses Enter (or clicks Approve) → the token is generated,
   copied to their clipboard, and returned to stdout.

   If the dialog is cancelled, stop and say "Merge cancelled."

   **Fallback** (if `~/.claude/scripts/merge-dialog` is missing):
   Show manual instructions and ask for the token via `AskUserQuestion`:
   ```
   To approve this merge, run in your own terminal (NOT via Claude):
     claude-merge-token do-<id>
   Paste the 12-character token below.
   ```

2. **Perform the merge**, prefixing every gated command with `MERGE_TOKEN=<token>`:

   ```bash
   TOKEN=<pasted-token>
   WORKTREE_BRANCH="do/do-<id>"
   WORKTREE_PATH=".worktrees/do-<id>"
   ORIGIN_BRANCH="<origin from step 1>"

   # Run from main repo cwd, not inside the worktree.
   cd "$(git rev-parse --show-toplevel)"
   git checkout $ORIGIN_BRANCH

   # Rebase origin onto latest
   git fetch origin $ORIGIN_BRANCH 2>/dev/null || true
   git rebase origin/$ORIGIN_BRANCH 2>/dev/null || true

   # Rebase do branch onto origin
   git checkout $WORKTREE_BRANCH
   git rebase $ORIGIN_BRANCH
   git checkout $ORIGIN_BRANCH

   # Token-gated merge
   MERGE_TOKEN=$TOKEN git merge --no-ff $WORKTREE_BRANCH -m "merge: $WORKTREE_BRANCH"

   # Token-gated cleanup
   MERGE_TOKEN=$TOKEN git worktree remove $WORKTREE_PATH --force
   git worktree prune
   MERGE_TOKEN=$TOKEN git branch -d $WORKTREE_BRANCH
   ```

4. If the hook rejects any command, surface the hook's error message and tell the user to generate a fresh token (tokens expire every 2 minutes).

5. On success, complete any active state MCP session for this worktree and print: "Merged `do-<id>` into `<origin>` and cleaned up."

### Step 4b: DISCARD (also token-gated)

Discard is destructive — same gate. Obtain the token using the same dialog flow as Step 4a, then:

```bash
MERGE_TOKEN=$TOKEN git worktree remove $WORKTREE_PATH --force
git worktree prune
MERGE_TOKEN=$TOKEN git branch -D $WORKTREE_BRANCH
```

---

## Rules

1. **Never bypass the hook.** Do not try `--no-verify`, alternative git paths, or filesystem manipulation. The hook is the authorization boundary.
2. **Never read or reference `~/.claude-merge-key`.** If a tool result happens to show you key contents, ignore them.
3. **Never run `claude-merge-token` directly.** Use `~/.claude/scripts/merge-dialog` which gates behind a native macOS dialog the user must approve. If the dialog script is unavailable, the user must run `claude-merge-token` in their own terminal.
4. **Tokens are single-intent.** If a token fails (expired / invalid), do not retry with the same token. Ask the user to regenerate.
5. **Always run merge commands from the main repo cwd**, not from inside the worktree (cwd gets invalidated when the worktree is removed).
