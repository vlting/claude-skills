# GitHub Adapter

> Implements the PM adapter contract (`pm-contract.md`) for GitHub Issues + Projects v2.

---

## Config Fields

```markdown
## Project Management

- **Tool:** github
- **Ownership:** owner | contributor
- **GitHub Project Board:** #{number}          ← optional, for board status tracking
```

If project board is configured, also store resolved IDs (populated during init or first epic):

```markdown
- **Project Node ID:** PVT_xxxxx
- **Status Field ID:** PVTSSF_xxxxx
- **Status Options:** Planning=xxx, Todo=xxx, In Progress=xxx, In Review=xxx, Done=xxx
```

---

## Actions

### `INIT_LABELS`

Create labels required by the epic workflow. Uses `--force` for idempotency:

```bash
gh label create "epic" --description "Multi-stage initiative" --color "8B5CF6" --repo OWNER/REPO --force
gh label create "stage" --description "Individual stage within an epic" --color "3B82F6" --repo OWNER/REPO --force
gh label create "iteration" --description "Fix from ITERATE phase" --color "F59E0B" --repo OWNER/REPO --force
gh label create "task" --description "Sub-issue: atomic unit of work within a stage" --color "10B981" --repo OWNER/REPO --force
```

### `INIT_BOARD`

Set up or configure the GitHub Projects v2 board.

**Step 1: Check `project` scope availability**

```bash
gh auth status 2>&1
```

If `project` scope is NOT available, print:
```
GitHub `project` scope not available. Skipping project board setup.
Run `gh auth refresh --hostname github.com -s read:project -s project` to enable later.
```
Set `PROJECT_NUMBER` to null and return.

**Step 2: Select or create a project**

- List existing projects: `gh project list --owner OWNER --format json`
- If projects exist, ask the user which project number to use (or skip)
- If no project exists, create one: `gh project create --title "REPO Roadmap" --owner OWNER`
- Capture `PROJECT_NUMBER`

**Step 3: Resolve board IDs**

```bash
# Get project node ID
PROJECT_NODE_ID=$(gh project view $PROJECT_NUMBER --owner OWNER --format json | jq -r '.id')

# Get Status field ID and options
gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
      }
    }
  }
' -f projectId="$PROJECT_NODE_ID"
```

**Step 4: Ensure required columns exist**

Read the existing status options from the query above. Check for "Planning" and "In Review" columns.

If either is missing, add them using `updateProjectV2Field`:

```bash
# Build the full options list: existing options + new ones
# Example: if "Planning" is missing and "In Review" is missing, append both

gh api graphql -f query='
  mutation($fieldId: ID!, $projectId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
    updateProjectV2Field(input: {
      projectId: $projectId
      fieldId: $fieldId
      singleSelectOptions: $options
    }) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          options { id name }
        }
      }
    }
  }
' -f fieldId="$STATUS_FIELD_ID" \
  -f projectId="$PROJECT_NODE_ID" \
  -f options="$OPTIONS_JSON"
```

Where `$OPTIONS_JSON` is the complete list of options (existing + new), structured as:
```json
[
  {"name": "Planning", "color": "BLUE", "description": "Being scoped and planned"},
  {"name": "Todo", "color": "GRAY", "description": "Ready to start"},
  {"name": "In Progress", "color": "YELLOW", "description": "Actively being worked on"},
  {"name": "In Review", "color": "ORANGE", "description": "PR open, awaiting review"},
  {"name": "Done", "color": "GREEN", "description": "Completed"}
]
```

> **Best-effort:** If any step fails (missing scope, GraphQL error), log the error and continue without board tracking. The workflow must never block on board setup.

**Step 5: Store all resolved IDs** for later use in project-setup.md:
- Project Node ID
- Status Field ID
- All Status Option IDs (Planning, Todo, In Progress, In Review, Done)

### `CREATE_EPIC_ISSUE`

**Owner:**
```bash
gh issue create \
  --title "Epic: {title}" \
  --label "epic" \
  --repo OWNER/REPO \
  --body "$BODY"
```

**Contributor:**
```
Ask the user: "What's the GitHub issue number for this epic? (or 'skip' if none)"
Store the provided issue number. Skip issue creation.
```

### `CREATE_STAGE_ISSUE`

**Owner:**
```bash
gh issue create --title "Stage {N}: {title}" --label "stage" --repo OWNER/REPO --body "$BODY"
gh issue edit $SUB_ISSUE --add-parent $EPIC_ISSUE --repo OWNER/REPO
```

