---
name: ops
description: "Delivery tracking, few-shot capture, and business insights for EaaS operations."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 1.0.0
---

# Ops

Delivery lifecycle tracking, few-shot pattern capture, and business intelligence for EaaS operations.

```
/ops few-shot   — Guided few-shot capture (requirement → correction → lesson)
/ops close      — Log a completed delivery to SQLite
/ops insights   — Query patterns from past deliveries
/ops status     — Quick stats (revenue, hours, margins)
```

---

## Data Paths

| Asset | Location |
|-------|----------|
| Deliveries DB | `/Users/lucas/Sites/vlt-data/db/deliveries.db` |
| DB Schema | `/Users/lucas/Sites/vlt-data/db/schema.sql` |
| JSON Export | `/Users/lucas/Sites/vlt-data/exports/deliveries.json` |
| Few-shots | `/Users/lucas/Sites/vlt-data/few-shots/{category}/{slug}.md` |

---

## `/ops few-shot`

Step-by-step guided capture using `AskUserQuestion`. One question at a time, never batch.

### Flow

**Step 1:** "What was the task?" — free text (requirement)

**Step 2:** "What did Claude generate?" — free text, or offer "auto-detect from last git diff":
```bash
git diff HEAD~1 --stat
git diff HEAD~1
```
If user picks auto-detect, summarize the diff as the generated output.

**Step 3:** "What did you correct?" — free text (the fixes applied)

**Step 4:** "What's the lesson?" — free text (reusable insight)

**Step 5:** "Category?" — present options:
- `layout`
- `component-usage`
- `theming`
- `data-display`
- `forms`
- `navigation`
- `other`

**Step 6:** "Save to memory MCP too?" — yes / no

### Write Few-Shot File

Generate slug from task description (lowercase, hyphens, max 50 chars). Ensure category directory exists.

```bash
mkdir -p /Users/lucas/Sites/vlt-data/few-shots/{category}
```

Write to `/Users/lucas/Sites/vlt-data/few-shots/{category}/{slug}.md`:

```markdown
## Requirement
{answer 1}

## Generated
{answer 2}

## Corrected
{answer 3}

## Lesson
{answer 4}
```

### Memory Store (if yes)

Call `mcp__memory__memory_store` with:
- **content:** Condensed version: "Few-shot [{category}]: {lesson}. Task: {requirement}. Fix: {correction summary}."
- **tags:** `few-shot`, `{category}`, relevant keywords from the task

---

## `/ops close`

Log a completed delivery. Step-by-step using `AskUserQuestion`. One question at a time.

### Flow

**Step 1:** "Client/project ID?" — free text (becomes `id` field)

**Step 2:** "Industry?" — options: `saas`, `consumer`, `fintech`, `healthcare`, `ecommerce`, `other`

**Step 3:** "Price?" — numeric (USD)

**Step 4:** "Hours spent?" — numeric

**Step 5:** "Theme config" — first attempt auto-detection:
```bash
grep -r "createTheme" --include="*.ts" --include="*.tsx" -l .
```
If found, read the file and extract the theme object. Present it for confirmation.
If not found, ask manually. Full schema:

```
Colors (4): primary, secondary, neutral, background
  Each: { hue, sat, isNeutral, isTinted, highContrast }
Size: sm | md | lg
Spacing: compact | regular | relaxed
Typography: { baseFontSize, bodyFont, headingFont, subheadingFont, codeFont }
Radius: { base }
Border: { base }
Shadow: { intensity }
Preset: string
```

**Step 6:** "Blocks reused?" — comma-separated list or "none"

**Step 7:** "New blocks worth extracting?" — comma-separated list or "none"

**Step 8:** "Bugs found? Specs updated?" — free text or "none"

**Step 9:** "Capture few-shots?" — yes chains to `/ops few-shot`, no continues

**Step 10:** "Notes?" — free text or "none"

### Write to SQLite

Generate a UUID for the `id` if the user gave a project name (use it as prefix):

```bash
ID="{project-name}-$(date +%Y%m%d)"
```

Insert into deliveries DB:

```bash
sqlite3 /Users/lucas/Sites/vlt-data/db/deliveries.db "
INSERT INTO deliveries (id, date, industry, price, delivery_hours, modules_selected, modules_rejected, theme_config, blocks_reused, blocks_extracted, specs_updated, bugs_found, few_shots_captured, notes)
VALUES (
  '{id}',
  date('now'),
  '{industry}',
  {price},
  {hours},
  '{modules_selected_json}',
  '[]',
  '{theme_config_json}',
  '{blocks_reused_json}',
  '{blocks_extracted_json}',
  '{specs_updated_json}',
  {bugs_count},
  {few_shots_count},
  '{notes}'
);
"
```

