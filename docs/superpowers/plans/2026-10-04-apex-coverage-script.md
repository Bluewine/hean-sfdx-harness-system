# Apex coverage script

**Goal:** Ship the Apex coverage script inside the plugin as one Node script, so apex-tester can measure coverage in every client repository, and so its output tells the caller (user or agent) at a glance whether every class is at 100% and exactly what to do when not.

**Spec:** the design approved by the user on 2026-10-04 (this plan's "Output contract" section is that design, verbatim in substance).

## Background

- The field-service repository had `.claude/scripts/coverage.sh` + `utils/coverage.py` (still readable with `git -C ~/git-repos/REWS-Workplace-Services/rews-field-service show origin/master:.claude/scripts/coverage.sh`). It was never ported; it was deleted from field-service `integration`. apex-tester still calls `.claude/scripts/coverage.sh`, so coverage is unmeasurable in every client.
- The old script hard-coded org `rewsdev`, needed Python and a venv, exited 0 when coverage was below 100%, silently dropped `[tested]` classes no test touched, and printed nothing useful on test failures.

## Global constraints

- Node only, no dependencies beyond Node built-ins and the plugin's own `scripts/lib/*`. No Python.
- Org: the org saved with `role: development` and `deploy: true`, found with the existing `deployTarget(repoRoot)` in `plugins/hean-harness/scripts/lib/runbook-compile.mjs` (move it to a shared place only if importing it from there is awkward; do not duplicate it). When none is saved, print the existing `NO_TARGET` message and exit 1. Pass the org to `sf` as a literal argument (`--target-org <value>`).
- Repo root: the git top level of the current working directory (fall back to `projectRoot(process.cwd())` from `scripts/lib/org-roles.mjs`). Roles are read the same way runbook-compile reads them.
- Input: `<repo root>/.claude/scripts/apex-classes.txt`, unchanged format: `[test]` and `[tested]` sections, one class name per line, blank lines and lines starting with `#` ignored, surrounding whitespace trimmed.
- Output goes to stdout only. No output folder, no venv, no files written. No `clear`.
- Comment density and style follow `scripts/verify-remote-refs.mjs` and `scripts/lib/runbook-compile.mjs`.

## Platform facts (verified 2026-10-04)

- `sf apex run test ... --code-coverage --detailed-coverage --json` exits 100 when any test fails (`plugin-apex` `testReporter.ts`, `FAILURE_EXIT_CODE = 100`) but still prints the JSON result; parse it regardless of exit code. Any other non-zero exit with unparsable or `status != 0` JSON without a `result.tests` array is a CLI failure → exit 1 with the CLI's `message`.
- JSON result shape (`plugin-apex` `jsonReporter.ts`): `result.summary` (`outcome`, `passing`, `failing`, `testsRan`, …), `result.tests[]` with `Outcome`, `MethodName`, `Message`, `StackTrace`, `FullName`, `ApexClass: { Id, Name }`.
- Do NOT use `result.coverage.coverage[]` for line data: it comes from `ApexCodeCoverageAggregate`, which aggregates every test run in the org, not just this one (`salesforcedx-apex` `codeCoverage.ts`).
- Line data source: after the run, query the Tooling API: `SELECT ApexTestClassId, ApexClassOrTrigger.Name, TestMethodName, Coverage FROM ApexCodeCoverage WHERE ApexTestClassId IN (<Ids of the listed test classes, from result.tests[].ApexClass.Id>) AND ApexClassOrTrigger.Name IN (<[tested] names>)` with `sf data query --use-tooling-api --json --target-org <org>`. `Coverage` holds `coveredLines` and `uncoveredLines` arrays. Per class: covered = union of coveredLines across rows; uncovered = union of uncoveredLines minus covered; total = |covered| + |uncovered|.
- `${CLAUDE_PLUGIN_ROOT}` is substituted inline in agent Markdown bodies when the agent loads; it is NOT in the Bash tool's environment (code.claude.com/docs/en/plugins-reference, "Where each variable resolves").

## Output contract

Header, then test summary, then (failures, if any), then the coverage table, then exactly one `RESULT:` line, then action lines.

All at 100%:

```
Apex coverage — org rewsdev (development)
Tests run: 2 classes, 14 methods — 14 passed, 0 failed

Class              Coverage   Lines    Uncovered lines
ScheduleService    100.0%     46/46    —
WorkTypeSelector   100.0%     12/12    —

RESULT: 100% — all 2 classes fully covered
```

Below 100%:

```
Apex coverage — org rewsdev (development)
Tests run: 2 classes, 14 methods — 14 passed, 0 failed

Class              Coverage   Lines    Uncovered lines
ScheduleService     87.0%     40/46    42-44, 58, 61, 70
WorkTypeHelper       0.0%      0/31    no coverage: no listed test runs this class
WorkTypeSelector   100.0%     12/12    —

RESULT: BELOW 100% — 2 of 3 classes need tests
  ScheduleService: cover lines 42-44, 58, 61, 70 (force-app/main/default/classes/ScheduleService.cls)
  WorkTypeHelper: no listed test reaches it; add a test class or list one under [test]
```

Test failures (failures block printed before the table; the table still prints when coverage rows exist):

```
FAILED TESTS (coverage below is incomplete until these pass)
  ScheduleServiceTest.testReschedule — System.AssertException: Expected 2, got 1
    at Class.ScheduleServiceTest.testReschedule: line 88
...
RESULT: TESTS FAILED — fix 1 failing test, then rerun
```

Rules:

- The org label is the value passed to `--target-org` (alias or username as saved).
- Classes sorted by name; columns aligned with padding computed from the longest class name.
- Percent with one decimal. A class at 100% shows `—` under uncovered lines.
- A `[tested]` class with no coverage rows from the listed tests: coverage `0.0%`, lines column `—` (its line count is unknown without rows; never query the aggregate for it), uncovered column `no coverage: no listed test runs this class`. It counts as below 100%. (This replaces the `0/31` shown in the example above.)
- A class with total 0 lines but rows present (e.g. interface-only) counts as 100%.
- Uncovered lines collapse consecutive numbers into ranges (`42-44`).
- Action line path: the first file named `<Class>.cls` or `<Class>.trigger` under the repo's package directories (from `sfdx-project.json` `packageDirectories[].path`, default `force-app`), repo-relative; omit the parenthesis when not found.
- Failed tests: every `result.tests[]` entry whose `Outcome` is not `Pass` (`Fail`, `CompileFail`, `Skip` each listed; the message line shows the Outcome when Message is empty). Stack trace lines indented under it, at most 5 lines each.
- `RESULT:` line forms exactly: `RESULT: 100% — all N classes fully covered`, `RESULT: BELOW 100% — K of N classes need tests`, `RESULT: TESTS FAILED — fix F failing test(s), then rerun` (use "test"/"tests" correctly), `RESULT: ERROR — <reason>`.
- Exit codes: `0` all 100%; `2` at least one class below 100% and no failed tests; `3` at least one failed test (takes precedence over 2); `1` could not run (no saved development org, missing or empty input file, empty `[test]` or `[tested]`, CLI failure, unparsable CLI output). Exit 1 still prints a `RESULT: ERROR — …` line.

## Task 1: The coverage script and its tests

**Files:**
- Create `plugins/hean-harness/scripts/apex-coverage.mjs` (executable entry, `#!/usr/bin/env node`).
- Optionally create `plugins/hean-harness/scripts/lib/apex-coverage.mjs` for the pure parts (input parsing, line merging, range formatting, report rendering) if that keeps the entry small and the pure parts testable without `sf`.
- Create `plugins/hean-harness/scripts/__tests__/apex-coverage.test.mjs` following the style of the other files in that folder (plain `node` runner, no test framework, non-zero exit on failure).
- If `deployTarget` must move for a clean import, update its importers and keep `runbook-compile-check.test.mjs` passing.

**Behaviour:** as in Global constraints, Platform facts and Output contract.

**Tests** (fake `sf` on `PATH` written by the test into a temp folder, returning canned JSON per subcommand; temp git repo with `sfdx-project.json`, `.claude/hean-harness.json` roles and `.claude/scripts/apex-classes.txt`):
1. All classes at 100% → exit 0, `RESULT: 100% — all 2 classes fully covered`.
2. One class partly covered, lines from two test methods overlapping → union is correct, ranges printed (`42-44, 58`), action line with the `.cls` path, exit 2.
3. A `[tested]` class with no coverage rows → `no coverage: no listed test runs this class`, counted in "K of N", exit 2.
4. A failed test (`sf` exits 100 with JSON) → `FAILED TESTS` block with `Class.method — message` and stack line, `RESULT: TESTS FAILED — fix 1 failing test, then rerun`, exit 3.
5. No development org saved → `RESULT: ERROR — …` containing the NO_TARGET text, exit 1, `sf` never called.
6. Missing input file, and input with empty `[tested]` → exit 1 each.
7. The `sf` calls received `--target-org <saved value>` and the Tooling query filtered by the test class Ids from the run result.
8. Range formatting unit cases: `[]`, `[5]`, `[1,2,3,7,9,10]` → `1-3, 7, 9-10`.

Run the full loop before committing: every `plugins/hean-harness/hooks/__tests__/*.test.mjs` and `plugins/hean-harness/scripts/__tests__/*.test.mjs` with `node`, one at a time, never two loops at once. Never commit `assets/rules/user/zz-test-dropped-rule.md` (a test writes it briefly).

**Commit** by explicit path: `@HEAN-1: Add the Apex coverage script`.

## Task 2: Point apex-tester at the script

**Files:** `plugins/hean-harness/agents/apex-tester.md` only.

- Replace every `.claude/scripts/coverage.sh` reference with the plugin script, invoked as `node "${CLAUDE_PLUGIN_ROOT}/scripts/apex-coverage.mjs"` from the repository root (lines ~26, 37, 100, 134, 158, 218, 222, 233, 247, 248 at `c49d28e`).
- Remove the sentence "The project supplies this script; the plugin does not ship one." and the absent-script fallback that follows it; replace with: the script prints `RESULT: ERROR — …` and exits 1 when it cannot run — report that line verbatim and stop.
- Step 7/8 (Run coverage script / Analyze coverage output): read the exit code and the `RESULT:` line first — `0` success, `2` below 100% → Plan Mode using the per-class uncovered ranges and action lines, `3` failing tests → report every failed test from the `FAILED TESTS` block and stop before planning coverage (coverage is incomplete), `1` → report the error line and stop. Drop "Identify any coverage artifact files the script produces" (it produces none).
- The example at ~233 uses the new table line format (`ScheduleService     87.0%     40/46    42-44, 58, 61`).
- Keep the `apex-classes.txt` writing step unchanged. Keep every other section unchanged. Follow `~/.claude/rules/agent-writing-style.md` for any sentence added.

**Verify:** `grep -n 'coverage\.sh' plugins/hean-harness/agents/apex-tester.md` returns nothing; full test loop passes.

**Commit** by explicit path: `@HEAN-1: Point apex-tester at the plugin coverage script`.