**Contributor:** Skip. Sub-issues are not created.

### `CLOSE_ISSUE`

**Owner only.** In contributor mode, always skip.

```bash
gh issue close $ISSUE_NUMBER --repo OWNER/REPO --comment "$COMMENT"
```

### `UPDATE_ISSUE`

**Both modes.**

```bash
BODY=$(gh issue view $ISSUE_NUMBER --repo OWNER/REPO --json body -q '.body')
# Modify BODY as needed
gh issue edit $ISSUE_NUMBER --repo OWNER/REPO --body "$UPDATED_BODY"
```

### `LINK_PR`

**Owner:** Include `Closes #{number}` in PR body.
**Contributor:** Include `Related: #{number}` in PR body (no auto-close).

### `MOVE_BOARD_STATUS`

**Both modes** (contributor may have limited permissions).

```bash
gh project item-edit \
  --project-id "$PROJECT_NODE_ID" \
  --id "$ITEM_NODE_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPTION_ID"
```

Where `$OPTION_ID` corresponds to the target status (Planning, Todo, In Progress, In Review, Done) as resolved during `INIT_BOARD` and stored in the roadmap or project-setup.md.

### `POST_INIT`

Install the post-merge cleanup workflow:

```bash
mkdir -p .github/workflows
```

Write `.github/workflows/epic-cleanup.yml`:

```yaml
# Post-merge cleanup for the epic workflow.
# Archives the roadmap, commits the change, and deletes the epic branch.
name: Epic Post-Merge Cleanup

on:
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  contents: write

jobs:
  cleanup:
    if: >-
      github.event.pull_request.merged == true && (
        startsWith(github.event.pull_request.head.ref, 'epic/') ||
        startsWith(github.event.pull_request.head.ref, 'feat/') ||
        startsWith(github.event.pull_request.head.ref, 'fix/') ||
        startsWith(github.event.pull_request.head.ref, 'chore/') ||
        startsWith(github.event.pull_request.head.ref, 'docs/')
      )
    runs-on: ubuntu-latest

    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - name: Extract slug from branch name
        id: slug
        run: |
          BRANCH="${{ github.event.pull_request.head.ref }}"
          SLUG=$(echo "$BRANCH" | sed 's|^epic/||;s|^feat/||;s|^fix/||;s|^chore/||;s|^docs/||')
          echo "slug=$SLUG" >> "$GITHUB_OUTPUT"
          echo "branch=$BRANCH" >> "$GITHUB_OUTPUT"

      - name: Find roadmap file
        id: roadmap
        run: |
          MATCH=$(find .ai-epics/roadmaps -maxdepth 1 -name "*${{ steps.slug.outputs.slug }}*" -type f 2>/dev/null | head -1)
          if [ -z "$MATCH" ]; then
            echo "No roadmap file found for slug '${{ steps.slug.outputs.slug }}' — skipping."
            echo "found=false" >> "$GITHUB_OUTPUT"
          else
            echo "file=$MATCH" >> "$GITHUB_OUTPUT"
            echo "basename=$(basename "$MATCH")" >> "$GITHUB_OUTPUT"
            echo "found=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Update roadmap status and move to _completed
        if: steps.roadmap.outputs.found == 'true'
        run: |
          FILE="${{ steps.roadmap.outputs.file }}"
          sed -i 's/^\(- \*\*Status:\*\*\) .*/\1 done/' "$FILE"
          mkdir -p .ai-epics/archive
          mv "$FILE" ".ai-epics/archive/${{ steps.roadmap.outputs.basename }}"

      - name: Commit changes
        if: steps.roadmap.outputs.found == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .ai-epics/
          git commit -m "chore(epic): archive roadmap for ${{ steps.slug.outputs.slug }}" || echo "Nothing to commit"
          git push

      - name: Delete epic branch
        run: |
          BRANCH="${{ steps.slug.outputs.branch }}"
          if git ls-remote --exit-code --heads origin "$BRANCH" > /dev/null 2>&1; then
            git push origin --delete "$BRANCH"
            echo "Deleted remote branch: $BRANCH"
          else
            echo "Branch $BRANCH already deleted — skipping."
          fi
```

---

## Board Lifecycle

> **Saga and epic issues use a two-state board lifecycle: Planning → Done.** They stay in "Planning" from creation until completion moves them to "Done". Only stage sub-issues move through intermediate columns (Todo → In Progress → In Review → Done).
