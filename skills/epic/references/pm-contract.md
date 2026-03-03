# PM Adapter Contract

> Defines the actions every project management adapter must implement. Adapters live in `pm/{tool}.md`.

---

## Actions

Every PM adapter implements the following actions. Each action specifies behavior for **owner** and **contributor** modes.

### `INIT_LABELS`

**When:** `epic init` step 5
**Inputs:** `OWNER`, `REPO` (or equivalent project identifiers)
**Owner:** Create labels/tags required by the epic workflow (epic, stage, iteration, task).
**Contributor:** Skip.
**Idempotency:** Must be safe to re-run (use `--force` or equivalent).

### `INIT_BOARD`

**When:** `epic init` step 6
**Inputs:** `OWNER`, `REPO`, user's project selection
**Owner:** Set up or configure the project board. Ensure required columns exist (Planning, Todo, In Progress, In Review, Done). Return board identifiers for storage.
**Contributor:** Skip.
**Idempotency:** Must detect existing board/columns and skip creation if present.

### `CREATE_EPIC_ISSUE`

**When:** Epic PLAN phase, Saga DECOMPOSE phase
**Inputs:** title, body, labels
**Owner:** Create an epic-level ticket. Return issue ID/URL.
**Contributor:** Ask the user for the existing issue ID/URL. Return what they provide.
**Idempotency:** Not idempotent — only call once per epic.

### `CREATE_STAGE_ISSUE`

**When:** Epic BREAKDOWN phase (per stage)
**Inputs:** title, body, labels, parent epic issue ID
**Owner:** Create a stage sub-issue linked to the epic issue. Return issue ID/URL.
**Contributor:** Skip. Return null.
**Idempotency:** Not idempotent — only call once per stage.

### `CLOSE_ISSUE`

**When:** Epic COMPLETION, Saga COMPLETE
**Inputs:** issue ID/URL, close comment
**Owner:** Close/complete the ticket with a comment.
**Contributor:** Skip.
**Idempotency:** Safe to call on already-closed issues.

### `UPDATE_ISSUE`

**When:** Various — updating descriptions, adding links
**Inputs:** issue ID/URL, updated body or fields
**Owner:** Update the issue.
**Contributor:** Update the issue (if permitted).
**Idempotency:** Yes — last write wins.

### `LINK_PR`

**When:** Epic PR phase
**Inputs:** PR body, issue ID/URL, ownership mode
**Owner:** Include closing keyword (e.g., `Closes #N`) in PR body.
**Contributor:** Include reference keyword (e.g., `Related: #N`) in PR body — no auto-close.
**Idempotency:** N/A — incorporated into PR body text.

### `MOVE_BOARD_STATUS`

**When:** Stage transitions (Planning → Todo → In Progress → In Review → Done)
**Inputs:** item node ID, target status, board identifiers
**Owner:** Move the item on the board.
**Contributor:** Move (if permitted by board settings).
**Idempotency:** Yes — setting status to current status is a no-op.

### `POST_INIT` (optional)

**When:** End of `epic init`
**Inputs:** `OWNER`, `REPO`, project config
**Owner:** Any tool-specific post-init steps (e.g., installing CI workflows).
**Contributor:** Skip or limited version.
**Idempotency:** Must be safe to re-run.

---

## Config Schema

Each adapter stores its fields in the `## Project Management` section of `.ai-epics/docs/project-setup.md`. Common fields:

```markdown
## Project Management

- **Tool:** {tool-name}
- **Ownership:** owner | contributor
```

Adapter-specific fields follow. See each adapter's documentation for its fields.

---

## Best Practices

- **All PM operations are best-effort.** If a PM API call fails (auth, network, permissions), log the error and continue. The workflow must never block on a PM update.
- **Store PM references in roadmap files.** Issue IDs/URLs are stored in the roadmap so later phases can reference them without re-querying.
- **Contributor mode users** should be prompted for issue IDs during PLAN (epic) or DECOMPOSE (saga), not during later phases. Collect all references upfront.
- **API keys** should be stored in environment variables or tool-specific config files, never in project-setup.md or roadmap files.

---

## Adding a New Adapter

1. Create `pm/{tool}.md` implementing all actions above.
2. Document tool-specific config fields.
3. Add the tool name to the PM selection prompt in `init.md` (step 4).
4. Test both owner and contributor modes.

---

## Ownership Modes

| Mode | Create issues | Close issues | Update descriptions | Link PRs | Move board status |
|------|:---:|:---:|:---:|:---:|:---:|
| **owner** | Yes | Yes | Yes | Yes | Yes |
| **contributor** | No | No | Yes | Yes | Yes (if permitted) |

**Owner mode** (default): Full PM integration. The saga/epic creates issues, closes them on completion, manages the full lifecycle.

**Contributor mode**: The user works within an existing PM structure managed by someone else (e.g., a PM or team lead). The saga/epic:
- **Asks the user** for existing issue IDs/URLs instead of creating new ones
- **Updates** issue descriptions and linked PRs
- **Does NOT** create or close issues
- **Does NOT** use closing keywords in PR bodies (uses `Related:` instead)

---

## Conditional Logic Pattern

Throughout saga and epic SKILL.md files, PM operations use this pattern:

```
**PM Integration:** {operation description}.
- **owner:** {full operation}
- **contributor:** {limited operation or skip}
- **none:** Skip.
See `references/pm-contract.md` → `pm/{tool}.md` for tool-specific commands.
```

This keeps the main skill files concise while the adapter docs handle tool-specific details.
