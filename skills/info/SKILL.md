---
name: info
description: "Quick-reference help for any skill. Shows summary, flags, and sub-actions."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.0.0
---

# Info

Quick-reference for installed skills. Two modes: catalog (bare) or detail (with arg).

```
/info              — skill catalog + workflow map
/info {skill}      — detail card for one skill
```

---

## Mode 1: Catalog (`/info` with no args)

**Steps — execute all of these, do not just print this file:**

1. Use Glob to find all `~/.claude/skills/*/SKILL.md` files.
2. For each file, use Read to load it. Extract from frontmatter: `name`, `description`, `version`.
3. Output a **Skill Catalog** table:

```
## Skill Catalog

| Skill | Version | Description |
|-------|---------|-------------|
| /skill | v1.0.0 | one-line description |
...
```

4. After the table, output a **Workflows** section. Group skills by how they compose into workflows. Use the relationships below as a guide, but verify by reading actual skill files — they may have changed.

**Known workflow chains:**

- **Plan → Execute:** `/think` (explores → `/council` → plan → approval) → `/q` (enqueue + drain workers in worktrees)
- **Full Orchestration:** `/scope` (saga → epic → task breakdown, GitHub tracking) → `/think` or `/council` for planning → `/q` for execution
- **Quick Fix:** `/do` (single task in worktree → review → merge)
- **Quality Loop:** `/refine` (research → council spec → issues → `/do` implement → review)
- **Support:** `/info` (help), `/memory` (recall/save/forget), `/ops` (delivery tracking), `/git` (commit+push), `/affirmation` (session prime), `/ui-brain` (design reference), `/worktree-manager` (worktree ops)

Format as a concise list with one line per workflow showing the chain:

```
## Workflows

- **Plan → Execute:** /think → /q
- **Full Orchestration:** /scope → /think → /q
- ...
```

---

## Mode 2: Detail (`/info {skill-name}`)

**Steps — execute all of these, do not just print this file:**

1. Read `~/.claude/skills/{skill-name}/SKILL.md`. If not found → output: `Skill '{skill-name}' not found. Run /info to list available skills.`
2. Extract from frontmatter: `name`, `description`, `version`.
3. Scan the file for sub-actions and flags:
   - Lines matching `/{skill-name}:{sub-action}` patterns (colon syntax)
   - `--flag` patterns
   - Fenced code blocks showing CLI usage
4. Check for `## Memory Integration` section → extract one-line summary if present.
5. Output a compact card:

```
{name} v{version}
─────────────────────────────
{description}

Sub-actions:
  /skill:action      — description
  (none if empty)

Flags:
  --flag1            — description
  (none if empty)

Memory: {summary or "(none)"}
```

---

## Rules

- **Read-only.** Never modify skill files.
- **Compact output.** No prose beyond the formatted sections.
- **Actually execute the steps.** Do NOT just print this SKILL.md file. Read the skill files, extract data, and format output.
