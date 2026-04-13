---
name: memory
description: "User-facing memory management. Recall, save, forget, reinforce, cleanup, and stats for the JIT memory system."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Memory

Direct interface to the JIT memory system. Search, save, manage, and clean up memories.

```
/memory                          — show stats (default)
/memory recall {query}           — search memories, display ranked results
/memory save {name} -- {content} — explicit store (asks for type/scope)
/memory reinforce {query}        — boost salience of matching memory
/memory forget {query}           — soft-delete matching memory
/memory stats                    — counts by type/scope, top-5 accessed, staleness
/memory update {query}           — update matching memory in-place
/memory cleanup                  — show cleanup candidates, approve per-memory
/memory archive {query}          — send matching memories to cold storage
/memory promote {query}          — bring cold memories back to hot
```

---

## Operations Reference

Read `~/.claude/skills/memory/MEMORY_OPS.md` for tool call templates used by all skills.

---

## Subcommands

### `/memory` or `/memory stats`

1. Call `mcp__memory__memory_recall` with no args, limit 1 (just to verify connectivity).
2. Query counts by type:
   ```
   For each type in [user, feedback, project, reference, episodic]:
     mcp__memory__memory_recall(type: type, limit: 1) → use result to show "N+ memories"
   ```
3. Call `mcp__memory__memory_stale` with default args.
4. Display:
   ```
   Memory System
   ─────────────────────────────
   Hot:   {count} memories
   Stale: {stale_count} (>{max_days} days untouched)

   By type:
     feedback:  {n}    reference: {n}
     user:      {n}    project:   {n}
     episodic:  {n}

   Top 5 most accessed:
     1. {name} ({type}, {access_count} accesses)
     ...

   Tip: /memory cleanup — review stale memories
   ```

### `/memory recall {query}`

1. Call `mcp__memory__memory_recall(query: "{query}", limit: 15)`.
2. Display ranked results:
   ```
   {N} results for "{query}"
   ─────────────────────────────
   1. {name}  [{type}]  score: {score}
      {description — first 100 chars}

   2. {name}  [{type}]  score: {score}
      {description — first 100 chars}
   ...
   ```
3. **Never expose raw UUIDs.** Use name + index for reference.

### `/memory save {name} -- {content}`

1. Parse `{name}` (before `--`) and `{content}` (after `--`).
2. `AskUserQuestion`: "Type? (feedback / reference / project / user / episodic)"
3. `AskUserQuestion`: "Scope? (global / project / discipline:{name})"
4. Call `mcp__memory__memory_store` with parsed args + user selections.
5. Confirm: `Saved: "{name}" [{type}, {scope}]`

### `/memory reinforce {query}`

1. Call `mcp__memory__memory_recall(query: "{query}", limit: 5)`.
2. If 1 result → reinforce directly.
3. If multiple → `AskUserQuestion` with numbered list, ask which to reinforce.
4. Call `mcp__memory__memory_reinforce(id: "{resolved_id}")`.
5. Confirm: `Reinforced: "{name}" (salience +0.3)`

### `/memory forget {query}`

1. Call `mcp__memory__memory_recall(query: "{query}", limit: 5)`.
2. If 1 result → confirm before forgetting.
3. If multiple → `AskUserQuestion` with numbered list.
4. `AskUserQuestion`: "Forget '{name}'? This soft-deletes it. (y/n)"
5. Call `mcp__memory__memory_forget(id: "{resolved_id}")`.
6. Confirm: `Forgotten: "{name}"`

### `/memory update {query}`

1. Call `mcp__memory__memory_recall(query: "{query}", limit: 5)`.
2. If 1 result → show current content, ask what to change.
3. If multiple → `AskUserQuestion` with numbered list, ask which to update.
4. `AskUserQuestion`: "What fields to update?" — show current name, description, content. Accept new values.
5. Call `mcp__memory__memory_update(id, ...changed_fields)`.
6. Confirm: `Updated: "{name}"`

### `/memory cleanup`

1. Call `mcp__memory__memory_cleanup(max_stickiness: 0.3, limit: 20)`.
2. If no candidates → "All memories healthy — nothing to clean up."
3. Display candidates:
   ```
   Cleanup Candidates (stickiness < 0.3)
   ─────────────────────────────
   1. {name}  [{type}]  stickiness: {score}
      Suggested: {compress|archive|delete}
      {description — first 80 chars}

   2. ...
   ```
4. `AskUserQuestion`: "Action per memory — enter numbers to act on, or (s)kip all:
   `1a` = archive #1, `2d` = delete #2, `3c` = compress #3"
5. Execute approved actions:
   - **archive:** `mcp__memory__memory_archive(id)`
   - **delete:** `mcp__memory__memory_forget(id)` (confirm: "Permanently forget?")
   - **compress:** `mcp__memory__memory_consolidate(ids: [id], name, description, content: <summarized>)`
6. Summary: `Cleaned: {N} archived, {N} deleted, {N} compressed`

### `/memory archive {query}`

1. Call `mcp__memory__memory_recall(query: "{query}", limit: 5)`.
2. Resolve target (single or ask).
3. Call `mcp__memory__memory_archive(id: "{resolved_id}")`.
4. Confirm: `Archived: "{name}" — excluded from default recall`

### `/memory promote {query}`

1. Need to search cold storage. Call `mcp__memory__memory_recall(query: "{query}", limit: 5)`.
   - Note: if the memory is already archived, it won't appear in default recall. Use broader search terms.
2. Resolve target.
3. Call `mcp__memory__memory_promote(id: "{resolved_id}")`.
4. Confirm: `Promoted: "{name}" — back in hot tier`

---

## Rules

1. **Never expose UUIDs.** Resolve by name/query internally. Users see names + indices.
2. **Confirm destructive actions.** Always ask before forget/delete.
3. **One question at a time.** Use `AskUserQuestion` sequentially, never multiple.
4. **Compact output.** Tables and lists, no prose.
5. **Read-only by default.** Only modify memories when user explicitly requests it.
