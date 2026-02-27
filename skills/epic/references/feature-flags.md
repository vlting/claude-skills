# Feature Flags

## Purpose

Feature flags allow the epic skill to ship work incrementally and safely. When an epic starts, a feature flag is created for that epic's work. All new behavior introduced by the epic is gated behind this flag. This means:

- **Partial implementations can merge to `main`** — the flag is off in prod, so users never see unfinished work
- **Smaller, more targeted branches** — instead of one massive feature branch, work can be split across multiple smaller PRs
- **Iteration branches (fix/, chore/) can merge independently** — fixes to flagged code are safe to ship because the code path is disabled in prod
- **Controlled rollout** — when the epic is complete, flip the flag in staging first, then prod

> **Note:** This document covers **project-level** feature flags (flags that gate application behavior in the project repo). The epic skill also has its own **skill-level** flags at `~/.claude/skills/epic/config/flags.json` that control skill behavior (e.g., `branch_prefix_routing`). These are separate systems.

## Flag File — Single TypeScript Module

A single TypeScript file in the project repo serves as the source of truth for all feature flags:

| File | Purpose |
|------|---------|
| `config/flags.ts` | Typed flag registry, runtime helper, derived types |

**Location convention:** `config/` directory at the project root. This path is configured during `epic init` and stored in `project-setup.md` as the `flags_dir` field.

### Template

The `config/flags.ts` file is created during the first epic's PLAN phase (step 4.5). Here is the exact template:

```ts
// config/flags.ts — Feature flag registry (managed by epic skill)
// Do not edit flag entries manually — use /epic to create and manage flags.

type Environment = 'dev' | 'staging' | 'prod';

interface FlagDefinition {
  description: string;
  added: string; // YYYY-MM-DD
  default: boolean;
  overrides?: Partial<Record<Environment, boolean>>;
}

const flagRegistry = {
  // ← new flags are inserted here (newest first)
} as const satisfies Record<string, FlagDefinition>;

// -- Derived types ----------------------------------------------------------

export type FlagName = keyof typeof flagRegistry;

// -- Runtime helper ----------------------------------------------------------

const ENV: Environment =
  (process.env.APP_ENV as Environment) ??
  (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');

export function getFlag(name: FlagName, env: Environment = ENV): boolean {
  const flag = flagRegistry[name];
  return flag.overrides?.[env] ?? flag.default;
}

// -- Full registry export (for tooling / status commands) --------------------

export { flagRegistry };
```

## Flag Schema

Each entry in `flagRegistry` is a key-value pair where the key is the flag name (snake_case, derived from the epic slug) and the value is a `FlagDefinition` object:

```ts
const flagRegistry = {
  kitchen_sink_a11y: {
    description: 'Accessibility overhaul for kitchen-sink example app',
    added: '2026-02-24',
    default: false, // prod default
    overrides: { dev: true, staging: true },
  },
} as const satisfies Record<string, FlagDefinition>;
```

**Properties:**
- `description`: string — brief, human-readable description (1 sentence max). AI-generated during PLAN phase.
- `added`: string — date the flag was created, `YYYY-MM-DD` format.
- `default`: boolean — the **prod** default (typically `false` for new flags).
- `overrides`: optional — only lists environments that **differ** from `default`.

**Conventions:**
- New epic flags always get `default: false, overrides: { dev: true, staging: true }`
- Flag names are `snake_case` versions of the epic slug (e.g., `kitchen-sink-a11y` → `kitchen_sink_a11y`)
- **Sort order:** Newest flags first (highest in the `flagRegistry` object)

**Derived types:**
- `FlagName` — union of all flag name string literals. Provides autocomplete and compile-time validation.
- `getFlag(name)` — runtime helper that resolves the flag value for the current environment. Typos in flag names are compile errors.

## Flag Lifecycle

| Phase | Action | default | overrides |
|-------|--------|---------|-----------|
| PLAN (epic starts) | Add entry to `flagRegistry` | `false` | `{ dev: true, staging: true }` |
| EXECUTE → PR | Merge work behind flag | — | — |
| COMPLETION (default) | Remove entry + code guards | — | — |
| COMPLETION (--keep-flag) | Change to `default: true`, remove `overrides` | `true` | removed |

**Default behavior (flag removal):** When an epic completes, the flag entry is **removed from `flagRegistry`** and all code guards (if/else branches checking the flag) are cleaned up in the same completion commit. This prevents dead code from accumulating. The code path that was behind the flag becomes the only code path.

**Exception (`--keep-flag`):** If the user passes `--keep-flag` during completion (or the roadmap includes a `keep-flag: true` directive), the flag is **not removed**. Instead, the entry is changed to `default: true` and the `overrides` property is removed. This is useful when:
- A client is actively testing the feature in a staged rollout
- The feature needs a kill switch for safety (e.g., new payment flow)
- The rollout is gradual (enable for some users, not all)

When `--keep-flag` is used, flag retirement becomes a future `chore/` task once the flag is no longer needed.

## How to Check a Flag in Code

```ts
import { getFlag } from '../config/flags';

if (getFlag('kitchen_sink_a11y')) {
  // new code path
} else {
  // legacy code path
}
```

Autocomplete works on the flag name. Typos are compile errors thanks to the `FlagName` type.

**The epic skill does NOT generate code guards.** It only manages the flag registry. Developers (or AI agents following task instructions) are responsible for wrapping new code in flag checks where appropriate. The task instruction files generated during BREAKDOWN should mention the flag name and remind the implementing agent to gate new behavior behind it.

## How the Epic Skill Uses Flags

During **PLAN** phase:
1. Derive a flag name from the epic slug: `kebab-case` → `snake_case`
2. If `config/flags.ts` does not exist yet (first epic in the repo), create it from the template above, then add the flag entry
3. Add the flag entry to the `flagRegistry` object in `config/flags.ts` (newest first, with `default: false, overrides: { dev: true, staging: true }`)
4. Record the flag name in the roadmap file

During **BREAKDOWN** phase:
- Include the flag name in task instructions so implementing agents know to gate new behavior behind it

During **COMPLETION** phase (after PR merge):
- **Default:** Remove the flag entry from `config/flags.ts`. Also remove all code guards (if/else branches) that check this flag — the "enabled" code path becomes the only path. Commit and push.
- **With `--keep-flag`:** Instead of removing, change the entry to `default: true` and remove the `overrides` property. Leave the code guards in place. Commit and push.

## Branching Strategy Enabled by Flags

Because work is behind a feature flag, the epic can use a more flexible branching strategy:

| Prefix | When to use | Example |
|--------|------------|---------|
| `feat/` | New feature implementation (default for epics) | `feat/dark-mode` |
| `fix/` | Bug fixes — to flagged code or existing code | `fix/dark-mode-contrast` |
| `chore/` | Maintenance, refactoring, tooling, deps | `chore/dark-mode-cleanup` |
| `docs/` | Documentation-only changes | `docs/dark-mode-api` |

**Routing rules:**
- The **first branch** of an epic is typically `feat/<slug>` — it introduces the flag and initial implementation
- **Subsequent branches** may use any prefix depending on the nature of the work
- All branches can merge to `main` independently (safe because the flag is off in prod)
- The epic's segment worktree branches inherit the current branch prefix: `feat/<slug>/001`, `fix/<slug>-detail/001`, etc.

**This is the default behavior for all epics** — not conditional on any meta-flag. Every epic creates a feature flag.
