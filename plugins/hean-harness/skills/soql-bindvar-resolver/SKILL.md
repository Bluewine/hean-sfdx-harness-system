---
name: soql-bindvar-resolver
description: Use when given a Salesforce Apex debug log and asked to identify SOQL queries, resolve bindVar placeholders to real values, and trace originating methods from the call stack — with or without a target SObject; also use when asked to dump findings to a markdown file or generate a PDF report from the analysis
---

# SOQL BindVar Resolver

## Overview

Resolve `bindVar` placeholders in a Salesforce Apex debug log back to their concrete values and trace the full execution path from the top-level action method down to the `Database.queryWithBinds` call.

## When to Use

- User provides a `.log` file with **no target SObject** → resolve all SOQL queries in the log, grouped by execution context
- User provides a `.log` file with **a named SObject** → resolve only queries for that SObject
- User asks what value a `:bindVarN` resolves to
- User wants to trace which controller action or KPI method triggered a specific SOQL query
- User wants to see how a `Filter_Spec__c` custom metadata record is parsed into a final SOQL string

## Dispatch

```
User gave a target SObject?
  YES → run Single-SObject Protocol (Steps 1–7)
  NO  → run All-Queries Protocol (Steps A–E)

Multiple log files? (e.g. path contains | or user lists a.log b.log c.log)
  → treat each file as a separate execution run
  → run All-Queries Protocol per file independently
  → combine into one report (one H2 section per file)
```

## Single-SObject Protocol

### Step 1 — Size the file

```bash
wc -l "<path>/file.log"
```

### Step 2 — Find all occurrences of the target SObject

Search from the bottom (most recent execution wins):

```bash
grep -n "FROM <SObjectType>" "<path>/file.log" | tail -20
```

Pick the **last** pair of matching line numbers (the `USER_DEBUG` debug-print and the `SOQL_EXECUTE_BEGIN` that follow it are usually adjacent).

### Step 3 — Read the full SOQL query

Read ~30 lines before and after the `FROM <SObjectType>` line to capture the complete SELECT, WHERE, and any subquery clauses.

### Step 4 — Identify unresolved bindVars

Scan the WHERE clause for `:bindVarN` tokens. Note every token name.

### Step 5 — Resolve each bindVar

For each token (e.g. `:bindVar6`):

```bash
grep -n "bindVar6" "<path>/file.log" | tail -20
```

Find the `VARIABLE_ASSIGNMENT` line for `predicateKey` that assigns `"bindVar6"`. Read the surrounding ~15 lines — the `VARIABLE_ASSIGNMENT` for `predicate` or the post-exit assignment of the resolved value will show the concrete DateTime or String.

Key log patterns to look for:

| Log entry | Meaning |
|---|---|
| `VARIABLE_ASSIGNMENT|[N]|predicate|"2026-04-01T00:00:00.000Z"` | Raw predicate value before key assignment |
| `VARIABLE_ASSIGNMENT|[N]|predicateKey|"bindVar6"` | The key name being registered |
| `VARIABLE_ASSIGNMENT|[N]|s|"2026-04-01"` (post-`resolveValue` exit) | Resolved string after token substitution |

If the value comes from a token like `$MONTH_START` or `$TODAY`, find the call that resolves it — a filter parser, or whatever plays that role here. The `VARIABLE_ASSIGNMENT` immediately after that call's `METHOD_EXIT` holds the resolved string.

### Step 6 — Trace the call stack to the originating method

Work backward from the query execution line to find the top-level action:

```bash
grep -n "CODE_UNIT_STARTED\|EXECUTION_STARTED" "<path>/file.log" | head -10
```

Then find the enclosing project class. Substitute `<ClassPrefix>` with the prefix this project's
Apex classes carry — read it from the class names already in the log, or from the project's
settings if one is recorded. When classes carry no common prefix, drop that alternative and match
on the controller name alone:

```bash
grep -n "METHOD_ENTRY\|METHOD_EXIT" "<path>/file.log" \
  | grep "<ClassPrefix>\|<ControllerClassName>" \
  | awk -F'[:\t]' '$1 >= <start_line> && $1 <= <query_line>'
```

The outermost `CODE_UNIT_STARTED` entry identifies the Apex action (`ACTION$methodName`). The immediately enclosing `METHOD_ENTRY` before the filter/repo calls names the compute or KPI method.

