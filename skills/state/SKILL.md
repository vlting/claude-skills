---
name: state
description: "Session state management. List active sessions, inspect checkpoints, abandon stale sessions, run garbage collection."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# State

User-facing management for the session-state DB. Shows what's in flight across all skills and repos.

```
/state                   — dashboard: all active sessions
/state info {query}      — full detail for one session
/state abandon {query}   — mark a session as abandoned
/state gc                — purge completed/abandoned > 30 days
```

---

## Subcommands

### `/state` (default — dashboard)

1. Call `mcp__state__session_list` with `status: "active"`.
2. Format as a dashboard table:

```
Active Sessions
─────────────────────────────────────────────────────────────
 Skill     Repo            Scope       Phase       Age
 /refine   vlt-ui          default     SPEC        2h
 /q        vlt-ui          orchestr.   draining    5m
 /scope    vlt-ui          epic/nav    EXECUTE     1d
 /do       vlt-ui          fix-margin  worktree    12m

Stale (>7d):
 /refine   vlt-data        default     RESEARCH    9d
```

3. Sessions with `age_days >= 7` go in the "Stale" section with a warning.
4. If no active sessions: "No active sessions."

### `/state info {query}`

1. Call `mcp__state__session_list` with no filters.
2. Match `{query}` against skill name, repo basename, or scope. If ambiguous, ask user to pick.
3. Call `mcp__state__session_info` with the resolved `session_id`.
4. Display:

```
Session: {id}
─────────────────────────────────────
Skill:   {skill}
Repo:    {repo}
Scope:   {scope}
Status:  {status}
Created: {created_at}
Updated: {updated_at}

Checkpoints:
  1. {phase}  {created_at}  git:{git_ref || "—"}
  2. {phase}  {created_at}  git:{git_ref || "—"}

Events:
  started     {created_at}
  checkpointed {created_at}  phase: RESEARCH
  ...

Payload:
{formatted JSON payload, truncated to 500 chars}
```

### `/state abandon {query}`

1. Call `mcp__state__session_list` with `status: "active"`.
2. Match `{query}` against skill name, repo basename, or scope.
3. If multiple matches, ask user to pick.
4. Confirm: "Abandon {skill} session for {repo} ({scope})? (y/n)"
5. Call `mcp__state__session_abandon` with the session_id.
6. Confirm: "Abandoned: {skill} / {repo} / {scope}"

### `/state gc`

1. Call `mcp__state__session_list` with no filters (triggers inline GC).
2. Report: "GC: {purged} sessions purged (completed/abandoned > 30 days)."
3. Show remaining session counts by status.

---

## Rules

1. **Never expose raw session IDs in the dashboard.** Use skill + repo + scope for identification. Show IDs only in `/state info`.
2. **Confirm before abandon.** Always ask.
3. **One question at a time.** Use `AskUserQuestion` sequentially.
4. **Compact output.** Tables and lists, no prose.
5. **Stale = display hint.** Sessions >7 days old get a warning, NOT auto-abandoned.
