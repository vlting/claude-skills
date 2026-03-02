# Saga Architecture

> Architecture reference for the saga → epic → q workflow hierarchy.

---

## 1. Overview

The saga skill adds a definition and scoping layer above the existing epic + q execution system. It takes high-level goals ("build a consulting dashboard") and guides them from idea through shipped software.

Three distinct concerns, three skills:

| Concern | Skill | Responsibility |
|---------|-------|---------------|
| **Definition & scoping** | Saga | Requirements gathering, PRD creation, epic decomposition, inter-epic orchestration |
| **Execution & delivery** | Epic | Multi-stage implementation, quality gates, iteration loops, PR management |
| **Task execution** | Q | File-disjoint segmentation, worktree isolation, parallel task draining |

---

## 2. Workflow Hierarchy

```
/saga "Build X"
 │
 ├─ DISCOVER ─── Interactive Q&A with human
 ├─ DEFINE ───── Summarize, confirm requirements
 ├─ DOCUMENT ─── Write PRD
 ├─ DECOMPOSE ── Break into epics with dependencies
 │
 └─ EXECUTE ──── For each ready epic (sequential):
      │
      ├─ Write tech spec
      ├─ /epic {goal} ─── Epic PLAN phase
      │    │
      │    ├─ BREAKDOWN ─── Per stage:
      │    │    └─ /q ─── Segment, execute in worktrees
      │    ├─ VERIFY ─── Tests, a11y, lint
      │    ├─ ITERATE ─── Fix failures, re-verify
      │    ├─ ADVANCE ─── Stage PR → epic branch
      │    └─ PR ─── Rebase, remove flag, mark ready
      │
      ├─ REVIEW ─── Check PRD alignment
      └─ ADVANCE ── Next epic
```

### Phase Characteristics

| Phase | Interactive? | Agent Mode | Duration |
|-------|-------------|-----------|----------|
| DISCOVER | Yes | Conversational | Minutes |
| DEFINE | Yes | Conversational | Minutes |
| DOCUMENT | Yes (confirmation) | Generative | Minutes |
| DECOMPOSE | Yes (confirmation) | Planning | Minutes |
| EXECUTE | No | Autonomous (epic orchestrator) | Hours/days per epic |
| REVIEW | Conditional | Evaluative (may pause for human) | Minutes |
| COMPLETE | No | Cleanup | Minutes |

---

## 3. Document Hierarchy

```
.ai-sagas/
├── docs/
│   └── {slug}/
│       └── prd.md                    ← Product Requirements Document
├── roadmaps/
│   └── {slug}.md                     ← Saga roadmap (epic list + dependencies)
└── archive/                          ← Completed/aborted saga roadmaps

.ai-epics/
├── docs/
│   └── {epic-slug}/
│       └── tech-spec.md              ← Technical specification per epic
├── roadmaps/
│   └── YYYY-MM-DD-{epic-slug}.md     ← Epic roadmap (stages + criteria)
└── archive/                          ← Completed/aborted epic roadmaps

.ai-queue/
├── *.md                              ← Pending task instruction files
├── *-active.md                       ← In-progress tasks
└── _completed/                       ← Completed task archive
```

### Document Ownership

| Document | Written by | Read by | Updated by |
|----------|-----------|---------|-----------|
| PRD | Saga (DOCUMENT phase) | Epic (for context), Saga (REVIEW) | Saga (if drift detected) |
| Saga Roadmap | Saga (DECOMPOSE) | Saga (EXECUTE, REVIEW) | Saga (status updates) |
| Tech Spec | Saga (per-epic, at start of EXECUTE) | Epic (PLAN, BREAKDOWN) | Epic (if implementation reveals changes) |
| Epic Roadmap | Epic (PLAN) | Epic (all phases), Saga (status checks) | Epic (status updates) |
| Task Instructions | Q (segmentation) | Q (execution) | Q (completion annotations) |

---

## 4. Branch Strategy