### Step 7 — Find the custom metadata source (if applicable)

If the filter was built from a `__mdt` record, search for the MDT SOQL and the deserialized `Filter_Spec__c`:

```bash
grep -n "SOQL_EXECUTE_BEGIN.*__mdt\|Filter_Spec__c\|FilterRoot\|FilterParser" \
  "<path>/file.log" | head -20
```

The `VARIABLE_ASSIGNMENT` for `root` after `System.JSON.deserialize` will show the parsed `sObjectType` and `filters` structure.

## All-Queries Protocol

Use when the user provides only a log file path with no target SObject.

### Step A — Size the file and enumerate all executed queries

```bash
wc -l "<path>/file.log"
grep -n "SOQL_EXECUTE_BEGIN" "<path>/file.log"
```

Record every line number and the inline query text. This is the canonical list — do not add or remove entries.

### Step B — Identify execution context boundaries

```bash
grep -n "CODE_UNIT_STARTED\|CODE_UNIT_FINISHED\|EXECUTION_STARTED\|EXECUTION_FINISHED" "<path>/file.log"
```

Map each query line number to the nearest enclosing `CODE_UNIT_STARTED` block. Queries sharing the same outermost code unit belong to the same context group.

### Step C — For each query, read the full SOQL text

For each `SOQL_EXECUTE_BEGIN` line, read ~20 lines around it to capture the complete SELECT, FROM, WHERE, and any subquery clauses. Also read the matching `SOQL_EXECUTE_END` line to capture `Rows:N`.

### Step D — Resolve all bindVars per query

Apply the same resolution logic as Steps 4–5 of the Single-SObject Protocol, but scoped to each query's surrounding line range. Only resolve bindVars whose `predicateKey` assignment falls between the preceding `SOQL_EXECUTE_BEGIN` setup and the query's execution line — do not cross-contaminate binds from other queries.

### Step E — Trace the originating method per context group

For each context group, identify the enclosing action method using the same backward-trace logic as Step 6 of the Single-SObject Protocol.

## Output Format

### Single-SObject output

**1. Call chain** (top → bottom)
```
ACTION: apex://<Controller>/ACTION$<method>
  → <ControllerClass>.<method>()
    → <OrchestratorClass>.<method>(Id)
      → <KpiOrComputeClass>.compute(Id)
```

**2. Custom metadata → filter spec** (if applicable)

Show: MDT record `DeveloperName`, the `Filter_Spec__c` JSON structure, and each token → resolved value mapping.

**3. Final SOQL with bindVars replaced**

```sql
SELECT <fields>
FROM <SObjectType>
WHERE <field> >= <resolved_value>   -- bindVar6
  AND <field> <  <resolved_value>   -- bindVar7
```

**4. Execution result**

Report row count from `SOQL_EXECUTE_END|Rows:N` and any `SOQL_EXECUTE_EXPLAIN` cost/index details.

### All-Queries output

Render one block per context group, separated by a horizontal rule. Within each group, render one sub-block per query in execution order.

```
════════════════════════════════════════
CONTEXT: apex://<Controller>/ACTION$<method>
════════════════════════════════════════

  Query 1 of N — <SObjectType> (line <L>)
  ----------------------------------------
  Call chain:
    → <ControllerClass>.<method>()
      → <RepoOrComputeClass>.<method>()

  SQL (bindVars resolved):
    SELECT <fields>
    FROM   <SObjectType>
    WHERE  <field> >= <value>   -- bindVar1
      AND  <field> <  <value>   -- bindVar2

  Result: <N> rows

  Query 2 of N — <SObjectType> (line <L>)
  ----------------------------------------
  ...

════════════════════════════════════════
CONTEXT: apex://<Controller>/ACTION$<method2>
════════════════════════════════════════
  ...
```

After all groups, append a summary table:

| # | SObject | Rows | bindVars resolved | Context |
|---|---------|------|-------------------|---------|
| 1 | ServiceAppointment | 4 | bindVar1=…, bindVar2=… | ACTION$getKpis |
| 2 | WorkOrder | 12 | — | ACTION$getKpis |

## Report Generation

Dispatch on what the user explicitly requested:

```
User asked for .md only  → run R1 only
User asked for PDF only  → run R1 (temp) + R2 + R3; delete the .md at the end
User asked for both      → run R1 + R2 + R3; keep both files
User said "report" / "dump findings" with no format → run R1 + R2 + R3; keep both files
```

