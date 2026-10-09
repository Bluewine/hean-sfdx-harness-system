#!/usr/bin/env node
/**
 * What flow-version-cleanup selects, sends and reports.
 *
 * No org is called. The library is tested directly; the command-line part
 * puts a fake `sf` first on PATH that logs its arguments and answers from
 * canned JSON, and a throwaway HOME holding the CLI logins and aliases.
 *
 * Run: node scripts/__tests__/flow-version-cleanup.test.mjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const lib = await import(join(SCRIPTS, 'lib', 'flow-version-cleanup.mjs'));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** n versions of one flow; active: the Active version number or null; status(v) overrides the rest. */
function flow(name, n, active, status = () => 'Obsolete') {
  return Array.from({ length: n }, (_, i) => ({
    Id: `301${name}${String(i + 1).padStart(3, '0')}`, DefinitionId: `300${name}`,
    Definition: { DeveloperName: name }, VersionNumber: i + 1,
    Status: i + 1 === active ? 'Active' : status(i + 1)
  }));
}

console.log('parseCount');
check('default is 5', lib.parseCount(undefined) === 5);
check('accepts 30', lib.parseCount('30') === 30);
for (const bad of ['0', '-2', 'abc', '1.5', '']) {
  let threw = false; try { lib.parseCount(bad); } catch (e) { threw = /whole number of 1 or more/.test(e.message); }
  check(`refuses "${bad}"`, threw);
}

console.log('matchOrg');
const orgs = [
  { username: 'me@example.com.qa', aliases: ['qaOrg'], isSandbox: true },
  { username: 'me@example.com.uat', aliases: ['uatOrg'], isSandbox: true },
  { username: 'other@example.com.qa', aliases: [], isSandbox: true },
  { username: 'me@example.com', aliases: ['prod'], isSandbox: false }
];
check('alias, any case', same(lib.matchOrg('QAORG', orgs).map(o => o.username), ['me@example.com.qa']));
check('username', same(lib.matchOrg('me@example.com.uat', orgs).map(o => o.username), ['me@example.com.uat']));
check('sandbox name matching one org', same(lib.matchOrg('uat', orgs).map(o => o.username), ['me@example.com.uat']));
check('sandbox name matching two orgs', lib.matchOrg('qa', orgs).length === 2);
check('no match', lib.matchOrg('nothing', orgs).length === 0);
check('production has no sandbox name', lib.matchOrg('com', orgs).length === 0);

console.log('checkComplete');
let partial = false; try { lib.checkComplete({ done: false, totalSize: 3, records: [{}] }); } catch (e) { partial = /partial/.test(e.message); }
check('done false is refused', partial);
let short = false; try { lib.checkComplete({ done: true, totalSize: 3, records: [{}] }); } catch (e) { short = /partial/.test(e.message); }
check('fewer records than totalSize is refused', short);
let whole = true; try { lib.checkComplete({ done: true, totalSize: 1, records: [{}] }); } catch { whole = false; }
check('a whole list passes', whole);

console.log('selectVersions');
{
  const records = [
    ...flow('Under', 49, 49),
    ...flow('Full', 50, 20, v => v > 40 ? 'Draft' : 'Obsolete'),
    ...flow('NoActive', 50, null),
    ...flow('Above', 52, 3, v => v === 1 ? 'InvalidDraft' : 'Obsolete')
  ];
  const { flows, skipped } = lib.selectVersions(records, 5);
  check('49 versions untouched', !flows.some(f => f.name === 'Under') && !skipped.some(s => s.name === 'Under'));
  check('no Active version is skipped', same(skipped, [{ definitionId: '300NoActive', name: 'NoActive', present: 50 }]));
  const full = flows.find(f => f.name === 'Full');
  check('50 versions selected, oldest 5', same(full.delete.map(v => v.version), [1, 2, 3, 4, 5]));
  check('active version recorded', full.activeVersion === 20);
  const above = flows.find(f => f.name === 'Above');
  check('Active never selected; InvalidDraft counts', same(above.delete.map(v => v.version), [1, 2, 4, 5, 6]));
  check('flows sorted by name', same(flows.map(f => f.name), ['Above', 'Full']));
  const big = lib.selectVersions(flow('Big', 50, 50), 100).flows[0];
  check('count larger than candidates takes every candidate', big.delete.length === 49);
  const drafts = lib.selectVersions(flow('Late', 50, 10, v => v > 10 ? 'Draft' : 'Obsolete'), 45).flows[0];
  check('Drafts above the Active version are candidates', drafts.delete.some(v => v.version === 46));
  const gaps = flow('Gap', 50, 50).map((r, i) => ({ ...r, VersionNumber: i < 10 ? i * 3 + 1 : r.VersionNumber + 30 }));
  check('gaps in numbering: lowest numbers first',
        same(lib.selectVersions(gaps, 3).flows[0].delete.map(v => v.version), [1, 4, 7]));
}

