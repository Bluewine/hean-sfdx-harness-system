#!/usr/bin/env node
/**
 * Runs the listed Apex test classes against the saved development org and
 * prints, per [tested] class, which lines those tests leave uncovered.
 *
 * Input: <repo root>/.claude/inputs/apex-classes.txt with a [test] and a
 * [tested] section. Output goes to stdout only; nothing is written to disk.
 *
 * Exit codes: 0 all classes at 100%; 1 could not run; 2 a class below 100%;
 * 3 a test failed. The last stdout line group always starts with `RESULT:`.
 *
 * Usage: apex-coverage.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deployEntry, deployTarget, NO_TARGET } from './lib/runbook-compile.mjs';
import { projectRoot } from './lib/org-roles.mjs';
import { EXIT, errorReport, findSource, mergeCoverage, packageDirectories, parseClassList, renderReport } from './lib/apex-coverage.mjs';

const fail = reason => { console.log(errorReport(reason)); process.exitCode = EXIT.ERROR; process.exit(); };

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return projectRoot(process.cwd());
  }
}

/** Runs sf and parses its JSON stdout whatever the exit code; { json, status }, json null when unparsable. */
function sf(args) {
  const r = spawnSync('sf', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) fail(`could not run sf: ${r.error.message}`);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {
    // sf can print warnings before the JSON; retry from the first line that starts with {.
    const start = String(r.stdout).search(/^\{/m);
    if (start > 0) { try { json = JSON.parse(r.stdout.slice(start)); } catch { /* reported by the caller */ } }
  }
  return { json, status: r.status, stderr: (r.stderr ?? '').trim() };
}

const quote = names => names.map(n => `'${n.replace(/'/g, "\\'")}'`).join(', ');

const root = repoRoot();
if (!root) fail('this folder is not inside a git repository or an SFDX project');

const org = deployTarget(root);
if (!org) fail(NO_TARGET);
// The header names the org by alias when one is saved; sf is always given the value deployTarget returns.
const label = deployEntry(root)?.alias ?? org;

const inputFile = join(root, '.claude', 'inputs', 'apex-classes.txt');
if (!existsSync(inputFile)) fail(`${inputFile} does not exist`);
const { test, tested } = parseClassList(readFileSync(inputFile, 'utf8'));
if (!test.length) fail(`${inputFile} has no class under [test]`);
if (!tested.length) fail(`${inputFile} has no class under [tested]`);

const run = sf(['apex', 'run', 'test', ...test.flatMap(n => ['--class-names', n]),
                '--code-coverage', '--detailed-coverage', '--wait', '120', '--json', '--target-org', org]);
const tests = run.json?.result?.tests;
// Exit 100 means tests failed and the JSON is still complete; anything else without a tests array is a CLI failure.
if (!Array.isArray(tests)) fail(`sf apex run test failed: ${run.json?.message ?? (run.stderr || `exit ${run.status}, no JSON output`)}`);

const testIds = [...new Set(tests.map(t => t.ApexClass?.Id).filter(Boolean))];
let rows = [];
if (testIds.length) {
  const soql = `SELECT ApexTestClassId, ApexClassOrTrigger.Name, TestMethodName, Coverage FROM ApexCodeCoverage ` +
               `WHERE ApexTestClassId IN (${quote(testIds)}) AND ApexClassOrTrigger.Name IN (${quote(tested)})`;
  const q = sf(['data', 'query', '--use-tooling-api', '--query', soql, '--json', '--target-org', org]);
  if (!Array.isArray(q.json?.result?.records)) fail(`coverage query failed: ${q.json?.message ?? (q.stderr || `exit ${q.status}, no JSON output`)}`);
  rows = q.json.result.records;
  const { done, totalSize } = q.json.result;
  if (done === false || totalSize > rows.length) fail(`coverage query returned partial results (${rows.length} of ${totalSize ?? 'more'} rows); narrow the [tested] list and rerun`);
  // Tests ran and passed yet no per-test row exists: the org stores aggregated coverage only, so no listed test can be blamed.
  if (!rows.length && !tests.some(t => t.Outcome !== 'Pass')) {
    fail('no per-test coverage rows returned; check "Store Only Aggregated Code Coverage" in Setup › Apex Test Execution › Options');
  }
}

const dirs = packageDirectories(root);
const { text, code } = renderReport({ org: label, tests, listed: test, tested, merged: mergeCoverage(rows), sourceOf: name => findSource(root, dirs, name) });
console.log(text);
process.exitCode = code;
