# Jira Adapter

> Implements the PM adapter contract (`pm-contract.md`) for Jira Cloud.

---

## Config Fields

```markdown
## Project Management

- **Tool:** jira
- **Ownership:** owner | contributor
- **Jira Project:** {project-key}              ← e.g., PROJ
- **Jira Base URL:** https://{org}.atlassian.net
```

---

## Actions

### `INIT_LABELS`

**Owner:** Create labels in Jira for epic workflow tracking.
```bash
# Jira labels are created on-the-fly when assigned to issues.
# No explicit creation needed — just use them when creating issues.
```

**Contributor:** Skip.

### `INIT_BOARD`

Jira boards are typically pre-configured. No additional setup needed.

**Owner:** Verify project exists and board is accessible.
**Contributor:** Skip.

### `CREATE_EPIC_ISSUE`

**Owner:**
```bash
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"project":{"key":"PROJ"},"summary":"Epic: {title}","issuetype":{"name":"Epic"},"description":{"type":"doc","version":1,"content":[...]}}}'
```

**Contributor:**
```
Ask the user: "What's the Jira issue key for this epic? (e.g., PROJ-123, or 'skip')"
Store the provided key. Skip issue creation.
```

### `CREATE_STAGE_ISSUE`

**Owner:** Create sub-task linked to epic.
```bash
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"project":{"key":"PROJ"},"summary":"Stage {N}: {title}","issuetype":{"name":"Sub-task"},"parent":{"key":"PROJ-123"}}}'
```

**Contributor:** Skip.

### `CLOSE_ISSUE`

**Owner:**
```bash
# Transition to "Done" via API
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue/$ISSUE_KEY/transitions" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"DONE_TRANSITION_ID"}}'
```

**Contributor:** Skip.

### `UPDATE_ISSUE`

**Both modes:**
```bash
curl -s -X PUT "$JIRA_BASE_URL/rest/api/3/issue/$ISSUE_KEY" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"description":{...}}}'
```

### `LINK_PR`

**Owner/Contributor:** Include issue key (e.g., `PROJ-123`) in PR body or branch name. Jira auto-detects with GitHub integration.

### `MOVE_BOARD_STATUS`

**Both modes:** Use transitions API.
```bash
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue/$ISSUE_KEY/transitions" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"TARGET_TRANSITION_ID"}}'
```

### `POST_INIT`

No additional post-init steps for Jira.