console.log('stillDeletable');
{
  const planned = [{ id: 'a', version: 1 }, { id: 'b', version: 2 }, { id: 'c', version: 3 }];
  const { keep, dropped } = lib.stillDeletable(planned, [{ Id: 'a', Status: 'Obsolete' }, { Id: 'b', Status: 'Active' }]);
  check('keeps an inactive version', same(keep.map(v => v.id), ['a']));
  check('drops a version now Active', dropped.some(d => d.id === 'b' && d.reason === 'now Active'));
  check('drops a version already deleted', dropped.some(d => d.id === 'c' && d.reason === 'already deleted'));
}

console.log('buildBatches');
{
  const vs = n => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, version: i + 1 }));
  check('0 versions, no batch', lib.buildBatches(vs(0), '64.0').length === 0);
  check('25 versions, one batch', same(lib.buildBatches(vs(25), '64.0').map(b => b.versions.length), [25]));
  check('26 versions, two batches', same(lib.buildBatches(vs(26), '64.0').map(b => b.versions.length), [25, 1]));
  check('51 versions, three batches', same(lib.buildBatches(vs(51), '64.0').map(b => b.versions.length), [25, 25, 1]));
  check('subrequest shape', same(lib.buildBatches(vs(1), '64.0')[0].body,
        { batchRequests: [{ method: 'DELETE', url: 'v64.0/tooling/sobjects/Flow/id0' }] }));
}

console.log('parseBatchResponse');
{
  const vs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const body = JSON.stringify({ hasErrors: true, results: [
    { statusCode: 204, result: null },
    { statusCode: 400, result: [{ errorCode: 'DEPENDENCY_EXISTS', message: 'This flow version is referenced in a flow interview.' }] },
    { statusCode: 400, result: [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'unable to obtain exclusive access' }] }
  ] });
  const r = lib.parseBatchResponse(vs, ` ›   Warning: update available\n${body}`);
  check('204 is deleted', r[0].ok === true);
  check('error code and message kept', r[1].ok === false && r[1].error === 'DEPENDENCY_EXISTS: This flow version is referenced in a flow interview.');
  check('lock error recognised', lib.isLockError(r[2].error) && !lib.isLockError(r[1].error));
  const lost = lib.parseBatchResponse(vs, '', 'socket hang up');
  check('whole-request failure marks every version', lost.length === 3 && lost.every(x => !x.ok && /whole request failed: socket hang up/.test(x.error)));
  const wrongLength = lib.parseBatchResponse(vs, JSON.stringify({ results: [{ statusCode: 204 }] }));
  check('result count mismatch is a whole-request failure', wrongLength.every(x => !x.ok));
}

console.log('reconcile');
{
  const r = lib.reconcile([{ id: 'a', ok: false, error: 'whole request failed: x' }, { id: 'b', ok: false, error: 'DEPENDENCY_EXISTS: y' }],
                          [{ Id: 'b' }]);
  check('gone after a failure counts as deleted', r[0].ok === true && /whole request failed/.test(r[0].note));
  check('still present stays failed', r[1].ok === false);
}

console.log('roleCommands');
{
  const S = '/p/org-roles.mjs';
  check('deploy target needs nothing', same(lib.roleCommands({ role: 'development', deploy: true }, 'dev', S), { locked: false, allow: null, restore: null }));
  check('locked with role and branch', same(lib.roleCommands({ role: 'pipeline', deploy: false, branch: 'integration' }, 'qa', S), {
    locked: true,
    allow: `node '/p/org-roles.mjs' set 'qa' --role pipeline --deploy yes --branch 'integration'`,
    restore: `node '/p/org-roles.mjs' set 'qa' --role pipeline --deploy no --branch 'integration'` }));
  check('no saved role', same(lib.roleCommands(null, 'qa', S), {
    locked: true,
    allow: `node '/p/org-roles.mjs' set 'qa' --role research --deploy yes`,
    restore: `node '/p/org-roles.mjs' remove 'qa'` }));
}

