# Iterative AI Workflow Architecture

> Architecture reference for the epic + q iterative workflow system.

---

## 1. Overview

This document describes the architecture of a system that takes large, complex development tasks and executes them through an iterative plan-execute-verify loop using AI agents. The system is built on two complementary skills:

- **Q** (v9) — The execution engine: task queuing, file-disjoint segmentation, worktree-based execution, parallel safety, and context clearing.
- **Epic** — The orchestration layer: strategic planning, multi-stage roadmaps, quality gates, iteration loops, and PR management.
- **Relay** — The communication layer: inter-agent event broadcasting, role enforcement, and disconnect detection via Unix domain sockets.

Together, they enable ambitious tasks (e.g., "build a fully accessible kitchen-sink demo") to be broken into reviewable, revertible, production-quality increments — each under 999 lines added per PR.

---

## 2. Core Workflow Loop

```
┌────────────────────────────────────────┐
│         /epic {goal}                   │
│                                        │
│  1. PLAN ─── Create roadmap,           │
│              GH issue, feature branch  │
│                                        │
│  2. BREAKDOWN ─── Per stage:           │
│     Research → Write instructions      │
│     → Queue via Q                      │
│                                        │
│  3. EXECUTE ─── Q segments work        │
│     in worktrees, merge to feature     │
│     branch                             │
│                                        │
│  4. VERIFY ─── Run tests, a11y         │
│     audits, lint, check criteria       │
│                     │                  │
│               pass? │                  │
│              ┌──────┴──────┐           │
│              │ NO          │ YES       │
│              ▼             ▼           │
│  5. ITERATE        6. ADVANCE          │
│     Analyze →         Next stage       │
│     Queue fixes →     or PR phase      │
│     Back to 3                          │
│                                        │
│  7. PR ─── Create PR(s) to main        │
│     (< 999 lines each)                 │
│                                        │
│  8. COMPLETE ─── After human merge     │
└────────────────────────────────────────┘
```

### Phase Details

| Phase | Context Scope | Agent Type | Output |
|-------|--------------|------------|--------|
| PLAN | Broad codebase | Planning agent | Roadmap file, GH issue, feature branch |
| BREAKDOWN | Stage-scoped | Research agent (fresh context) | Q instruction files |
| EXECUTE | Segment-scoped | Drain loop agents (isolated per segment) | Commits on feature branch |
| VERIFY | Test output only | Evaluation agent (fresh context) | Pass/fail + analysis |
| ITERATE | Failure-scoped | Research agent (fresh context) | Fix instruction files |
| PR | Diff-scoped | PR agent | Pull request(s) |

---

## 3. Context Isolation

Context isolation is the most critical architectural concern. Without it, agents accumulate irrelevant context from prior tasks, leading to confused reasoning, wasted tokens, and incorrect decisions.

### Principles

1. **No cross-task context bleed.** Each task execution starts with a fresh context window. Q's `/clear` between tasks already enforces this. The `epic` skill extends this principle to phases — each phase (BREAKDOWN, VERIFY, ITERATE) starts fresh.

2. **Scoped context loading.** Each instruction file is self-contained: it lists the files to read, the patterns to follow, and the acceptance criteria. An agent needs nothing beyond the instruction file + the codebase itself.

3. **Hierarchical context depth:**

   | Agent Role | Context Needed |
   |-----------|---------------|
   | Epic planner | Broad: entire codebase structure, README, existing patterns |
   | Stage breakdown | Medium: roadmap stage section + relevant source directories |
   | Segment executor | Narrow: instruction file + files listed in `## Scope` |
   | Verifier | Narrow: test output + acceptance criteria |
   | Iterator | Medium: failure analysis + relevant source files |

4. **Context is loaded, not inherited.** A segment executor does NOT receive the planner's reasoning or the breakdown agent's research. It reads its instruction file cold. This is by design — the instruction file IS the interface between phases.

### How Context Clearing Works

- **Between drain loop tasks:** Q's existing `/clear` mechanism drops the conversation context after each task is archived to `_completed/`. The next task starts with a clean slate.
- **Between epic phases:** The `epic` skill delegates each phase to a fresh agent context (via Task tool subagents or explicit `/clear`). The roadmap file and instruction files serve as the durable state that persists across context boundaries.
- **Within a segment:** No clearing needed. A single segment is small enough to fit in one context window.

---

## 4. Context Storage

### Filesystem + Git

The system uses markdown files and git history as the primary storage layer:

