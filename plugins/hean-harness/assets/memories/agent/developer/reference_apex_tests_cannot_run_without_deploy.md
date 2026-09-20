---
name: apex-tests-cannot-run-without-deploy
description: Check-only deploys against the connected and selected org accept TestLevel RunSpecifiedTests but execute zero tests, so changed Apex tests cannot be run without a real deploy
metadata:
  type: reference
---

A check-only deploy is the only way to exercise edited Apex without saving it, and in this org
and CLI it does not run tests. Both `sf project deploy start --dry-run` and
`sf project deploy validate` with `--test-level RunSpecifiedTests --tests <Class>` report
`Passing: 0 / Failing: 0 / Total: 0` and `Running Tests - Skipped`. Querying the deploy via the
Tooling API (`SELECT TestLevel, NumberTestsTotal FROM DeployRequest WHERE Id = '<deploy id>'`)
shows `TestLevel = RunSpecifiedTests` with `NumberTestsTotal = 0` — the level arrives, the test
list does not take effect. Repeating the flag, space-separating names, quoting, and reordering
all behave the same.

**Why:** Apex only executes from saved state, and a test class calling a changed signature must
be in the deployment package to compile at all. A check-only deploy proves compilation and
nothing more.

**How to apply:** When a task forbids deploying but asks for Apex test results, do not spend
runs permuting deploy flags. Run the check-only deploy once to prove the production class and
its test class compile together, then report Apex as compile-validated and **not executed**,
with no coverage figure claimed. Anonymous Apex (`sf apex run --file`) against the same org is
the strongest supporting evidence available for the *logic* under test — but it cannot call
`@IsTest`-only helpers such as `SFCORE_TestUtilities.generateId` ("Cannot call test methods in
non-test context"); build ids from
`<SObject>.SObjectType.getDescribe().getKeyPrefix() + '000000000001'` instead. Label probe
output as supporting evidence, never as test results.
