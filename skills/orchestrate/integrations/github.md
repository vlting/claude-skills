# GitHub Integration

Requires: `gh` CLI authenticated.

## create-ticket

```bash
# Epic/saga-level issue
gh issue create --repo OWNER/REPO \
  --title "{type}: {title}" \
  --label "{type}" \
  --body "Roadmap: \`.ai-orchestrate/roadmaps/{slug}.md\`"

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
  --body "Roadmap: \`.ai-orchestrate/roadmaps/{slug}.md\`

## Stages
- [ ] Stage 1: {title}
- [ ] Stage 2: {title}
"
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
# Add item to board
ITEM_ID=$(gh project item-add $PROJECT_NUMBER --owner OWNER --url "$ISSUE_URL" --format json | jq -r '.id')

# Move status (resolve field/option IDs once, cache in roadmap metadata)
gh project item-edit --project-id "$PROJECT_NODE_ID" --id "$ITEM_ID" \
  --field-id "$STATUS_FIELD_ID" --single-select-option-id "$OPTION_ID"
```

Board usage: epic/saga issues use **Planning → Done** only. Stage sub-issues move through all columns (Todo → In Progress → In Review → Done).

## Owner vs Contributor mode

- **Owner:** Full CRUD on issues, labels, board.
- **Contributor:** Skip issue creation. Link to existing issues via user-provided IDs. Comment-only.

Configured during `orchestrate init`. Stored in `.ai-orchestrate/config.yml`:
```yaml
integrations: [github]
github:
  owner: OWNER
  repo: REPO
  mode: owner  # or: contributor
  project_number: 2  # optional
```
