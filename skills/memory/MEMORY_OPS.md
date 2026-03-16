# Memory Operations Reference

Named operations for skill integration. Skills reference operations by name — if tool signatures change, update here only.

**MCP server:** `memory` (stdio transport). All tools prefixed `mcp__memory__`.

---

## Recall Operations

Default limits are generous (quality > cost). Each skill gate can override with `limit: N`.

| Operation | Tool | Args | Default Limit | Purpose |
|---|---|---|---|---|
| `recall-constraints` | `mcp__memory__memory_recall` | `query: "{role} constraints boundaries", type: "feedback", project: $CWD` | **10** | Role-boundary violations. Critical — never miss a constraint. |
| `recall-checklist` | `mcp__memory__memory_recall` | `query: "{phase} checklist requirements", type: "feedback", project: $CWD` | **10** | Phase-specific checklists (GitHub tracking, etc.) |
| `recall-prior-art` | `mcp__memory__memory_recall` | `query: "{task keywords}", project: $CWD` | **15** | Prior decisions, past sessions, reference material. Broadest recall. |
| `recall-discipline` | `mcp__memory__memory_recall` | `query: "{topic}", scope: "discipline:{disc}"` | **10** | Discipline-scoped knowledge (frontend, design, etc.) |

---

## Store Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `store-feedback` | `mcp__memory__memory_store` | `name: "{short}", description: "{one-line}", type: "feedback", content: "{correction}", scope: "global"` | Capture user corrections — highest-value memory type |
| `store-outcome` | `mcp__memory__memory_store` | `name: "{what happened}", description: "{summary}", type: "episodic", content: "{details}", scope: "project", project: $CWD` | Capture decisions, blockers, outcomes |
| `store-decision` | `mcp__memory__memory_store` | `name: "{decision}", description: "{one-line}", type: "reference", content: "{rationale}", scope: "project", project: $CWD` | Capture architectural/design decisions |

---

## Lifecycle Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `reinforce-used` | `mcp__memory__memory_reinforce` | `id: "{id}"` | Boost salience of memories that influenced decisions |
| `forget-wrong` | `mcp__memory__memory_forget` | `id: "{id}"` | Soft-delete memories the user says are wrong |

---

## Cleanup Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `find-cleanup` | `mcp__memory__memory_cleanup` | `max_stickiness?: 0.3, limit?: 20` | Return cleanup candidates sorted by stickiness ascending |
| `archive-cold` | `mcp__memory__memory_archive` | `id: "{id}"` | Move to cold storage — excluded from default recall, still searchable |
| `promote-hot` | `mcp__memory__memory_promote` | `id: "{id}"` | Restore from cold to hot tier |

---

## Scope Resolution

| Skill Context | `project` value | `scope` value |
|---|---|---|
| /scope, /q (in a repo) | `process.cwd()` | `"project"` |
| /council persona | `process.cwd()` | persona-specific discipline |
| /ui-brain | `process.cwd()` | `"discipline:frontend"` |
| /memory (direct) | `process.cwd()` | user-specified or `"global"` |

---

## Variable Reference

| Variable | Source |
|---|---|
| `$CWD` | Current working directory (the project path) |
| `{role}` | The skill's role name (e.g., "scope orchestrator", "worker") |
| `{phase}` | Current workflow phase (e.g., "breakdown", "execute") |
| `{task keywords}` | Relevant keywords from the current task/goal |
| `{topic}` | Discipline-specific topic for targeted recall |
| `{disc}` | Discipline name (e.g., "frontend", "css", "design") |
| `{id}` | Memory UUID — resolved internally, never shown to users |
