---
name: info
description: "Quick-reference help for any skill. Shows summary, flags, and sub-actions."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Info

Quick-reference card for any installed skill. Usage: `/info {skill-name}`

---

## Behavior

1. **Parse argument.** Extract `{skill-name}` from args. If missing → list all available skills (scan `~/.claude/skills/*/SKILL.md`).

2. **Read the skill file.** Load `~/.claude/skills/{skill-name}/SKILL.md`.

3. **Extract frontmatter.** Parse YAML between `---` fences for `name`, `description`, `version`.

4. **Scan for sub-actions.** Look for usage/command blocks — lines matching patterns like:
   - `/skill-name {sub-action}` — e.g., `/scope status`
   - `--flag` patterns
   - Fenced code blocks showing CLI usage

5. **Output a compact card:**

```
{name} v{version}
─────────────────────────────
{description}

Sub-actions:
  /skill arg1       — description
  /skill arg2       — description

Flags:
  --flag1            — description
  (none)
```

---

## Rules

- **Read-only.** Never modify skill files.
- **Compact output.** Max ~15 lines. No prose — table/list format only.
- **No args → list mode.** Show all installed skills with one-line descriptions.
- **Unknown skill → error.** `"Skill '{name}' not found. Run /info to list available skills."`