```
main
 ├── saga/<slug>                                       (saga branch — docs only, no code)
 │
 ├── epic/<epic-1-slug>                                (epic 1 branch — draft PR → main)
 │    ├── feat/<epic-1-slug>/stage-title               (stage branch — PR → epic branch)
 │    │    ├── feat/<epic-1-slug>/stage-title/001      (segment worktree)
 │    │    └── feat/<epic-1-slug>/stage-title/002      (segment worktree)
 │    └── fix/<epic-1-slug>/stage-title                (stage branch)
 │
 ├── epic/<epic-2-slug>                                (epic 2 branch — draft PR → main)
 │    └── ...
 │
 └── epic/<epic-3-slug>                                (epic 3 branch)
      └── ...
```

**Key distinction:** The saga branch holds only documentation (PRD, saga roadmap). Code lives on epic branches. This avoids merge conflicts between the saga's docs and the epics' code changes.

---

## 5. Orchestration Model

### Terminal Model

```
Terminal 1: /saga          → saga orchestrator
                             ├─ between epics: saga concerns (REVIEW, ADVANCE)
                             └─ during epic: epic orchestrator (BREAKDOWN → EXECUTE → VERIFY → PR)
Terminal 2: /q             → worker (stays alive across epics)
Terminal 3: /q             → worker (stays alive across epics)
```

### Relay Events

| Event | Sent by | When | Effect |
|-------|---------|------|--------|
| `work-queued` | Saga/Epic orchestrator | Segments queued for a stage | Workers wake up, drain tasks |
| `work-queued` | Saga orchestrator | Between epics (keep workers alive) | Workers stay alive, await next epic's tasks |
| `epic-done` | Saga orchestrator | After the LAST epic completes | Workers exit gracefully |

**Critical:** Between epics, send `work-queued`, NOT `epic-done`. Workers interpret `epic-done` as "all work is finished, exit now." The saga overrides this by keeping workers alive across the full saga lifecycle.

### Sequential Execution (v1)

The saga orchestrator runs one epic at a time:

```
Epic 1 (no deps)    ████████████░
                    REVIEW ░
Epic 2 (deps: E1)              ████████████░
                               REVIEW ░
Epic 3 (deps: E1)                          ████████████░
                                           REVIEW ░
Epic 4 (deps: E2,E3)                                   ████████████░
                                                        COMPLETE
```

Epics 2 and 3 are independent but run sequentially in v1. The saga picks one (lower number first).

### Parallel Execution (v2 — future)

```
Epic 1 (no deps)    ████████████░
                    REVIEW ░
Epic 2 (deps: E1)              ████████████░░░░░░
Epic 3 (deps: E1)              ██████████████░
                               REVIEW (both) ░
Epic 4 (deps: E2,E3)                         ████████████░
                                              COMPLETE
```

This requires:
- Multiple epic orchestrators running simultaneously
- Relay supporting multiple epic contexts
- Worktree isolation between parallel epics (separate branches)
- Merge conflict detection when parallel epics touch overlapping files

**Do not build this until v1 is proven.** The complexity is significant and the sequential model works well enough for most sagas.

---

## 6. Notification Architecture

### When to Notify

| Event | Urgency | Notification method |
|-------|---------|-------------------|
| Saga complete | Low | ntfy + desktop |
| Epic complete (saga advancing) | Info | Desktop only |
| REVIEW: minor drift | Info | Log only (no notification) |
| REVIEW: significant drift (paused) | High | ntfy + desktop |
| HALT: epic iteration limit | High | ntfy + desktop |
| HALT: dependency deadlock | High | ntfy + desktop |

### Notification Stack

1. **ntfy** (primary) — push to phone. Requires topic configuration.
2. **osascript** (fallback) — macOS desktop notification. Always available on macOS.
3. **Terminal** (last resort) — print message and block. Always works.

Notifications degrade gracefully: if ntfy isn't configured, fall back to desktop. If desktop fails, fall back to terminal. Never crash on notification failure.

---

## 7. What NOT to Build

- **Parallel epic orchestration (v1):** Sequential is sufficient. See section 5.
- **Saga-level tech specs:** Premature. Each epic writes its own tech spec with full codebase context.
- **Epic-level PRDs:** Redundant. The saga PRD covers requirements; epics reference it.
- **Saga-level feature flags:** Epics are self-contained with their own flags.
- **Custom notification service:** ntfy + osascript is sufficient. No custom servers.
- **Cross-saga dependency tracking:** Each saga is independent.
- **PRD versioning UI:** Git history is the version history. No custom diff viewer.
