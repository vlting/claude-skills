#!/bin/bash
set -euo pipefail

# Block git merge of worktree branches (do/*, q-*) unless previewed.
# The preview step must create a .PREVIEWED marker in the worktree.

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

[[ -z "$command" ]] && exit 0

# Only check git merge commands targeting worktree branches
if ! echo "$command" | grep -qE 'git merge.*(do/do-[0-9]+|q-[0-9]+)'; then
  exit 0
fi

# Extract the branch name
branch=""
if echo "$command" | grep -oqE 'do/do-[0-9]+'; then
  branch=$(echo "$command" | grep -oE 'do/do-[0-9]+')
  worktree_dir=".worktrees/${branch#do/}"
elif echo "$command" | grep -oqE 'q-[0-9]+'; then
  branch=$(echo "$command" | grep -oE 'q-[0-9]+')
  worktree_dir=".worktrees/$branch"
fi

[[ -z "$branch" ]] && exit 0

# Check for .PREVIEWED marker
if [[ -d "$worktree_dir" ]] && [[ ! -f "$worktree_dir/.PREVIEWED" ]]; then
  echo "WORKTREE_PREVIEW_GATE: Merge of $branch blocked — worktree not previewed." >&2
  echo "Start a dev server in $worktree_dir, verify changes, then:" >&2
  echo "  touch $worktree_dir/.PREVIEWED" >&2
  echo "before merging." >&2
  exit 2
fi
