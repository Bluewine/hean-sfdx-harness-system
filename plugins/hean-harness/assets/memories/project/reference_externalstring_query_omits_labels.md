---
name: externalstring-query-omits-labels
description: "Tooling API ExternalString queries silently omit custom labels that do exist — verify label presence with sf org list metadata, never with SOQL"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4597dbbe-9e02-4af1-9e23-ab2ffc5fe932
  modified: 2026-09-16T00:00:00.000Z
---

A Tooling API query against `ExternalString` can return no row for a custom label that is genuinely present in the org. An exact-match `SELECT Id, Name FROM ExternalString WHERE Name = '<label>'` returned empty for a label that the Metadata API confirmed exists, and `LIKE '%<substring>%'` missed it too while matching other labels in the same org. The query succeeds and reports nothing, so the result reads as proof of absence rather than as a failure.

This is dangerous specifically when checking whether a destructive deploy worked: a real deletion and an unreliable query produce identical output, so the query appears to confirm a cleanup it never actually verified.

**Verify label presence this way instead:**

```bash
sf org list metadata --metadata-type CustomLabel -o <org> --json > labels.json
grep -c '<LabelApiName>' labels.json      # 1 = present, 0 = absent
```

Redirect to a file and grep it. Do not pipe the JSON straight into a parser — the CLI embeds ANSI colour codes in `--json` output when stdout is redirected, which breaks `json.load`.

A single-label deploy is also authoritative and faster when the label is in the repo: `sf project deploy start --metadata "CustomLabel:<ApiName>" -o <org>` reporting `Unchanged` means the org has it and it matches the source, because that is a real source-to-org comparison. Trust that over a SOQL result that disagrees with it.

Related: [[feedback_confirm_precise_cause_before_fix]] — the same discipline of running the specific check before drawing a conclusion.
