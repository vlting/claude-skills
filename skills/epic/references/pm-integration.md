# Project Management Integration

> Reference for PM tool abstraction. Both saga and epic read from the PM configuration in `.ai-epics/docs/project-setup.md`.

---

## Configuration

The PM configuration lives in the `## Project Management` section of `.ai-epics/docs/project-setup.md`:

```markdown
## Project Management

- **Tool:** github | linear | jira | none
- **Ownership:** owner | contributor
- **GitHub Project Board:** #{number}          ← if tool is github (optional)
- **Linear Team:** {team-key}                  ← if tool is linear (e.g., ENG)
- **Linear MCP:** true | false                 ← whether Linear MCP server is available
- **Jira Project:** {project-key}              ← if tool is jira (e.g., PROJ)
- **Jira Base URL:** https://{org}.atlassian.net  ← if tool is jira
```

### Ownership Modes

| Mode | Create issues | Close issues | Update descriptions | Link PRs | Move board status |
|------|:---:|:---:|:---:|:---:|:---:|
| **owner** | Yes | Yes | Yes | Yes | Yes |
| **contributor** | No | No | Yes | Yes | Yes (if permitted) |

**Owner mode** (default): Full PM integration. The saga/epic creates issues, closes them on completion, manages the full lifecycle.

**Contributor mode**: The user works within an existing PM structure managed by someone else (e.g., a PM or team lead). The saga/epic:
- **Asks the user** for existing issue IDs/URLs instead of creating new ones
- **Updates** issue descriptions and linked PRs
- **Does NOT** create or close issues
- **Does NOT** use `Closes #N` in PR bodies (uses `Related: #N` instead)

---

## Operations by Tool

### Create Epic Issue

**GitHub (owner):**
```bash
gh issue create \
  --title "Epic: {title}" \
  --label "epic" \
  --repo OWNER/REPO \
  --body "$BODY"
```

**GitHub (contributor):**
```
Ask the user: "What's the GitHub issue number for this epic? (or 'skip' if none)"
Store the provided issue number. Skip issue creation.
```

**Linear (owner):**
```bash
# If Linear MCP is available:
# Use mcp__linear__create_issue with team key and title
# Otherwise, use Linear CLI or API:
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation{issueCreate(input:{teamId:\"TEAM_ID\",title:\"Epic: {title}\",description:\"...\"}){success issue{id identifier url}}}"}'
```

**Linear (contributor):**
```
Ask the user: "What's the Linear issue identifier for this epic? (e.g., ENG-123, or 'skip')"
Store the provided identifier. Skip issue creation.
```

**Jira (owner):**
```bash
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"project":{"key":"PROJ"},"summary":"Epic: {title}","issuetype":{"name":"Epic"},"description":{"type":"doc","version":1,"content":[...]}}}'
```

**Jira (contributor):**
```
Ask the user: "What's the Jira issue key for this epic? (e.g., PROJ-123, or 'skip')"
Store the provided key. Skip issue creation.
```

**None:** Skip all PM operations. Store `null` for issue references.

---

### Create Stage Sub-Issue

**GitHub (owner):**
```bash
gh issue create --title "Stage {N}: {title}" --label "stage" --repo OWNER/REPO --body "$BODY"
gh issue edit $SUB_ISSUE --add-parent $EPIC_ISSUE --repo OWNER/REPO
```

**GitHub (contributor):** Skip. Sub-issues are not created.

**Linear (owner):** Create sub-issue with parent reference.

**Linear (contributor):** Skip.

**Jira (owner):** Create sub-task linked to epic.

**Jira (contributor):** Skip.

**None:** Skip.

---

### Close Issue

**Owner mode only.** In contributor mode, this operation is always skipped.

**GitHub:**
```bash
gh issue close $ISSUE_NUMBER --repo OWNER/REPO --comment "$COMMENT"
```

**Linear:**
```bash
# Set status to "Done" via API or MCP
```

**Jira:**
```bash
# Transition to "Done" via API
curl -s -X POST "$JIRA_BASE_URL/rest/api/3/issue/$ISSUE_KEY/transitions" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"DONE_TRANSITION_ID"}}'
```

---

### Update Issue Description

**Available in both owner and contributor modes.**

**GitHub:**
```bash
BODY=$(gh issue view $ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
# Modify BODY as needed
gh issue edit $ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED_BODY"
```

**Linear:** Update description via API or MCP.

**Jira:**
```bash
curl -s -X PUT "$JIRA_BASE_URL/rest/api/3/issue/$ISSUE_KEY" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"description":{...}}}'
```

---

### Link PR to Issue

**Available in both owner and contributor modes.**

**GitHub (owner):** Include `Closes #{number}` in PR body.
**GitHub (contributor):** Include `Related: #{number}` in PR body (no auto-close).

**Linear:** Include `Fixes ENG-123` or `Related: ENG-123` in PR body (Linear auto-detects).

**Jira:** Include issue key (e.g., `PROJ-123`) in PR body or branch name (Jira auto-detects with GitHub integration).

---

### Move Board Status

**Both modes**, but contributor mode may have limited permissions.

**GitHub:**
```bash
gh project item-edit \
  --project-id "$PROJECT_NODE_ID" \
  --id "$ITEM_NODE_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPTION_ID"
```

**Linear:** Status is a field on the issue — update via API.

**Jira:** Use transitions API.

**None:** Skip.

---

## Configuration Flow

When `epic init` or `epic configure` is run, the following questions are asked interactively:

1. **"Which project management tool does this project use?"**
   - GitHub Issues (default)
   - Linear
   - Jira
   - None

2. **"Do you own epics? (Can you create and close epic-level tickets?)"**
   - Yes → owner mode
   - No → contributor mode

   *Explain:* "In contributor mode, I'll ask you for existing issue IDs instead of creating new ones, and I won't close issues when work completes."

3. **Tool-specific questions:**

   | Tool | Questions |
   |------|-----------|
   | GitHub | "Project board number? (optional, for board status tracking)" |
   | Linear | "Linear team key? (e.g., ENG)" / "Is the Linear MCP server available?" |
   | Jira | "Jira project key? (e.g., PROJ)" / "Jira base URL? (e.g., https://myorg.atlassian.net)" |
   | None | No additional questions |

4. **"Notification topic for push alerts? (ntfy topic, optional)"**
   - If provided, configure ntfy
   - If skipped, fall back to desktop notifications

5. **Write the configuration** to `.ai-epics/docs/project-setup.md`.

---

## Conditional Logic Pattern

Throughout saga and epic SKILL.md files, PM operations use this pattern:

```
**PM Integration:** {operation description}.
- **owner:** {full operation}
- **contributor:** {limited operation or skip}
- **none:** Skip.
See `references/pm-integration.md` for tool-specific commands.
```

This keeps the main skill files concise while the reference doc handles tool-specific details.

---

## Best Practices

- **All PM operations are best-effort.** If a PM API call fails (auth, network, permissions), log the error and continue. The workflow must never block on a PM update.
- **Store PM references in roadmap files.** Issue IDs/URLs are stored in the roadmap so later phases can reference them without re-querying.
- **Contributor mode users** should be prompted for issue IDs during PLAN (epic) or DECOMPOSE (saga), not during later phases. Collect all references upfront.
- **API keys** should be stored in environment variables or tool-specific config files, never in project-setup.md or roadmap files.
