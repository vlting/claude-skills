# Claude Skills

Agentic workflow skills for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Turn high-level goals into shipped software through a hierarchy of AI-orchestrated planning, execution, and verification.

```
/saga "Build a consulting dashboard"
  |
  |-- DISCOVER -> DEFINE -> DOCUMENT (PRD) -> DECOMPOSE (epics)
  |
  +-- /epic "Auth system"
  |     +-- PLAN -> BREAKDOWN -> EXECUTE -> VERIFY -> ITERATE -> PR
  |     |     +-- /q (segment into tasks, execute in worktrees)
  |     |     +-- /relay (inter-agent communication)
  |     +-- Stage PRs -> epic branch -> main
  |
  +-- /epic "Dashboard views"
  |     +-- ...
  |
  +-- /epic "GitHub integration"
        +-- ...
```

## Skills

| Skill | Purpose | Lines |
|-------|---------|-------|
| **[saga](skills/saga/SKILL.md)** | Define, scope, and orchestrate large initiatives. Interactive requirements gathering, PRD creation, multi-epic execution. | ~700 |
| **[epic](skills/epic/SKILL.md)** | Execute multi-stage development through a plan-execute-verify-iterate loop. Each stage produces a focused PR. | ~940 |
| **[q](skills/q/SKILL.md)** | Task queuing engine. File-disjoint segmentation, worktree-based parallel execution, context isolation. | ~600 |
| **[relay](skills/relay/SKILL.md)** | Inter-agent communication server. Unix domain sockets, role enforcement, event broadcasting. | ~315 |

**Total:** ~3,700 lines of skill definitions across 4 skills and 10 files.

## What these skills do

**Saga** takes a vague idea ("build a task management app") and turns it into a structured plan:
- Interactive Q&A to clarify requirements (~10 focused questions)
- Writes a PRD (Product Requirements Document)
- Decomposes into ordered, dependency-aware epics
- Orchestrates epic execution sequentially, with review gates between epics
- Push notifications (via [ntfy](https://ntfy.sh)) when human attention is needed

**Epic** takes a well-scoped feature goal and ships it:
- Creates an `epic/<slug>` branch with a draft PR to `main`
- Breaks work into stages, each with its own branch and PR to the epic branch
- Runs quality gates: tests, linting, accessibility audits
- Iterates on failures automatically (up to 5 times per stage)
- Feature flags gate all new behavior for safe incremental delivery

**Q** is the task execution engine:
- Segments work into file-disjoint instruction files
- Executes each segment in an isolated git worktree
- Supports parallel execution across multiple agent instances
- Manages task lifecycle: pending -> active -> completed

**Relay** enables multi-agent coordination:
- Unix domain socket server for inter-agent events
- Role enforcement (one orchestrator, many workers)
- Workers sleep efficiently between tasks (no polling)
- Smart shutdown (last agent out turns off the lights)

## Install

Copy the skills into your Claude Code skills directory:

```bash
# Clone
git clone https://github.com/vlting/claude-skills.git
cd claude-skills

# Copy to Claude Code skills directory
cp -R skills/* ~/.claude/skills/
```

Or selectively install individual skills:

```bash
cp -R skills/saga ~/.claude/skills/
cp -R skills/epic ~/.claude/skills/
cp -R skills/q ~/.claude/skills/
cp -R skills/relay ~/.claude/skills/
```

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [GitHub CLI](https://cli.github.com/) (`gh`) for issue/PR management
- Node.js (for relay server)
- [ntfy](https://ntfy.sh) app on your phone (optional, for push notifications)

### First-time setup

After installing, run `epic init` in your project to set up the directory structure and GitHub labels:

```
/epic init
```

## Architecture

```
saga (definition + scoping)          epic (execution + delivery)         q (task engine)
+----------------------------+       +------------------------+         +--------------+
| DISCOVER: clarify reqs     |       |                        |         |              |
| DEFINE: summarize + confirm|       |                        |         |              |
| DOCUMENT: write PRD        |       |                        |         |              |
| DECOMPOSE: plan epics      |       |                        |         |              |
| EXECUTE ----------------------->   | PLAN: branch, flag, PR |         |              |
|   (becomes epic orch.)     |       | BREAKDOWN: segment ---------+-> | drain tasks  |
|                            |       | EXECUTE: run Q --------+---+--> | in worktrees |
| REVIEW <-----------------------    | VERIFY: test + audit   |         |              |
| ADVANCE: next epic  ----------->   | ITERATE: fix failures  |         |              |
| COMPLETE                   |       | PR: rebase, ship       |         |              |
+----------------------------+       +------------------------+         +--------------+
```

### Document hierarchy

| Level | Document | Location |
|-------|----------|----------|
| Saga | PRD (requirements) | `.ai-sagas/docs/<slug>/prd.md` |
| Saga | Saga Roadmap (epic list) | `.ai-sagas/roadmaps/<slug>.md` |
| Epic | Tech Spec (implementation) | `.ai-epics/docs/<slug>/tech-spec.md` |
| Epic | Epic Roadmap (stages) | `.ai-epics/roadmaps/YYYY-MM-DD-<slug>.md` |
| Task | Instruction files | `.ai-queue/*.md` |

### Branch strategy

```
main
 +-- saga/<slug>                              (docs only -- PRD, saga roadmap)
 +-- epic/<epic-slug>                         (draft PR -> main)
 |    +-- feat/<epic-slug>/stage-title        (stage PR -> epic branch)
 |    |    +-- feat/<epic-slug>/stage-title/001  (segment worktree)
 |    |    +-- feat/<epic-slug>/stage-title/002  (segment worktree)
 |    +-- fix/<epic-slug>/stage-title         (stage PR -> epic branch)
 +-- epic/<another-epic-slug>                 (next epic)
```

### Terminal model

```
Terminal 1: /saga or /epic    (orchestrator)
Terminal 2: /q                (worker -- stays alive across stages and epics)
Terminal 3: /q                (worker)
```

## License

MIT
