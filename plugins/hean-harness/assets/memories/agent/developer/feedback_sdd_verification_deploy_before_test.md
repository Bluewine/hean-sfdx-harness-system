---
name: sdd-verification-deploy-before-test
description: In SDD verification/deploy tasks, run the deploy step before the Apex test step
  whenever the brief lists new or modified Apex classes
metadata:
  type: feedback
---

When a task's verification brief lists steps in the order "run Apex tests" then "deploy",
and the test run references a class that is new or modified in the working tree but not yet
in the org, resequence to deploy first, then run tests. `sf apex run test` executes against
the org's currently deployed code — testing before deploying either fails to find a
brand-new test class or produces coverage numbers against stale code, neither of which is
the real signal the brief wants.

**Why:** A brief's literal step order describes the usual case, where the class under test
is already deployed. It breaks down the moment a task both creates a class and writes its
first test in the same pass — the two steps are written as if independent, but here one is
a precondition for the other.

**How to apply:** Note the resequence explicitly in the report as an ordering fix, not a
scope change — every verification step the brief asked for still runs, just in a working
order. Don't silently reorder without flagging it; whoever wrote the brief should see why
the literal step order wasn't followed. This is distinct from
[[feedback_sdd_brief_scope_vs_compile_safety]] (which is about scope of what to fix, not
step ordering).

Separately, remember that "tests pass" and "coverage meets threshold" are two different
gates reported by the same `sf apex run test --code-coverage` command — a 100%-pass-rate
test run can still sit below a required coverage threshold on one class. Report both numbers
per class explicitly rather than treating a passing test run as sufficient evidence of
meeting a coverage gate.
