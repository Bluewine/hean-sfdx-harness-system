---
name: feedback-governor-limits-first-design-criterion
description: Conserving Salesforce system limits is the first design criterion whenever competing designs both meet the goal
metadata:
  type: feedback
---

When two designs both satisfy the requirement, choose the one that consumes fewer Salesforce system limits. Treat this as the first tiebreaker, ahead of readability, symmetry, or familiarity — not as an optimisation to apply afterwards.

**Why:** governor limits are the hard ceiling on what a Salesforce feature can do, and they are consumed per transaction by every caller at once. A design that spends a SOQL call or a heap of records to gain a little elegance narrows what the feature can ever grow into, and the cost is paid on every execution rather than once. The constraint only binds if the cheaper option still meets the goal — the user's phrasing was that limit saving comes first "as long as the result still meets the goal", so correctness is never traded for it.

**How to apply:**
- Push filtering into the SOQL query rather than iterating records in Apex to filter them.
- Prefer a design that needs no lookup over one that needs a lookup plus a cache. A memoised helper behind a static is the right pattern *when* something must be resolved; the better move is usually restructuring so nothing needs resolving.
- Do not add a query, a loop, or a cache to make an approach work without first checking whether a different approach avoids needing it.
- Worked example: filtering work orders on a restricted `StatusCategory` field directly in the query replaced both an enumerated status list needing manual upkeep and a proposed runtime-derived list that would have cost an extra query and a static cache.

Related: [[feedback_no_duplicated_code]], [[feedback_confirm_precise_cause_before_fix]].
