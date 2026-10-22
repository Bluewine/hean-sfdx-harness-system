#!/usr/bin/env node
/**
 * What the feature toggle check finds in flow XML, how it learns whether the saved development org has the
 * toggle package, and what its --git-hook mode does with a staged flow.
 *
 * The git cases run in a throwaway repository; no client repository is touched and no org is called:
 * the org query is a stub.
 *
 * Run: node scripts/__tests__/flow-feature-toggle.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(SCRIPTS, 'lib', 'flow-feature-toggle.mjs');
const { toggleFindings, refusalText, notChecked, packageInstalled } = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const lookup = (name, object = 'Feature_Toggle__mdt', extra = '') => `
    <recordLookups>
        <name>${name}</name>
        <object>${object}</object>${extra}
    </recordLookups>`;
const action = name => `
    <actionCalls>
        <name>${name}</name>
        <actionName>FeatureToggleInvocableAction</actionName>
        <actionType>apex</actionType>
        <inputParameters><name>parentToggleLabel</name><value><stringValue>Sample_Toggle</stringValue></value></inputParameters>
    </actionCalls>`;
const start = type => `
    <start>
        <triggerType>${type}</triggerType>
    </start>`;
const flow = (...parts) => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>${parts.join('')}
</Flow>
`;
const AFTER = start('RecordAfterSave');
const BEFORE = start('RecordBeforeSave');
const P = 'force-app/main/default/flows/Sample.flow-meta.xml';

console.log('toggleFindings');
let f = toggleFindings(flow(AFTER, lookup('Get_Toggle')), null, P);
check('after-save new read is a use-action finding',
  f.length === 1 && JSON.stringify(f[0]) === JSON.stringify({ path: P, element: 'Get_Toggle', object: 'Feature_Toggle__mdt', kind: 'use-action' }), JSON.stringify(f));
const same = flow(AFTER, lookup('Get_Toggle'));
check('after-save read unchanged from HEAD is not a finding', toggleFindings(same, same, P).length === 0);
f = toggleFindings(flow(AFTER, lookup('Get_Toggle', 'Feature_Toggle__mdt', '\n        <getFirstRecordOnly>true</getFirstRecordOnly>')), same, P);
check('a read whose block changed is a finding', f.length === 1 && f[0].kind === 'use-action', JSON.stringify(f));
f = toggleFindings(flow(AFTER, lookup('Get_Toggle'), lookup('Get_Child', 'Child_Feature_Toggle__mdt')), same, P);
check('only the added read reports, with the child object', f.length === 1 && f[0].element === 'Get_Child' && f[0].object === 'Child_Feature_Toggle__mdt', JSON.stringify(f));
check('a screen flow (no start trigger) read is a finding', toggleFindings(flow(lookup('Get_Toggle')), null, P).length === 1);
check('a read of another object is ignored', toggleFindings(flow(AFTER, lookup('Get_Account', 'Account')), null, P).length === 0);
check('an action call only has no finding', toggleFindings(flow(AFTER, action('Check_Toggle')), null, P).length === 0);
check('before-save, one read per type, has no finding',
  toggleFindings(flow(BEFORE, lookup('Get_Toggle'), lookup('Get_Child', 'Child_Feature_Toggle__mdt')), null, P).length === 0);
const one = flow(BEFORE, lookup('Get_Toggle'));
f = toggleFindings(flow(BEFORE, lookup('Get_Toggle'), lookup('Get_Toggle_Again')), one, P);
check('before-save, a second read added is a one-per-type finding',
  f.length === 1 && f[0].kind === 'one-per-type' && f[0].element === 'Get_Toggle_Again', JSON.stringify(f));
const two = flow(BEFORE, lookup('Get_Toggle'), lookup('Get_Toggle_Again'));
check('before-save, two reads both unchanged from HEAD have no finding', toggleFindings(two, two, P).length === 0);
f = toggleFindings(flow(BEFORE, lookup('Get_Toggle'), lookup('Get_Toggle_Again')), null, P);
check('before-save, a new file with two reads reports only the second', f.length === 1 && f[0].element === 'Get_Toggle_Again', JSON.stringify(f));
f = toggleFindings(flow(BEFORE, lookup('Get_A'), lookup('Get_Z')), flow(BEFORE, lookup('Get_Z')), P);
check('before-save, a new read sorting before the existing one is the finding',
  f.length === 1 && f[0].element === 'Get_A' && f[0].kind === 'one-per-type', JSON.stringify(f));
f = toggleFindings(flow(lookup('Get_Toggle'), '\n    <decisions><name>D</name><triggerType>RecordBeforeSave</triggerType></decisions>'), null, P);
check('RecordBeforeSave outside <start> does not make a before-save flow', f.length === 1 && f[0].kind === 'use-action', JSON.stringify(f));

console.log('texts');
const text = refusalText([
  { path: P, element: 'Get_Toggle', object: 'Feature_Toggle__mdt', kind: 'use-action' },
  { path: P, element: 'Get_Toggle_Again', object: 'Feature_Toggle__mdt', kind: 'one-per-type' }]);
check('refusal is exactly the full text', text ===
  '!! This commit adds Get Records reads of feature toggles that break the flow rule "Feature toggles in flows":\n\n' +
  `    ${P}: Get_Toggle: Get Records on Feature_Toggle__mdt outside a before-save flow\n` +
  `    ${P}: Get_Toggle_Again: a second Get Records on Feature_Toggle__mdt in a before-save flow\n\n` +
  'Outside a record-triggered before-save flow, read a toggle with an action call to FeatureToggleInvocableAction ' +
  '(parentToggleLabel, plus childToggleLabel for a child toggle) and treat a null isActive as off: ' +
  'a flow that runs as the user cannot query the toggle types when custom metadata access is restricted. ' +
  'A before-save flow cannot call actions, so it keeps at most one Get Records per toggle type. Then retry the commit.', text);
check('notChecked is the exact line', notChecked('git failed') === '!! The feature toggle check did not run: git failed.');
check('notChecked drops a trailing period', notChecked('git failed.') === '!! The feature toggle check did not run: git failed.');

console.log('packageInstalled');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-toggle-check-')));
let n = 0;
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const repo = ({ roles = true } = {}) => {
  const dir = join(root, `r${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'sfdx-project.json'), '{}\n');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  if (roles) {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'hean-harness.json'),
      JSON.stringify({ orgs: { '00DXX0000000001': { alias: 'dev-sandbox', username: 'dev@example.com.dev', role: 'development', deploy: true, branch: null } } }));
  }
  return dir;
};
const stage = (dir, rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
  git(dir, 'add', rel);
};
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 0, 15);
const cacheFor = (cacheDir, installed, at) => {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, '00DXX0000000001.json'), JSON.stringify({ installed, checkedAt: at }));
};
const stub = (answers, calls = []) => (alias, soql) => {
  calls.push({ alias, soql });
  const a = answers.shift();
  if (a instanceof Error) throw a;
  return a;
};

try {
  let d = repo({ roles: false });
  let r = await packageInstalled(d, { query: stub([]), now: NOW, cacheDir: join(d, 'cache') });
  check('no saved deploy target is unknown with a reason', r.known === false && /deploy target/.test(r.reason), JSON.stringify(r));

  d = repo();
  let cacheDir = join(d, 'cache');
  cacheFor(cacheDir, true, NOW - 2 * DAY);
  let calls = [];
  r = await packageInstalled(d, { query: stub([], calls), now: NOW, cacheDir });
  check('a fresh cached answer is used without a query', r.known && r.installed === true && calls.length === 0, JSON.stringify(r));

  cacheFor(cacheDir, true, NOW - 8 * DAY);
  calls = [];
  r = await packageInstalled(d, { query: stub([[{ Id: '01p' }], [{ QualifiedApiName: 'Feature_Toggle__mdt' }]], calls), now: NOW, cacheDir });
  check('a stale cache is queried again', r.known && r.installed === true && calls.length === 2, JSON.stringify(r));
  check('both queries are tooling queries against the saved username',
    calls.every(c => c.alias === 'dev@example.com.dev') &&
    calls[0].soql === "SELECT Id FROM ApexClass WHERE Name = 'FeatureToggleInvocableAction'" &&
    calls[1].soql === "SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName = 'Feature_Toggle__mdt'", JSON.stringify(calls));
  check('the answer is written to the cache',
    JSON.parse(readFileSync(join(cacheDir, '00DXX0000000001.json'), 'utf8')).checkedAt === NOW);

  cacheFor(cacheDir, true, NOW - 8 * DAY);
  r = await packageInstalled(d, { query: stub([[{ Id: '01p' }], []]), now: NOW, cacheDir });
  check('a missing custom metadata type means not installed', r.known && r.installed === false, JSON.stringify(r));

  const d2 = repo();
  const cache2 = join(d2, 'cache');
  r = await packageInstalled(d2, { query: stub([new Error('org unreachable')]), now: NOW, cacheDir: cache2 });
  check('an unreachable org is unknown with a reason', r.known === false && /unreachable/.test(r.reason), JSON.stringify(r));
  check('an unreachable org writes no cache', !existsSync(cache2));

  cacheFor(cache2, true, NOW - 8 * DAY);
  calls = [];
  r = await packageInstalled(d2, { query: stub([], calls), now: NOW, cacheDir: cache2, cachedOnly: true });
  check('cachedOnly with a stale cache is unknown and never queries', r.known === false && calls.length === 0, JSON.stringify(r));

  const spin = ms => { const end = performance.now() + ms; while (performance.now() < end); };
  const d3 = repo();
  const cache3 = join(d3, 'cache');
  const timeouts = [];
  r = await packageInstalled(d3, { budgetMs: 400, now: NOW, cacheDir: cache3, query: (a, s, t) => { timeouts.push(t); spin(150); return [{ Id: '1' }]; } });
  check('the second query gets only the time left of the shared budget',
    r.known && timeouts.length === 2 && timeouts[0] <= 400 && timeouts[0] > 300 && timeouts[1] < timeouts[0] - 100 && timeouts[1] > 0, JSON.stringify(timeouts));
  const d4 = repo();
  const cache4 = join(d4, 'cache');
  calls = [];
  r = await packageInstalled(d4, { budgetMs: 100, now: NOW, cacheDir: cache4, query: (a, s, t) => { calls.push(t); spin(150); return [{ Id: '1' }]; } });
  check('an exhausted budget is unknown with the reason and skips the second query',
    r.known === false && r.reason === 'the org did not answer in time' && calls.length === 1, JSON.stringify({ r, calls }));
  check('an exhausted budget writes no cache', !existsSync(cache4));

  console.log('--git-hook');
  const run = (dir, cacheHome) => spawnSync(process.execPath, [SCRIPT, '--git-hook'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cacheHome } });
  const BAD = flow(AFTER, lookup('Get_Toggle'));
  const cacheHome = join(root, 'home');
  const homeCache = join(cacheHome, 'hean-harness', 'feature-toggle-package');

  d = repo();
  stage(d, P, BAD);
  r = run(d, cacheHome);
  check('no cached answer: exit 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  cacheFor(homeCache, false, Date.now());
  r = run(d, cacheHome);
  check('cached not-installed: exit 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  cacheFor(homeCache, true, Date.now());
  r = run(d, cacheHome);
  check('cached installed and a bad staged flow exits 3', r.status === 3, `status ${r.status} ${r.stderr}`);
  check('the refusal is on stderr', r.stderr.includes(`    ${P}: Get_Toggle: Get Records on Feature_Toggle__mdt outside a before-save flow`), r.stderr);

  d = repo();
  stage(d, P, BAD);
  git(d, 'commit', '-q', '--no-verify', '-m', 'bad flow');
  writeFileSync(join(d, P), BAD.replace('<apiVersion>65.0', '<apiVersion>66.0'));
  git(d, 'add', P);
  r = run(d, cacheHome);
  check('a read unchanged from HEAD is not refused', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, flow(AFTER, action('Check_Toggle')));
  r = run(d, cacheHome);
  check('an action call only exits 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, BAD);
  git(d, 'commit', '-q', '--no-verify', '-m', 'bad flow');
  git(d, 'rm', '-q', P);
  r = run(d, cacheHome);
  check('a deleted flow is ignored', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, BAD);
  writeFileSync(join(d, '.git', 'MERGE_HEAD'), `${git(d, 'rev-parse', 'HEAD').trim()}\n`);
  r = run(d, cacheHome);
  check('a merge in progress is skipped', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  r = run(root, cacheHome);
  check('outside a repository it exits 0 with the not-checked line',
    r.status === 0 && r.stderr.startsWith('!! The feature toggle check did not run: '), `status ${r.status} ${r.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