console.log('renderPlan and renderReport');
{
  const { flows, skipped } = lib.selectVersions([...flow('Full', 50, 50), ...flow('NoActive', 50, null)], 5);
  const text = lib.renderPlan({ count: 5, flows, skipped });
  check('plan names the count', text.includes('COUNT: 5 oldest non-Active versions per flow'));
  check('plan counts flows at the limit', text.includes('AT LIMIT: 2 flows with 50 or more versions'));
  check('plan row with ranges', text.includes('Full | 50 | v50 | 5 | 1-5'));
  check('plan total', text.includes('TOTAL: 5 versions from 1 flows'));
  check('plan lists skipped', text.includes('NoActive: 50 versions'));
  const before = flow('Full', 50, 50);
  const after = before.slice(4);
  const results = [1, 2, 3, 4].map(v => ({ id: `x${v}`, version: v, name: 'Full', definitionId: '300Full', ok: true }))
    .concat([{ id: 'x5', version: 5, name: 'Full', definitionId: '300Full', ok: false, error: 'DEPENDENCY_EXISTS: z' }]);
  const report = lib.renderReport({ name: 'qa', results, dropped: [], skipped, before, after });
  check('report result line', report.includes('RESULT: 4 deleted, 1 failed in qa'));
  check('report before and after', report.includes('Full | 50 | 46'));
  check('report failure', report.includes('Full v5: DEPENDENCY_EXISTS: z'));
}