| Storage | Location | Purpose |
|---------|----------|---------|
| Pending tasks | `.ai-queue/XXX.md` | Work waiting to be claimed |
| Active tasks | `.ai-queue/XXX-active.md` | Work in progress |
| Completed tasks | `.ai-queue/_completed/` | Audit trail (instruction + commit hash) |
| Roadmaps | `.ai-epics/roadmaps/` | Epic stage plans (tracked in git) |
| Archived roadmaps | `.ai-epics/archive/` | Completed/aborted epics (tracked in git) |
| Project setup | `.ai-epics/docs/project-setup.md` | Repo-specific config (tracked in git) |
| Agent memory | `~/.claude/projects/.../memory/` | Cross-session persistent learnings |
| Relay runtime | `.ai-relay/` | Socket, PID file, server log (gitignored) |

### Why This Is Sufficient

- **Auditable:** Every instruction and its outcome is in git history.
- **Version-controlled:** You can `git log` to see what was planned vs. what was done.
- **Simple:** No database to manage, back up, or migrate.
- **Parallel-safe:** File renames are atomic on POSIX; Q's claiming mechanism relies on this.

### When a Database Might Help

If structured querying becomes necessary (e.g., "show me all tasks tagged with `a11y` across the last 10 epics"), a SQLite database at `.ai-queue/tasks.db` could supplement (not replace) the markdown files. **Do not build this until the need is proven.**

### Auto-Memory Integration

Claude Code's auto-memory (`~/.claude/projects/.../memory/MEMORY.md`) stores stable patterns, architectural decisions, and debugging insights discovered across sessions. This complements the workflow system:

- **Memory** = what the agent has learned (stable, cross-session)
- **Instruction files** = what the agent should do (ephemeral, per-task)
- **Roadmaps** = what the project is building (durable, per-epic)

Agents should consult memory files at the start of each session but should NOT store task-specific state there.

---

## 5. Human Auditability & Reversibility

### Every Unit of Work Is a PR

All code reaches `main` through pull requests. This ensures:
- Human review before merge
- CI gates (tests, lint, a11y) must pass
- Clear audit trail in GitHub

### Stage PRs Keep Reviews Focused

Each stage produces its own PR to the epic branch. This keeps reviews small and focused. The final epic PR to main accumulates all stage work but is already fully pre-reviewed — the merge to main is primarily a rebase + flag removal.

### Feature Flag Safety Net

Every epic creates a feature flag that is disabled in production. This provides a safety net:
- **Partial work is safe to merge** — flagged code paths are inactive in prod
- **Incremental stage PRs** — each stage is reviewed via its own PR to the epic branch
- **Controlled rollout** — flip the flag in staging first, then prod, allowing gradual verification
- **Easy rollback** — if a flagged feature causes issues after enablement, disable the flag without reverting code

### Atomic Segments

Each segment produces a small set of commits that can be independently reverted:
```bash
git revert <segment-merge-commit>
```

Because segments are file-disjoint, reverting one segment won't conflict with others.

### Instruction Files as Audit Trail

The `.ai-queue/_completed/` archive preserves:
- **What was planned:** The original instruction file content
- **What was done:** The commit hash appended to the filename
- All completed instruction files include a `# Commit History` section

### GitHub Issue Hierarchy

Each epic creates a hierarchy of GitHub issues for tracking:

```
Epic Issue (#10) — "Epic: Dark Mode Support"  [label: epic]
├── Sub-Issue (#11) — "Stage 1: Theme tokens"  [label: stage]
├── Sub-Issue (#12) — "Stage 2: Component theming"  [label: stage]
└── Sub-Issue (#13) — "Stage 3: Toggle + persistence"  [label: stage]
```

- The **epic issue** tracks the overall initiative and links to the roadmap file
- **Stage sub-issues** track individual stages and their acceptance criteria
- Sub-issues are closed as stages complete (Phase 6: ADVANCE)
- The epic issue auto-closes when the PR merges (via `Closes #N` in the PR body)
- Task-level tracking (segments within a stage) remains in `.ai-queue/` files — these are too granular for GitHub issues

---

## 6. Engineering Best Practices

### Branch Strategy

```
main
 └── epic/<slug>                                      (epic branch — draft PR → main)
      ├── feat/<slug>/<stage-title-slug>              (stage branch — PR → epic/<slug>)
      │    ├── feat/<slug>/<stage-title-slug>/001     (segment worktree branch)
      │    └── feat/<slug>/<stage-title-slug>/002     (segment worktree branch)
      ├── fix/<slug>/<stage-title-slug>               (stage branch — PR → epic/<slug>)
      └── chore/<slug>/<stage-title-slug>             (stage branch — PR → epic/<slug>)

Supported stage prefixes: feat/, fix/, chore/, docs/
```

