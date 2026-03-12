# GitHub Integration

Requires: `gh` CLI authenticated.

## create-ticket

```bash
# Epic/saga-level issue
gh issue create --repo OWNER/REPO \
  --title "{type}: {title}" \
  --label "{type}" \
  --body "Roadmap: \`.ai-plans/{slug}/roadmap.md\`"

# Stage sub-issue
gh issue create --repo OWNER/REPO \
  --title "Stage {N}: {title}" \
  --label "stage" \
  --body "Parent: #{epic_issue}\nBranch: {stage_branch}"
```

Create labels on first use (idempotent):
```bash
for label in epic saga stage; do
  gh label create "$label" --repo OWNER/REPO 2>/dev/null || true
done
```

## create-pr

```bash
gh pr create --draft \
  --title "{title}" \
  --base main --head epic/{slug} \
  --body "Roadmap: \`.ai-plans/{slug}/roadmap.md\`

## Stages
- [ ] Stage 1: {title}
- [ ] Stage 2: {title}
"
```

## update-epic-pr

After merging a stage PR, update the epic PR body to check off the stage and link the merged stage PR.

```bash
# Get current epic PR body
BODY=$(gh pr view {epic_pr_number} --repo OWNER/REPO --json body --jq '.body')

# Replace "- [ ] Stage N: {title}" with "- [x] Stage N: {title} (#stage_pr_number)"
UPDATED=$(echo "$BODY" | sed 's/- \[ \] Stage {N}: {title}/- [x] Stage {N}: {title} (#'"{stage_pr_number}"')/')

# Update the PR body
gh pr edit {epic_pr_number} --repo OWNER/REPO --body "$UPDATED"
```

## update-epic-issue

After merging a stage PR, check off the stage checkbox in the epic issue body.

```bash
# Get current issue body
BODY=$(gh issue view {epic_issue_number} --repo OWNER/REPO --json body --jq '.body')

# Replace "- [ ] Stage N.M: {title}" with "- [x] Stage N.M: {title} (#stage_pr_number)"
UPDATED=$(echo "$BODY" | sed 's/- \[ \] Stage {N\.M}: {title}/- [x] Stage {N\.M}: {title} (#'"{stage_pr_number}"')/')

# Update the issue body
gh issue edit {epic_issue_number} --repo OWNER/REPO --body "$UPDATED"
```

## link-ticket

Use `Closes #{N}` in stage PR body to auto-close sub-issues on merge.

## close-ticket

```bash
gh issue close {number} --repo OWNER/REPO --comment "Completed."
```

## move-status

Requires GitHub Projects v2 with `project_number` in config.

```bash
# Add item to board (idempotent — returns existing item if already added)
ITEM_ID=$(gh project item-add $PROJECT_NUMBER --owner OWNER --url "$ISSUE_URL" --format json | jq -r '.id')

# Move status (resolve field/option IDs once, cache in roadmap metadata)
gh project item-edit --project-id "$PROJECT_NODE_ID" --id "$ITEM_ID" \
  --field-id "$STATUS_FIELD_ID" --single-select-option-id "$OPTION_ID"
```

## move-to-done

Shorthand for moving an issue to Done on the project board. Used in ADVANCE (stage sub-tickets) and SHIP (epic/saga tickets).

```bash
ITEM_ID=$(gh project item-add $PROJECT_NUMBER --owner OWNER --url "$ISSUE_URL" --format json | jq -r '.id')
gh project item-edit --project-id "$PROJECT_NODE_ID" --id "$ITEM_ID" \
  --field-id "$STATUS_FIELD_ID" --single-select-option-id "$DONE_OPTION_ID"
```

**SHIP checklist (multi-epic):**
1. Move the individual epic issue to Done
2. After the final epic: also move the saga issue to Done

### Board status rules

**IMPORTANT — Epic/saga issues and their PRs use only two columns:**
- **Planning** — when created
- **Done** — when shipped

They NEVER go in Todo, In Progress, or In Review. Even while actively being worked on, epics/sagas stay in Planning until fully complete.

**Stage sub-issues** move through all columns: Todo → In Progress → In Review → Done.

## update-saga-issue

After completing an epic (SHIP phase), check off the epic checkbox in the saga issue body.

```bash
# Get current saga issue body
BODY=$(gh issue view {saga_issue_number} --repo OWNER/REPO --json body --jq '.body')

# Replace "- [ ] Epic N: {title}" with "- [x] Epic N: {title} (#{epic_pr_number})"
UPDATED=$(echo "$BODY" | sed 's/- \[ \] Epic {N}: {epic_title_pattern}/- [x] Epic {N}: {epic_title_pattern} (#'"{epic_pr_number}"')/')

# Update the saga issue body
gh issue edit {saga_issue_number} --repo OWNER/REPO --body "$UPDATED"
```

## Configuration

Stored in `.ai-plans/config.yml`:
```yaml
integrations: [github]
github:
  owner: OWNER
  repo: REPO
  mode: owner  # or: contributor
  project_number: 1
  project_node_id: PVT_xxx  # from: gh api graphql -f query='{ organization(login: "OWNER") { projectV2(number: N) { id } } }'
  status_field_id: PVTSSF_xxx  # from: gh project field-list N --owner OWNER
  status_options:
    planning: "abc123"
    todo: "def456"
    in_progress: "ghi789"
    in_review: "jkl012"
    done: "mno345"
```

**Setup (auto-resolved on first run):**
1. Ask user for `owner`, `repo`, `project_number`
2. Resolve `project_node_id` via GraphQL
3. Resolve `status_field_id` and `status_options` via `gh project field-list`
4. Write complete config — never leave fields as placeholders

**Owner vs Contributor:**
- **Owner:** Full CRUD on issues, labels, board.
- **Contributor:** Skip issue creation. Link to existing issues via user-provided IDs. Comment-only.
