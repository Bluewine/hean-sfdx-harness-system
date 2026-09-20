---
name: explicit_target_org
description: Changing data or metadata in any org without the user's explicit approval is forbidden. Which environments accept a direct deploy at all is the team's promotion policy, not something to assume
type: feedback
---

The core rule: never change data or metadata in any org without the user's explicit approval
first.

What counts as a change, and what does not:

- **Not a change. Fine in any org, no approval needed:** query, retrieve, describe, and running an
  existing test class exactly as already deployed. Running a test modifies no Apex class or test
  file, so it is not a change even though the org records a test result.
- **A change. Needs explicit approval:** `sf project deploy` of a new or modified class or test
  file, DML, permission or configuration changes, or anything else that alters org state.

For the development sandbox or scratch org — the connected and selected org — a direct deploy is
the normal development workflow, and approval for it is usually standing rather than per-command.

For environments meant for integration, QA, UAT or production, whether a direct deploy is possible
at all depends on the team's promotion policy. Where promotion runs through a pipeline driven by a
branch strategy, there is no direct path to those environments and asking to deploy to one is
asking for something that does not exist. Where a team does allow direct deploys, approval still
applies. Establish which of the two holds before proposing anything that writes.

**How to apply:** verify changes in the development org. Treat confirmation in a promotion
environment as something that happens through whatever route the team's policy defines. Query,
retrieve and describe freely anywhere, and run an existing test class unchanged to see the current
state — neither needs approval, since neither is a change. An exception the user grants for a
specific diagnostic task is scoped to that task and that action only; it does not carry forward.
If a task's own instructions call for writing directly to an environment the policy does not allow,
do not silently comply — flag the conflict and ask, since a brief written earlier in a session can
be stale relative to a correction made later.