### Step R1 — Write the markdown file

Name the file after the log source: `<log-basename>-soql-analysis.md` (e.g. `apex-debug-soql-analysis.md`). Place it in the same directory as the log files unless the user specifies otherwise.

File structure:

```markdown
# <Descriptive Title> — SOQL BindVar Resolution Report

**Date:** <today>
**Log files:** `<file(s)>`
**Controller:** `<ControllerName>`

<one-paragraph summary: running user, account, concurrent actions>

## <log-filename> — `ACTION$<method>`

### Query N of M — `<SObject>` (line <L>)

**Call chain:**
\```
ControllerClass.method()
  → ServiceClass.method(Id)
\```

**SQL (bindVars resolved):**
\```sql
SELECT ...
FROM   SObjectType
WHERE  field = 'resolved_value'   -- bindVarN
\```

**Result:** N rows
**Explain:** <SOQL_EXECUTE_EXPLAIN text>

<optional result table for small row counts>

## Summary Table

| # | File | SObject | Line | Rows | Key bindVars resolved | Originating method |
...

## Notable Patterns

<bullet list of cross-query observations>
```

### Step R2 — Generate the PDF

**Do not use Chrome headless or `textutil`.** Both produce PDFs with system-font fallback issues. Use **WeasyPrint**, which is installed at `/opt/homebrew/bin/weasyprint` and embeds fonts correctly.

WeasyPrint requires its own Python path. Resolve the exact path first, then use it in the script:

```bash
# Resolve version-agnostic site-packages path
WEASY_SITE=$(find /opt/homebrew/Cellar/weasyprint -name "site-packages" -path "*/libexec/*" | head -1)
WEASY_PY=$(find /opt/homebrew/Cellar/weasyprint -name "python3*" -path "*/bin/*" | head -1)
echo "$WEASY_SITE"   # verify before proceeding
```

If both resolve to non-empty paths, write the script with those exact values:

```python
import sys
sys.path.insert(0, '<WEASY_SITE>')   # substitute from find output above
from weasyprint import HTML

HTML(filename='/path/to/report.html').write_pdf('/path/to/report.pdf')
```

Run with: `<WEASY_PY> generate_pdf.py`

If either path is empty, WeasyPrint is not installed — stop and tell the user rather than falling back to Chrome headless.

**HTML template requirements for correct fonts:**

```css
body {
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
}
pre, code {
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
}
pre {
    background: #0f172a;  /* dark background — makes code blocks unmistakable */
    color: #e2e8f0;
    padding: 12pt 14pt;
    page-break-inside: avoid;
}
code {                    /* inline code */
    background: #f1f5f9;
    color: #0f4c81;
    padding: 1pt 4pt;
    border-radius: 3px;
}
```

**Markdown → HTML conversion:** WeasyPrint takes HTML, not Markdown. Write a minimal Python converter inline in the script (regex-based is sufficient: headings, bold, inline code, fenced code blocks, tables, blockquotes, paragraphs). Do not install external packages.

### Step R3 — Clean up

Always delete the intermediate `.html` and `.py` files after the PDF is produced.
If the user asked for PDF only (not `.md`), also delete the `.md` at this step.

## Common Mistakes

- **Reading from the top** — the log may have earlier runs of the same query; always anchor on the last occurrence near EOF.
- **Confusing `predicateKey` assignment with the value** — the key line shows the name (`"bindVar6"`); the value is on a different nearby line (`predicate` or post-`resolveValue` assignment).
- **Stopping at the immediate caller** — trace all the way to `CODE_UNIT_STARTED` to name the true action method, not just the repo layer.
- **Cross-contaminating bindVars** — in All-Queries mode, only resolve binds whose `predicateKey` assignment falls within the current query's setup window; identically named `bindVarN` tokens from other queries are separate.
- **Grouping by SObject instead of by code unit** — context groups are defined by `CODE_UNIT_STARTED` boundaries, not by SObject type.
- **Using Chrome headless for PDF** — produces broken or missing monospace fonts; use WeasyPrint instead.
- **Ignoring which format the user asked for** — produce only what was requested; `.md` is always generated as an intermediate when PDF is needed, but delete it if the user only asked for PDF.
- **Leaving intermediate files** — delete `.html` and `.py` after the PDF is produced.