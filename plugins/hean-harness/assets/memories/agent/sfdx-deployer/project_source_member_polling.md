---
name: SourceMember polling timeout warning
description: sf deploy emits a non-fatal SourceMember polling warning after successful deploys — safe to ignore
type: project
---

After a successful deploy, `sf project deploy start` sometimes ends with:

> Polling for N SourceMembers timed out after 5 attempts (last 5 were empty).

**Why:** Source tracking on a shared dev org is eventually consistent. The deploy succeeds (Status: Succeeded, Components: 1/1) but the org's source member table hasn't propagated within the polling window. This is a race condition in the org, not a deploy failure.

**How to apply:** If the deploy exit shows "Status: Succeeded" in the terminal output, treat the deploy as complete regardless of this warning. Do not re-deploy solely because of this message.