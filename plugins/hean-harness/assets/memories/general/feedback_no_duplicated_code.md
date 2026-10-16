---
name: feedback-no-duplicated-code
description: "Hard team rule — no repeated code/logic, even small, consolidate into one source of truth"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: df0d4480-468a-4720-ab1b-2e5d18b4596a
---

Duplicated code or business logic is prohibited by team policy, even when the duplication is small (e.g. a 4-line rule copied across an Apex class and two Flows).

**Why:** the cost is not the lines themselves — it is the *discovery* cost. A new team member without the business-domain knowledge cannot tell that two copies encode the same rule, so they drift or get partially updated. One source of truth removes that failure mode.

**How to apply:** when the same rule/logic would live in more than one place (Apex ↔ Apex, or Apex ↔ Flow via `@InvocableMethod`), extract it to a single implementation all consumers call. Prefer this even when the standalone duplication looks low-risk. When weighing a DRY refactor, do not recommend "leave it" purely on severity — the team rule overrides that. See [[feedback_always_use_developer_agent]] for how the extraction is implemented.
