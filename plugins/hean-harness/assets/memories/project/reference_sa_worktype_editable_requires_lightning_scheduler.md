---
name: reference-sa-worktype-editable-requires-lightning-scheduler
description: ServiceAppointment.WorkType is read-only by platform default; Salesforce docs confirm it becomes editable only when Lightning Scheduler is active in the org
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6b0521cd-4674-4b81-8160-6a3f7c00ae5c
  modified: 2026-09-07T15:08:14.256Z
---

Per the official Salesforce Field Service field reference: `ServiceAppointment.WorkType` is documented as read-only by default — inherited from the appointment's parent (WorkOrder or WorkOrderLineItem). "If Lightning Scheduler is also in use, this field is editable. However, users see an error if they update it to list a different work type than the parent record's work type."

**Why this matters:** This is the mechanism behind an `EntityParticle.IsUpdatable` difference between two orgs — `false` in an org without Lightning Scheduler, `true` in orgs with it. It's not an FLS/permission-set issue (see [[project_sa_worktype_auto_synced_from_parent]]) — it's a platform capability gated by whether the Lightning Scheduler feature is active in a given org.

**How to apply:** Enabling Lightning Scheduler in such an org would make `ServiceAppointment.WorkTypeId` genuinely updateable there, which is what makes a tool classify `ServiceAppointment` as manual rather than automatic in that org. This is a Setup-level feature toggle, not a metadata deploy or permission-set assignment — raised as a separate, deferred concern from the code fix, not something a deploy can change.
