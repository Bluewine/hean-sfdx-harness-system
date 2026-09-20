---
name: feedback_fix_over_lint_suppression
description: Restructure code instead of accepting eslint-disable or NOSONAR suppression comments; check subagent diffs for them before deploy
metadata:
  type: feedback
---
Restructure the code instead of suppressing a lint rule. When a change adds `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line` or `NOSONAR`, first check whether a small rewrite removes the reason for the warning. For example, write a side-effect-only read as a bare statement instead of assigning it to an unused variable.

**Why:** the user asked why a developer-agent change assigned `host.offsetWidth` to an unused `forceReflow` variable and silenced `no-unused-vars` with a comment, instead of writing a bare statement. A suppression hides weak code. It can still fail CI when the central lint config names the rule differently or reports unused directives, and the local analyzer often cannot run here to catch it.

**How to apply:** review every subagent diff for suppression comments before approving a deploy. Require the restructured version unless the rule is provably a false positive, and state why when keeping one. Applies to all work under `force-app/`; see [[feedback_always_use_developer_agent]].
