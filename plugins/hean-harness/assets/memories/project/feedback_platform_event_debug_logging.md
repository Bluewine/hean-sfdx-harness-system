---
name: feedback-platform-event-debug-logging
description: "Testing anything involving a platform event requires trace flags on Automated Process and the workflow default user, not just the running user, at Workflow=FINEST"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 674eb1f1-3d76-486b-92c2-55541e6e88dd
  modified: 2026-08-12T13:29:03.572Z
---

When enabling debug logs for QA or interactive testing of anything that involves a platform event, trace three users, not one: the running user, the **Automated Process** user, and the org's **workflow default user**. Set the DebugLevel's `Workflow` category to `FINEST`.

**Why:** platform event subscribers execute as Automated Process. With only the running user traced, the subscriber's execution is invisible and the event looks like it never published — a false negative that reads as "the publish didn't happen" and sends you chasing a bug that isn't there. Process automation runs under the workflow default user. Separately, at `Workflow=INFO` no `FLOW_` entries are captured at all, so flow interviews and decisions cannot be seen even for a user that is traced.

**How to apply:** create one DebugLevel with `Workflow=FINEST` and a TraceFlag per user before running the test. Salesforce refuses overlapping TraceFlags for the same entity, so delete existing active ones first — a create that silently produces no record is usually this. Find the automated user with `SELECT Id, Name FROM User WHERE UserType='AutomatedProcess'`; the workflow default user is named in Setup under Process Automation Settings. Remove both the TraceFlags and the DebugLevel afterwards.

A useful corollary when reading the result: a `CODE_UNIT_STARTED|Flow:<Object>` with no matching `FLOW_CREATE_INTERVIEW_BEGIN` means the trigger dispatched but entry criteria were not met — not that the flow is broken.
