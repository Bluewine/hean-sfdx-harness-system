---
name: project-sa-worktype-auto-synced-from-parent
description: "In an org with Field Service, an automated process re-syncs ServiceAppointment.WorkTypeId to match its parent WorkOrder's WorkTypeId after the parent changes"
metadata:
  node_type: memory
  type: project
---

When a WorkOrder's WorkTypeId is switched, a process in the org — not a trigger or flow in the
repository, observed directly, exact mechanism unconfirmed — updates the child
ServiceAppointment's WorkTypeId to match.

**Why this matters:** any tool that decides what it can repoint by asking whether a field is
updateable will classify `ServiceAppointment` as manual rather than automatic in an org where
`ServiceAppointment.WorkTypeId` is not updateable, which is the default unless Lightning Scheduler
is active — see [[reference_sa_worktype_editable_requires_lightning_scheduler]]. Such a tool then
skips ServiceAppointment, leaving it looking out of step with the WorkOrder and WorkOrderLineItem
it just repointed.

**How to apply:** do not report "the WorkOrder and WorkOrderLineItem were repointed but the
ServiceAppointment was not" as a data-consistency risk in an org where ServiceAppointment is
classified manual. The org's own automation reconciles it separately. A banner telling the user
that ServiceAppointment needs manual attention is still correct to show, but the data does not in
practice drift.
