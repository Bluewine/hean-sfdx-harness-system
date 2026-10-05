#!/usr/bin/env node
/**
 * What apex-coverage.mjs prints and returns, and what it sends to `sf`.
 *
 * No org is called. PATH starts with a fake `sf` that logs its arguments and
 * answers from canned JSON files; each throwaway git repository holds an
 * sfdx-project.json, saved org roles and an apex-classes.txt.
 *
 * Run: node scripts/__tests__/apex-coverage.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(SCRIPTS, 'apex-coverage.mjs');
const { formatRanges } = await import(join(SCRIPTS, 'lib', 'apex-coverage.mjs'));
const { NO_TARGET } = await import(join(SCRIPTS, 'lib', 'runbook-compile.mjs'));

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'apex-coverage-')));
const BIN = join(sandbox, 'bin');
mkdirSync(BIN);
// The fake sf logs each call, then prints $FAKE_DIR/<subcommand>.json and exits with $FAKE_DIR/<subcommand>.code (default 0).
writeFileSync(join(BIN, 'sf'), `#!/bin/sh
echo "$*" >> "$FAKE_DIR/calls.log"
[ -f "$FAKE_DIR/$1.json" ] && cat "$FAKE_DIR/$1.json"
[ -f "$FAKE_DIR/$1.code" ] && exit "$(cat "$FAKE_DIR/$1.code")"
exit 0
`);
chmodSync(join(BIN, 'sf'), 0o755);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

let counter = 0;
/** A repository plus a canned-answer folder. input: apex-classes.txt text, or null for none; roles: false for none. */
function scenario({ input, roles = true, apex, query, apexCode, files = {}, apexRaw, queryRaw }) {
  const dir = join(sandbox, `s${++counter}`);
  const repo = join(dir, 'repo');
  const fake = join(dir, 'fake');
  mkdirSync(join(repo, '.claude', 'inputs'), { recursive: true });
  mkdirSync(fake);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  if (roles) {
    writeFileSync(join(repo, '.claude', 'hean-harness.json'), JSON.stringify({ orgs: {
      '00D000000000001': { alias: 'rewsdev', username: 'dev@example.com', role: 'development', deploy: true, branch: null } } }));
  }
  if (input !== null) writeFileSync(join(repo, '.claude', 'inputs', 'apex-classes.txt'), input);
  if (apex) writeFileSync(join(fake, 'apex.json'), JSON.stringify(apex));
  if (apexRaw) writeFileSync(join(fake, 'apex.json'), apexRaw);
  if (queryRaw) writeFileSync(join(fake, 'data.json'), queryRaw);
  if (apexCode) writeFileSync(join(fake, 'apex.code'), String(apexCode));
  if (query) writeFileSync(join(fake, 'data.json'), JSON.stringify(query));
  const r = spawnSync('node', [CLI], { cwd: repo, encoding: 'utf8',
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_DIR: fake, CLAUDE_CONFIG_DIR: join(dir, 'config') } });
  const calls = existsSync(join(fake, 'calls.log')) ? readFileSync(join(fake, 'calls.log'), 'utf8').trim().split('\n') : [];
  return { ...r, calls };
}

const pass = (cls, id, method) => ({ Outcome: 'Pass', MethodName: method, FullName: `${cls}.${method}`, ApexClass: { Id: id, Name: cls } });
const apexResult = tests => ({ status: 0, result: { summary: {}, tests } });
const row = (testId, name, covered, uncovered) =>
  ({ ApexTestClassId: testId, ApexClassOrTrigger: { Name: name }, Coverage: { coveredLines: covered, uncoveredLines: uncovered } });
const lines = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

