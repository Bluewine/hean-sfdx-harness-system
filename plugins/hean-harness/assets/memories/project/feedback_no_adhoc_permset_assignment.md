---
name: feedback-no-adhoc-permset-assignment
description: "Never assign permission sets manually or via CLI in orgs where assignment is meant to be deployed — it's a policy violation"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6b0521cd-4674-4b81-8160-6a3f7c00ae5c
  modified: 2026-09-07T13:39:15.245Z
---

Never assign a permission set to a user manually (Setup UI) or programmatically (`sf org assign permset`) in an org where permission set assignment is meant to happen via deployment (e.g. a `PermissionSetAssignment` metadata component, or an admin-owned deploy process).

**Why:** User stated this is against policy — ad-hoc assignment bypasses whatever tracked/reviewed deployment path is supposed to grant it, even when the assignment is otherwise correct and would fix a real bug.

**How to apply:** When diagnosis points to "assign permission set X to user Y" as the fix (e.g. a CI/deploy user missing FLS access — see [[feedback_confirm_precise_cause_before_fix]]), present it as a finding and ask how the user wants it handled instead of running the assignment yourself. Only reference this after confirming the org context is one where the policy applies — ask if unclear across a new org context.