console.log('command line');
{
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const CLI = join(SCRIPTS, 'flow-version-cleanup.mjs');
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'flow-cleanup-')));
  const BIN = join(sandbox, 'bin');
  mkdirSync(BIN);
  // The fake sf logs each call and every @body file, then answers from answers.json:
  // { "<first two args>": [answer, …] } consumed in order, the last one repeating.
  // An answer is { stdout, code }; it prints a CLI warning line first.
  writeFileSync(join(BIN, 'sf'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_DIR, args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\\n');
for (const a of args) if (a.startsWith('@')) fs.appendFileSync(path.join(dir, 'bodies.log'), fs.readFileSync(a.slice(1), 'utf8') + '\\n');
const key = args.slice(0, 2).join(' ');
const list = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'))[key] || [];
const nFile = path.join(dir, key.replace(/ /g, '_') + '.n');
const n = fs.existsSync(nFile) ? Number(fs.readFileSync(nFile, 'utf8')) : 0;
fs.writeFileSync(nFile, String(n + 1));
const a = list[Math.min(n, list.length - 1)] || { stdout: '', code: 0 };
process.stdout.write(' ›   Warning: @salesforce/cli update available\\n');
process.stdout.write(typeof a.stdout === 'string' ? a.stdout : JSON.stringify(a.stdout));
process.exit(a.code || 0);
`);
  chmodSync(join(BIN, 'sf'), 0o755);

  const HOME = join(sandbox, 'home');
  const writeJson = (file, json) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(json)); };
  const ORG_ID = '00D000000000002AAA';
  writeJson(join(HOME, '.sfdx', 'me@example.com.qa.json'), { username: 'me@example.com.qa', orgId: ORG_ID, isSandbox: true });
  writeJson(join(HOME, '.sfdx', 'me@example.com.dev.json'), { username: 'me@example.com.dev', orgId: '00D000000000001AAA', isSandbox: true });
  writeJson(join(HOME, '.sfdx', 'alias.json'), { orgs: { qa: 'me@example.com.qa', dev: 'me@example.com.dev' } });

  const query = records => ({ stdout: { status: 0, result: { done: true, totalSize: records.length, records } } });
  const display = { stdout: { status: 0, result: { apiVersion: '64.0' } } };
  const batchOk = n => ({ stdout: { hasErrors: false, results: Array.from({ length: n }, () => ({ statusCode: 204, result: null })) } });

  let counter = 0;
  /** A project with roles, a canned-answer folder, and one run of the script. */
  function run(args, { roles, answers }, opts = {}) {
    const dir = join(sandbox, `s${++counter}`);
    const repo = join(dir, 'repo');
    const fake = join(dir, 'fake');
    mkdirSync(fake, { recursive: true });
    writeJson(join(repo, 'sfdx-project.json'), { packageDirectories: [{ path: 'force-app' }] });
    writeJson(join(repo, '.claude', 'hean-harness.json'), { orgs: roles });
    writeJson(join(fake, 'answers.json'), answers);
    // apply removes the plan file's folder, so each run gets its own copy in a folder it may remove
    let planDir = null;
    if (args[0] === 'apply' && opts.copyPlan !== false) {
      planDir = mkdtempSync(join(tmpdir(), 'flow-version-cleanup-'));
      copyFileSync(args[1], join(planDir, 'plan.json'));
      args = ['apply', join(planDir, 'plan.json')];
    }
    const env = { ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}`, FAKE_DIR: fake };
    delete env.SF_TARGET_ORG;
    const r = spawnSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
    const read = f => existsSync(join(fake, f)) ? readFileSync(join(fake, f), 'utf8').trim().split('\n') : [];
    return { ...r, calls: read('calls.log'), bodies: read('bodies.log'), repo, planDir };
  }
  const LOCKED = { [ORG_ID]: { alias: 'qa', username: 'me@example.com.qa', role: 'pipeline', deploy: false, branch: 'integration' } };
  const OPEN = { [ORG_ID]: { alias: 'qa', username: 'me@example.com.qa', role: 'pipeline', deploy: true, branch: 'integration' } };
  const records = [...flow('Full', 50, 50), ...flow('Small', 10, 10)];

  // plan on a locked org
  const p = run(['plan', '--org', 'QA', '--count', '3'], { roles: LOCKED, answers: { 'data query': [query(records)] } });
  check('plan exits 0', p.status === 0, p.stdout + p.stderr);
  check('plan names the org before anything else', p.stdout.startsWith(`ORG: qa (me@example.com.qa, org ${ORG_ID})`));
  check('plan queries the Tooling API on the matched org',
        p.calls[0]?.startsWith('data query --use-tooling-api --json -o me@example.com.qa -q SELECT Id, DefinitionId'));
  check('plan sends nothing', p.calls.length === 1);
  check('plan row', p.stdout.includes('Full | 50 | v50 | 3 | 1-3'));
  check('locked org is announced', p.stdout.includes('!! qa is locked for writes: saved as pipeline, agents do not write.'));
  check('allow and restore commands', p.stdout.includes(`node '${join(SCRIPTS, 'org-roles.mjs')}' set 'qa' --role pipeline --deploy yes --branch 'integration'`) &&
                                      p.stdout.includes(`node '${join(SCRIPTS, 'org-roles.mjs')}' set 'qa' --role pipeline --deploy no --branch 'integration'`));
  const planFile = p.stdout.match(/^PLAN_FILE: (.+)$/m)?.[1];
  check('plan file written', planFile && JSON.parse(readFileSync(planFile, 'utf8')).flows[0].delete.length === 3);

  // plan edge cases
  check('bad count refused before any query',
        (r => r.status === 1 && /whole number/.test(r.stdout) && r.calls.length === 0)(run(['plan', '--count', '0'], { roles: LOCKED, answers: {} })));
  check('unknown org refused', run(['plan', '--org', 'nowhere'], { roles: LOCKED, answers: {} }).stdout.includes('no org logged in on this machine matches'));
  check('nothing at the limit exits 2',
        run(['plan', '--org', 'qa'], { roles: OPEN, answers: { 'data query': [query(flow('Small', 10, 10))] } }).status === 2);
  check('partial query refused',
        (r => r.status === 1 && /partial/.test(r.stdout))(run(['plan', '--org', 'qa'],
          { roles: OPEN, answers: { 'data query': [{ stdout: { status: 0, result: { done: false, totalSize: 99, records } } }] } })));

  // a saved alias now pointing at a different org: the commands name the username
  writeJson(join(HOME, '.sfdx', 'alias.json'), { orgs: { qa: 'me@example.com.dev', dev: 'me@example.com.dev' } });
  const stale = run(['plan', '--org', 'me@example.com.qa'], { roles: LOCKED, answers: { 'data query': [query(records)] } });
  check('stale alias: allow and restore name the username',
        stale.stdout.includes(`set 'me@example.com.qa' --role pipeline --deploy yes`) &&
        stale.stdout.includes(`set 'me@example.com.qa' --role pipeline --deploy no`) && !stale.stdout.includes(`set 'qa'`), stale.stdout);
  writeJson(join(HOME, '.sfdx', 'alias.json'), { orgs: { qa: 'me@example.com.qa', dev: 'me@example.com.dev' } });

  // apply against a locked org is refused before any request
  const refused = run(['apply', planFile], { roles: LOCKED, answers: {} });
  check('apply on a locked org exits 1 and sends nothing', refused.status === 1 && refused.calls.length === 0, refused.stdout);
  check('plan folder removed after a refused apply', !existsSync(refused.planDir));
  const handMade = join(sandbox, 'by-hand');
  mkdirSync(handMade);
  copyFileSync(planFile, join(handMade, 'plan.json'));
  run(['apply', join(handMade, 'plan.json')], { roles: LOCKED, answers: {} }, { copyPlan: false });
  check('a folder not made by plan is left alone', existsSync(join(handMade, 'plan.json')));

  // apply on an open org: one version became Active, one response lost but deleted, one lock error retried
  const fresh = records.map(r => r.Id === '301Full002' ? { ...r, Status: 'Active' } : r);
  const afterIds = new Set(['301Full001', '301Full003']);
  const lockThenOk = [
    { stdout: { hasErrors: true, results: [{ statusCode: 204 }, { statusCode: 400, result: [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'busy' }] }] } },
    batchOk(1)
  ];
  const a = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(fresh), query(fresh.filter(r => !afterIds.has(r.Id)))],
    'api request': lockThenOk
  } });
  check('apply exits 0', a.status === 0, a.stdout + a.stderr);
  check('apply removes the plan file folder', !existsSync(a.planDir));
  check('API version from org display', a.calls.some(c => c.startsWith('api request rest /services/data/v64.0/tooling/composite/batch --method POST --body @')));
  check('version now Active not sent', !a.bodies.join('\n').includes('301Full002') && a.stdout.includes('Full v2: now Active'));
  check('lock error retried alone', a.calls.filter(c => c.startsWith('api request')).length === 2 &&
                                    JSON.parse(a.bodies[1]).batchRequests.length === 1);
  check('report', a.stdout.includes('RESULT: 2 deleted, 0 failed in qa') && a.stdout.includes('Full | 50 | 48'));

  // a flow that lost its Active version between plan and apply: nothing is sent for it
  const noActive = records.map(r => r.Id === '301Full050' ? { ...r, Status: 'Obsolete' } : r);
  const gone = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(noActive), query(noActive)],
    'api request': [batchOk(3)]
  } });
  check('flow without an Active version: nothing sent, listed under NOT SENT',
        gone.calls.filter(c => c.startsWith('api request')).length === 0 && gone.stdout.includes('NOT SENT') &&
        gone.stdout.includes('no longer selected'), gone.stdout);

  // a lost response: the after-query decides
  const lost = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(records), query(records.filter(r => !['301Full001', '301Full002', '301Full003'].includes(r.Id)))],
    'api request': [{ stdout: '', code: 1 }]
  } });
  check('lost response, versions gone: exit 0 with a note', lost.status === 0 && lost.stdout.includes('DELETED DESPITE AN ERROR RESPONSE'), lost.stdout);

  // a dependency error stays failed
  const dep = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(records), query(records.filter(r => r.Id !== '301Full001' && r.Id !== '301Full002'))],
    'api request': [{ stdout: { hasErrors: true, results: [{ statusCode: 204 }, { statusCode: 204 },
      { statusCode: 400, result: [{ errorCode: 'DEPENDENCY_EXISTS', message: 'referenced in a flow interview' }] }] } }]
  } });
  check('dependency error exits 3 and is listed', dep.status === 3 && dep.stdout.includes('Full v3: DEPENDENCY_EXISTS: referenced in a flow interview'));

  rmSync(dirname(planFile), { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
