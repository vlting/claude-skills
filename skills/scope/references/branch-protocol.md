# Branch & PR Protocol

Single source of truth for branch hierarchy and PR targeting.

## Branch Hierarchy

```
main
 └── epic/{slug}                    ← epic branch (created at SCOPE)
      └── feat/{slug}/{stage-slug}  ← stage branch (created at BREAKDOWN)
           └── .worktrees/q-{NNN}   ← worker worktree (created by /q)
```

## PR Targeting Rules

| PR type | Head | Base | Created by |
|---------|------|------|------------|
| Stage PR | `feat/{slug}/{stage-slug}` | `epic/{slug}` | `/scope` ADVANCE |
| Epic PR | `epic/{slug}` | `main` | `/scope` SCOPE (draft), SHIP (merge) |

**Never** create a stage PR targeting `main`. Stage PRs always target the epic branch.

## Who Creates What

| Actor | Creates branches | Creates PRs | Pushes to |
|-------|-----------------|-------------|-----------|
| `/scope` | epic branch, stage branch | epic PR, stage PR | epic branch, stage branch |
| `/q` worker | worktree only | **never** | stage target-branch only |
| Manual agent | — | — | consult `/scope` |

## Pre-flight Validation (ADVANCE)

Before `gh pr create` in ADVANCE, verify:
```bash
# Stage PR must target epic branch
BASE="epic/${SLUG}"
gh pr create --base "$BASE" --head "${PREFIX}/${SLUG}/${STAGE_SLUG}" ...
```

If `--base` would be `main` → **STOP**. This is a protocol violation.
