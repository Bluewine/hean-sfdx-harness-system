---
name: reference-sf-cli-drops-test-level
description: sf project deploy validate reports testLevel None and runs zero tests regardless of --test-level, which then makes the validation ineligible for quick deploy
metadata:
  type: reference
---

`sf project deploy validate` and `sf project deploy start --dry-run` run **zero** Apex tests in this project no matter what `--test-level` and `--tests` are passed. `sf project deploy report --json` shows `testLevel: None` with `runTestsEnabled: true` and `numberTestsTotal: 0`, meaning the CLI never transmits the level to the org.

Affects CLI 2.148.3, across both flag spellings (`-l`/`-t` and `--test-level=`/`--tests=`), with both `--source-dir` and `--manifest`, and both when the named test classes were absent from the org and when they were present. Retry after a CLI upgrade before assuming it still applies.

A zero-test validation is then **not eligible for quick deploy** — `sf project deploy quick --job-id` fails with `CannotQuickDeployError`. One root cause, two symptoms.

**Why it matters:** a green validation looks like the tests passed. It measured nothing. Treating it as a gate is a false negative that hides real failures.

**How to apply — the user's standing deploy sequence for this project:**

1. `sf project deploy start --dry-run` — catches metadata errors before anything touches the org.
2. If clean, `sf project deploy start` — the real deploy.
3. `sf apex run test --class-names ...` — the only step that produces real pass counts and coverage.

Use dry-run rather than `validate`. Validate's sole advantage is producing a quick-deployable job, which is worthless while the test level is dropped, and it costs a server-side job for nothing. Never report a green dry-run or validation as evidence that tests pass — it measured none.

Two related gotchas: `sf apex run test --synchronous` accepts methods from only one class, so drop the flag for several; and both dry-run and validate run the `sfdx-project.json` `replaceWithEnv` substitution during local source conversion, so every referenced env var must be set even for a check-only run.

Supersedes an earlier note that blamed this on new test classes not yet existing in the org. That explanation was wrong — the behaviour is identical once the classes are deployed. Related: [[feedback_explicit_target_org]], [[feedback_manifest_location]].
