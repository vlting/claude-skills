# Linear Adapter

> Implements the PM adapter contract (`pm-contract.md`) for Linear.

---

## Config Fields

```markdown
## Project Management

- **Tool:** linear
- **Ownership:** owner | contributor
- **Linear Team:** {team-key}                  ← e.g., ENG
- **Linear MCP:** true | false                 ← whether Linear MCP server is available
```

---

## Actions

### `INIT_LABELS`

**Owner:** Create labels in Linear for epic workflow tracking.
```
Use Linear API or MCP to create labels: "epic", "stage", "iteration", "task"
Labels in Linear are team-scoped.
```

**Contributor:** Skip.

### `INIT_BOARD`

Linear uses workflow states (statuses) instead of project boards. No additional setup needed — states are configured at the team level.

**Owner:** Verify team exists and expected states are available (Backlog, Todo, In Progress, In Review, Done).
**Contributor:** Skip.

### `CREATE_EPIC_ISSUE`

**Owner:**
```bash
# If Linear MCP is available:
# Use mcp__linear__create_issue with team key and title

# Otherwise, use Linear API:
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation{issueCreate(input:{teamId:\"TEAM_ID\",title:\"Epic: {title}\",description:\"...\"}){success issue{id identifier url}}}"}'
```

**Contributor:**
```
Ask the user: "What's the Linear issue identifier for this epic? (e.g., ENG-123, or 'skip')"
Store the provided identifier. Skip issue creation.
```

### `CREATE_STAGE_ISSUE`

**Owner:** Create sub-issue with parent reference via API or MCP.
**Contributor:** Skip.

### `CLOSE_ISSUE`

**Owner:** Set status to "Done" via API or MCP.
**Contributor:** Skip.

### `UPDATE_ISSUE`

**Both modes:** Update description via API or MCP.

### `LINK_PR`

**Owner:** Include `Fixes ENG-123` in PR body (Linear auto-detects).
**Contributor:** Include `Related: ENG-123` in PR body.

### `MOVE_BOARD_STATUS`

**Both modes:** Update issue status via API or MCP. Linear maps statuses to workflow states.

### `POST_INIT`

No additional post-init steps for Linear.
