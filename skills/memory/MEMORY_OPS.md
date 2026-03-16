# Memory Operations Reference

Named operations for skill integration. Skills reference operations by name — if tool signatures change, update here only.

**MCP server:** `memory` (stdio transport). All tools prefixed `mcp__memory__`.

---

## Dual-System Architecture

Two memory systems, complementary by design:

| | File Memory (L1) | MCP DB (L2) |
|---|---|---|
| **Loading** | Always — auto-injected every conversation | On-demand — recalled when relevant |
| **Ownership** | User-curated, version-controlled | Agent-managed, salience-scored |
| **Content** | Behavioral constraints, governance rules | Learned knowledge, decisions, episodic context |
| **Decay** | Never — persists until manually removed | By design — half-life scoring, gc, archival |
| **Location** | `~/.claude/projects/*/memory/*.md` | `~/.claude/memory/memory.db` |

**Boundary rule:** If a correction must be enforced *every* session regardless of task → file memory. If it surfaces *when relevant* via query → DB.

---

## Scoring Formula

```
score = BM25 * 0.6 + decayedSalience * 0.3 + recency * 0.1
```

- **BM25:** FTS5 full-text relevance (normalized 0-1)
- **decayedSalience:** `salience * 0.5^(days / halfLife)`, floor by type. Half-life: 7d (default), 3d (episodic)
- **recency:** `1 / (1 + days)` since last access or creation

Salience changes only via:
- `store()` — initial 1.0
- `reinforce()` — explicit +0.3, capped per type (feedback: 2.0, reference/user: 1.5, project: 1.2, episodic: 0.8)
- Natural decay (half-life)

`recall()` is a pure read for salience — tracks `access_count` and `last_accessed_at` for observability only.

---

## Recall Operations

| Operation | Tool | Args | Limit | Purpose |
|---|---|---|---|---|
| `recall-constraints` | `memory_recall` | `query: "{role} constraints boundaries", type: "feedback", project: $CWD` | **5** | Role-boundary violations |
| `recall-checklist` | `memory_recall` | `query: "{phase} checklist requirements", type: "feedback", project: $CWD` | **5** | Phase-specific checklists |
| `recall-prior-art` | `memory_recall` | `query: "{task keywords}", project: $CWD` | **8** | Prior decisions, reference material |
| `recall-discipline` | `memory_recall` | `query: "{topic}", scope: "discipline:{disc}"` | **5** | Discipline-scoped knowledge |
| `recall-lateral` | `memory_recall` | `query: "{task keywords}"` | **5** | Cross-domain serendipity — no type/scope/project filter |

### Parallel Recall Patterns

MCP natively supports concurrent tool calls. Fire related recalls together:

**Skill entry (e.g., /scope, /q start):**
```
parallel:
  - recall-constraints  (feedback, project-scoped)
  - recall-prior-art    (all types, project-scoped)
```

**Council EXPLORE phase:**
```
parallel:
  - recall-prior-art    (task keywords, project-scoped)
  - recall-lateral      (task keywords, unscoped — cross-domain)
```

**Council DELIBERATE phase (per persona):**
```
parallel:
  - recall-discipline   (persona's domain topic)
  - recall-prior-art    (task keywords)
```

**Post-execution (e.g., /q VERIFY):**
```
parallel:
  - recall-checklist    (phase: "verify", project-scoped)
  - recall-constraints  (role boundaries)
```

---

## Store Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `store-feedback` | `memory_store` | `name, description, type: "feedback", content, scope: "global"` | User corrections — highest-value type |
| `store-outcome` | `memory_store` | `name, description, type: "episodic", content, scope: "project", project: $CWD` | Decisions, blockers, outcomes |
| `store-decision` | `memory_store` | `name, description, type: "reference", content, scope: "project", project: $CWD` | Architectural/design decisions |

---

## Lifecycle Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `reinforce-used` | `memory_reinforce` | `id` | Boost salience (+0.3, type-capped) for memories that influenced decisions |
| `forget-wrong` | `memory_forget` | `id` | Soft-delete memories the user says are wrong |
| `update-memory` | `memory_update` | `id, name?, description?, content?, type?, scope?, project?, disciplines?` | Update in-place — preserves ID, salience, history |

---

## Cleanup Operations

| Operation | Tool | Args | Purpose |
|---|---|---|---|
| `find-cleanup` | `memory_cleanup` | `max_stickiness?: 0.3, limit?: 20` | Cleanup candidates by stickiness ascending |
| `archive-cold` | `memory_archive` | `id` | Cold storage — excluded from recall, reversible |
| `promote-hot` | `memory_promote` | `id` | Restore from cold to hot tier |

---

## Episodic Lifecycle

Episodic memories auto-managed by producer-driven lifecycle:

- **Per-project cap:** 50 active episodics. After `indexSession` inserts, oldest with `access_count < 2` archived first, then oldest by `created_at`.
- **GC on index:** `indexProjectSessions` runs gc after bulk indexing. Episodics with `decayedSalience < 0.01` and `access_count < 2` auto-archived.
- **Health reporting:** Indexing tools return `{ episodic_count, suggested_action }`. When `suggested_action: "consolidate"` — run `memory_consolidate` to distill episodics into semantic summaries.

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
| `{role}` | Skill's role name (e.g., "scope orchestrator", "worker") |
| `{phase}` | Current workflow phase (e.g., "breakdown", "execute") |
| `{task keywords}` | Relevant keywords from current task/goal |
| `{topic}` | Discipline-specific topic for targeted recall |
| `{disc}` | Discipline name (e.g., "frontend", "css", "design") |
| `{id}` | Memory UUID — resolved internally, never shown to users |