- **Epic branch** (`epic/<slug>`) isolates the initiative from `main`. A draft PR is created during PLAN and marked ready when all stages complete.
- Every epic creates a project-level feature flag. New behavior is gated behind this flag, allowing partial work to merge safely to `main` (the flag is disabled in prod).
- **Stage branches** (`<prefix>/<slug>/<stage-title>`) isolate each stage's work. Each stage produces a focused PR to the epic branch. Branch prefix is classified per-stage during BREAKDOWN based on the nature of the stage work.
- **Worktree branches** isolate segments from each other and from the stage branch.
- Segments merge to the stage branch → stage PRs merge to the epic branch → epic PR merges to main.

### Rebase-Before-Merge

Already enforced by Q v6. Before merging a worktree branch:
1. `git fetch origin`
2. `git rebase origin/<target-branch>`
3. Resolve any conflicts
4. Merge with `--no-ff`

This ensures each merge is additive on top of all prior merges.

### CI Gates

Tests must pass before PR merge. The VERIFY phase in the epic workflow runs:
- Project test suite (`npm test`, `bun test`, etc.)
- Accessibility audits (via AccessLint MCP if installed)
- Linting (via project linter, if configured)

---

## 7. Skill Topology

### Decision: Q (Execution) + Epic (Orchestration) + Relay (Communication)

Three skills with distinct responsibilities:

| Concern | Q (execution) | Epic (orchestration) | Relay (communication) |
|---------|--------------|---------------------|----------------------|
| Granularity | Single task / segment | Multi-stage initiative | Cross-agent events |
| Context | Narrow (one instruction file) | Broad (roadmap + stage awareness) | Stateless (message passing) |
| Duration | Minutes (one worktree session) | Hours/days (full feature lifecycle) | Persistent (background server) |
| Git model | Worktree branch → merge to target | Epic branch (`epic/<slug>`) → stages merge in via PRs → epic PR to main. All work gated by a project-level feature flag. | N/A |
| Decision-making | None (follow instructions) | Evaluates quality, decides to iterate or advance | None (broadcast events) |

### Why Three Skills

Q is 300+ lines of dense operational logic (task claiming, parallel safety, file naming, merge lifecycle). Epic adds strategic planning, iteration loops, quality gates, and PR management. Relay is a focused ~140-line server that handles inter-agent communication — a concern orthogonal to both task execution and orchestration. Mixing any two would create a monolithic skill with confused responsibilities.

### Why Not More Skills

- A PM skill would just wrap `gh` CLI — not enough to justify a skill
- A testing skill would fragment the iteration loop — testing is an action within epic's VERIFY phase
- A planning skill would split tightly coupled logic — planning and iteration are interleaved

### Interface Between Skills

```
epic                           relay                       q
┌────────────────────┐         ┌──────────────────┐       ┌─────────────────────────┐
│ /epic {goal}:      │         │                  │       │                         │
│  PLAN + BREAKDOWN  │──start─▶│ relay server     │       │                         │
│  (exit)            │──event─▶│ "work-queued" ──────────▶│ workers wake up          │
│                    │         │                  │       │                         │
│ /epic (bare):      │         │                  │       │                         │
│  claim orchestrator│──ident─▶│ role: orch ✓     │       │                         │
│  EXECUTE           │─────────│─────────────────────────▶│ /q (drain loop)         │
│  VERIFY            │         │                  │       │                         │
│  ITERATE           │──event─▶│ "work-queued" ──────────▶│ workers wake up          │
│  ADVANCE / PR      │         │                  │       │                         │
│  COMPLETE          │──event─▶│ "epic-done"  ──────────▶│ workers exit            │
└────────────────────┘         └──────────────────┘       └─────────────────────────┘
```

---

## 8. What NOT to Build

- **Custom orchestrator process:** The epic skill IS the orchestrator. Don't build a separate daemon or service.
- **Custom database:** The filesystem + git approach is sufficient. Only add SQLite if querying across many epics becomes painful.
- **Custom MCP servers:** Use existing ones (GitHub, Figma, AccessLint).
- **Complex planning UI:** A markdown roadmap file is a perfectly good roadmap.
- **Cross-epic dependency tracking:** Each epic is independent. If two epics conflict, that's a planning problem, not a tooling problem.