### Update Module Affinity

For each pair of modules in `modules_selected`, increment `co_occurrence_count` in `module_affinity`:

```bash
sqlite3 /Users/lucas/Sites/vlt-data/db/deliveries.db "
INSERT INTO module_affinity (module_a, module_b, co_occurrence_count)
VALUES ('{a}', '{b}', 1)
ON CONFLICT(module_a, module_b)
DO UPDATE SET co_occurrence_count = co_occurrence_count + 1,
              updated_at = datetime('now');
"
```

Then recalculate `co_occurrence_pct` for all rows:

```bash
sqlite3 /Users/lucas/Sites/vlt-data/db/deliveries.db "
UPDATE module_affinity
SET co_occurrence_pct = ROUND(
  co_occurrence_count * 100.0 / (SELECT COUNT(*) FROM deliveries),
  1
);
"
```

### Export JSON

After insert, regenerate the export:

```bash
sqlite3 -json /Users/lucas/Sites/vlt-data/db/deliveries.db "SELECT * FROM deliveries ORDER BY date DESC;" > /Users/lucas/Sites/vlt-data/exports/deliveries.json
```

### Confirm

Print summary:
```
Delivery logged: {id}
Industry: {industry} | Price: ${price} | Hours: {hours}h
Blocks reused: {count} | Extracted: {count} | Bugs: {count}
Export updated: deliveries.json
```

---

## `/ops insights`

Query the SQLite DB and present formatted results. No user interaction needed — just run and display.

### Queries

**Module Affinity (top 10 co-occurrences):**
```sql
SELECT module_a, module_b, co_occurrence_count, co_occurrence_pct
FROM module_affinity
ORDER BY co_occurrence_count DESC
LIMIT 10;
```

**Theme Trends by Industry:**
```sql
SELECT industry,
       COUNT(*) as deliveries,
       json_extract(theme_config, '$.size') as common_size,
       json_extract(theme_config, '$.spacing') as common_spacing
FROM deliveries
GROUP BY industry
ORDER BY deliveries DESC;
```

**Hours & Pricing:**
```sql
SELECT
  COUNT(*) as total,
  ROUND(AVG(price), 2) as avg_price,
  ROUND(AVG(delivery_hours), 1) as avg_hours,
  ROUND(AVG(price / delivery_hours), 2) as avg_hourly_rate,
  ROUND(MIN(price), 2) as min_price,
  ROUND(MAX(price), 2) as max_price
FROM deliveries;
```

**Most Reused Blocks (flatten JSON arrays, count occurrences):**
```sql
SELECT value as block, COUNT(*) as times_used
FROM deliveries, json_each(deliveries.blocks_reused)
GROUP BY value
ORDER BY times_used DESC
LIMIT 15;
```

### Output Format

Present each section as a markdown table with a header. Keep it scannable.

---

## `/ops status`

Quick stats. No interaction — query and display.

```sql
SELECT
  COUNT(*) as total_deliveries,
  ROUND(SUM(price), 2) as total_revenue,
  ROUND(AVG(delivery_hours), 1) as avg_hours,
  ROUND(AVG(price / delivery_hours), 2) as avg_hourly_rate,
  ROUND(SUM(price) / SUM(delivery_hours), 2) as blended_rate
FROM deliveries;
```

Display as:
```
Deliveries: {total} | Revenue: ${total_revenue}
Avg hours: {avg_hours}h | Avg rate: ${avg_hourly_rate}/h | Blended: ${blended_rate}/h
```

---

## Rules

1. **One question at a time.** Always `AskUserQuestion` sequentially, never batch.
2. **Auto-detect first.** Theme config, git diffs — try to pull from context before asking.
3. **Escape SQL values.** Single quotes in user input must be escaped before SQLite insertion.
4. **Create directories on demand.** Few-shot category dirs, exports dir — `mkdir -p` before writing.
5. **JSON arrays for list fields.** `modules_selected`, `blocks_reused`, etc. — always valid JSON.
6. **Export after every write.** Regenerate `deliveries.json` after any DB mutation.
7. **Memory is optional.** Only store to MCP when user explicitly opts in during few-shot capture.
