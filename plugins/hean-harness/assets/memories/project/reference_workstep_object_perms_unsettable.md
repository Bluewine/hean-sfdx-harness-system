---
name: reference_workstep_object_perms_unsettable
description: WorkStep object permissions cannot be granted via permission sets — platform strips them on deploy, leaving no ObjectPermissions rows anywhere in the org
metadata: 
  node_type: memory
  type: reference
  originSessionId: 13945609-a929-4276-810a-70e546d1345c
---

WorkStep (Field Service standard object) does not support object-level permissions in permission sets or profiles. In a Field Service org:

- `SELECT ... FROM ObjectPermissions WHERE SobjectType='WorkStep'` returns **0 rows** org-wide.
- Deploying a `<objectPermissions>` block for WorkStep succeeds (deploy reports 2/2, 0 errors) but the org **silently discards it** — a follow-up `retrieve` returns the permission set with no WorkStep object block.
- Control: WorkPlan (same object family) has 108 ObjectPermissions rows and its block persists through deploy+retrieve. So this is WorkStep-specific, not a Field-Service-wide limitation.

Implication: WorkStep record access is governed by field-level security (WorkStep.* field perms DO persist) plus the parent WorkPlan access and the Field Service license — not by a WorkStep object grant. Do not treat a missing WorkStep `<objectPermissions>` block as a bug to fix; it is unsettable. The Salesforce "Set Up Work Plans" doc line "assign Read and Update on work step records" is satisfied through WorkPlan (parent) access + WorkStep field FLS, not an object permission.

Related: WorkPlan object perms ARE settable and required at Read+Edit for the "work with work plans" role. See [[reference_datetime_local_browser_timezone]] for another platform behaviour that looks like a bug and is not.