try {
  // 1. Everything at 100%.
  {
    const r = scenario({
      input: '[test]\nScheduleServiceTest\n\n[tested]\nScheduleService\nWorkTypeSelector\n',
      apex: apexResult([pass('ScheduleServiceTest', '01pA', 'a'), pass('ScheduleServiceTest', '01pA', 'b')]),
      query: { status: 0, result: { records: [row('01pA', 'ScheduleService', lines(1, 46), []), row('01pA', 'WorkTypeSelector', lines(1, 12), [])] } }
    });
    check('all at 100% exits 0', r.status === 0, `status ${r.status}`);
    check('all at 100% prints the RESULT line', r.stdout.includes('RESULT: 100% — all 2 classes fully covered'), r.stdout);
    check('all at 100% prints the header and test summary',
      r.stdout.startsWith('Apex coverage — org rewsdev (development)\nTests run: 1 class, 2 methods — 2 passed, 0 failed'), r.stdout);
  }

  // 2. Overlapping rows from two test methods; one class below 100%.
  {
    const r = scenario({
      input: '[test]\nScheduleServiceTest\n[tested]\nScheduleService\n',
      files: { 'force-app/main/default/classes/ScheduleService.cls': 'public class ScheduleService {}' },
      apex: apexResult([pass('ScheduleServiceTest', '01pA', 'a'), pass('ScheduleServiceTest', '01pA', 'b')]),
      query: { status: 0, result: { records: [
        row('01pA', 'ScheduleService', [1, 2, 3, 41, 45], [42, 43, 44, 58, 61, 70]),
        row('01pA', 'ScheduleService', [1, 61], [42, 43, 44, 58, 70])] } }
    });
    check('partial coverage exits 2', r.status === 2, `status ${r.status}`);
    check('union of rows: ranges and counts', /%\s+6\/11\s+42-44, 58, 70/.test(r.stdout), r.stdout);
    check('RESULT line counts classes needing tests', r.stdout.includes('RESULT: BELOW 100% — 1 of 1 classes need tests'), r.stdout);
    check('action line carries the .cls path',
      r.stdout.includes('  ScheduleService: cover lines 42-44, 58, 70 (force-app/main/default/classes/ScheduleService.cls)'), r.stdout);
  }

  // 3. A [tested] class with no coverage rows.
  {
    const r = scenario({
      input: '[test]\nAT\n[tested]\nHasRows\nNoRows\n',
      apex: apexResult([pass('AT', '01pA', 'a')]),
      query: { status: 0, result: { records: [row('01pA', 'HasRows', [1, 2], [])] } }
    });
    check('class without rows exits 2', r.status === 2, `status ${r.status}`);
    check('class without rows says no listed test runs it', r.stdout.includes('no coverage: no listed test runs this class'), r.stdout);
    check('class without rows shows — in the lines column', /NoRows\s+0\.0%\s+—\s+no coverage/.test(r.stdout), r.stdout);
    check('class without rows counts in K of N', r.stdout.includes('RESULT: BELOW 100% — 1 of 2 classes need tests'), r.stdout);
    check('class without rows gets the add-a-test action',
      r.stdout.includes('  NoRows: no listed test reaches it; add a test class or list one under [test]'), r.stdout);
  }

  // 4. A failed test: sf exits 100 with JSON.
  {
    const r = scenario({
      input: '[test]\nScheduleServiceTest\n[tested]\nScheduleService\n',
      apexCode: 100,
      apex: apexResult([pass('ScheduleServiceTest', '01pA', 'ok'), { Outcome: 'Fail', MethodName: 'testReschedule',
        FullName: 'ScheduleServiceTest.testReschedule', Message: 'System.AssertException: Expected 2, got 1',
        StackTrace: 'Class.ScheduleServiceTest.testReschedule: line 88', ApexClass: { Id: '01pA', Name: 'ScheduleServiceTest' } }]),
      query: { status: 0, result: { records: [row('01pA', 'ScheduleService', [1], [2])] } }
    });
    check('failed test exits 3', r.status === 3, `status ${r.status}`);
    check('failed test block lists name, message and stack',
      r.stdout.includes('FAILED TESTS (coverage below is incomplete until these pass)\n  ScheduleServiceTest.testReschedule — System.AssertException: Expected 2, got 1\n    at Class.ScheduleServiceTest.testReschedule: line 88'), r.stdout);
    check('failed test RESULT line', r.stdout.includes('RESULT: TESTS FAILED — fix 1 failing test, then rerun'), r.stdout);
    check('the table still prints', r.stdout.includes('Uncovered lines'), r.stdout);
    const bare = scenario({
      input: '[test]\nT\n[tested]\nA\n',
      apexCode: 100,
      apex: apexResult([{ Outcome: 'Fail', MethodName: 'm', FullName: 'T.m', Message: 'boom', StackTrace: '', ApexClass: { Id: '01pA', Name: 'T' } }]),
      query: { status: 0, result: { records: [] } }
    });
    check('failed tests with no coverage rows print no table',
      bare.status === 3 && bare.stdout.includes('FAILED TESTS') && !bare.stdout.includes('Uncovered lines') &&
      bare.stdout.includes('RESULT: TESTS FAILED — fix 1 failing test, then rerun'), bare.stdout);
  }

  // 5. No development org saved.
  {
    const r = scenario({ input: '[test]\nAT\n[tested]\nA\n', roles: false });
    check('no saved org exits 1', r.status === 1, `status ${r.status}`);
    check('no saved org prints the NO_TARGET text', r.stdout.includes(`RESULT: ERROR — ${NO_TARGET}`), r.stdout);
    check('no saved org never calls sf', r.calls.length === 0, r.calls.join('; '));
  }

  // 6. Missing and empty input.
  {
    const missing = scenario({ input: null });
    check('missing input file exits 1 with a RESULT: ERROR line', missing.status === 1 && /^RESULT: ERROR — /m.test(missing.stdout), missing.stdout);
    const noTested = scenario({ input: '[test]\nAT\n[tested]\n# nothing\n' });
    check('empty [tested] exits 1', noTested.status === 1 && /RESULT: ERROR — .*\[tested\]/.test(noTested.stdout), noTested.stdout);
    const noTest = scenario({ input: '[test]\n\n[tested]\nA\n' });
    check('empty [test] exits 1', noTest.status === 1 && /RESULT: ERROR — .*\[test\]/.test(noTest.stdout), noTest.stdout);
    check('input errors never call sf', missing.calls.length + noTested.calls.length + noTest.calls.length === 0);
  }

  // 7. The arguments sf received.
  {
    const r = scenario({
      input: '[test]\nFirstTest\nSecondTest\n[tested]\nA\nB\n',
      apex: apexResult([pass('FirstTest', '01pA', 'a'), pass('SecondTest', '01pB', 'b')]),
      query: { status: 0, result: { records: [row('01pA', 'A', [1], []), row('01pB', 'B', [1], [])] } }
    });
    const [apexCall, queryCall] = r.calls;
    check('apex run test gets the saved org literally', / --target-org dev@example\.com$/.test(apexCall ?? ''), apexCall);
    check('apex run test names both test classes', /--class-names FirstTest --class-names SecondTest/.test(apexCall ?? ''), apexCall);
    check('the query goes to the Tooling API on the same org',
      /^data query --use-tooling-api /.test(queryCall ?? '') && / --target-org dev@example\.com$/.test(queryCall ?? ''), queryCall);
    check('the query filters by the run result test class Ids and the tested names',
      (queryCall ?? '').includes("ApexTestClassId IN ('01pA', '01pB')") && (queryCall ?? '').includes("ApexClassOrTrigger.Name IN ('A', 'B')"), queryCall);
  }

  // 8. Org spelling differs in case from the [tested] list.
  {
    const r = scenario({
      input: '[test]\nScheduleServiceTest\n[tested]\nscheduleService\nSCHEDULESERVICE\n',
      files: { 'force-app/main/default/classes/ScheduleService.cls': 'public class ScheduleService {}' },
      apex: apexResult([pass('ScheduleServiceTest', '01pA', 'a')]),
      query: { status: 0, result: { records: [row('01pA', 'ScheduleService', [1, 2], [3])] } }
    });
    check('case-different names still match the rows', r.status === 2 && /scheduleService\s+66\.7%\s+2\/3\s+3/.test(r.stdout), r.stdout);
    check('the [tested] spelling is shown and the duplicate is dropped', r.stdout.includes('RESULT: BELOW 100% — 1 of 1 classes need tests'), r.stdout);
    check('the source is found whatever the case',
      r.stdout.includes('  scheduleService: cover lines 3 (force-app/main/default/classes/ScheduleService.cls)'), r.stdout);
  }

  // 9. Tests passed but the query returned no rows.
  {
    const r = scenario({
      input: '[test]\nAT\n[tested]\nA\nB\n',
      apex: apexResult([pass('AT', '01pA', 'a')]),
      query: { status: 0, result: { records: [] } }
    });
    check('zero rows after passing tests exits 1', r.status === 1, `status ${r.status}`);
    check('zero rows names the aggregated-coverage option',
      r.stdout.includes('RESULT: ERROR — no per-test coverage rows returned; check "Store Only Aggregated Code Coverage" in Setup › Apex Test Execution › Options'), r.stdout);
    check('zero rows does not blame the test list', !r.stdout.includes('no listed test reaches it'), r.stdout);
  }

  // 10. A listed test class that did not run.
  {
    const r = scenario({
      input: '[test]\nAT\nGhostTest\n[tested]\nA\n',
      apex: apexResult([pass('at', '01pA', 'a')]),
      query: { status: 0, result: { records: [row('01pA', 'A', [1], [])] } }
    });
    const warn = 'WARNING: test class GhostTest was not run — check the name or that it is deployed';
    check('a test class that did not run gets a warning before the table',
      r.stdout.includes(warn) && r.stdout.indexOf(warn) < r.stdout.indexOf('Uncovered lines'), r.stdout);
    check('a test class that ran, in another case, gets no warning', !r.stdout.includes('test class AT was not run'), r.stdout);
  }

  // 11. Warnings before the JSON on stdout.
  {
    const r = scenario({
      input: '[test]\nAT\n[tested]\nA\n',
      apexCode: 100,
      apexRaw: ' ›   Warning: update available\n' + JSON.stringify(apexResult([{ Outcome: 'Fail', MethodName: 'm', FullName: 'AT.m', Message: 'boom', StackTrace: '', ApexClass: { Id: '01pA', Name: 'AT' } }])),
      query: { status: 0, result: { records: [row('01pA', 'A', [1], [2])] } }
    });
    check('text before the JSON keeps exit 3', r.status === 3 && r.stdout.includes('RESULT: TESTS FAILED'), `status ${r.status} ${r.stdout}`);
  }

  // 12. Partial query results.
  {
    const r = scenario({
      input: '[test]\nAT\n[tested]\nA\n',
      apex: apexResult([pass('AT', '01pA', 'a')]),
      query: { status: 0, result: { done: false, totalSize: 3, records: [row('01pA', 'A', [1], [])] } }
    });
    check('a partial query result exits 1 and says so', r.status === 1 && /RESULT: ERROR — coverage query returned partial results/.test(r.stdout), `status ${r.status} ${r.stdout}`);
  }

  // 13. Range formatting.
  check('formatRanges []', formatRanges([]) === '');
  check('formatRanges [5]', formatRanges([5]) === '5');
  check('formatRanges [1,2,3,7,9,10]', formatRanges([1, 2, 3, 7, 9, 10]) === '1-3, 7, 9-10');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n  ${failures} failed` : '\n  all checks passed');
process.exit(failures ? 1 : 0);
