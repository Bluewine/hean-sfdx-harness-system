#!/usr/bin/env node
/**
 * What the before-save triggering record update check finds in flow XML, and what its --git-hook mode does
 * with a staged flow.
 *
 * The git cases run in a throwaway repository; no client repository is touched and no org is called.
 *
 * Run: node scripts/__tests__/flow-before-save-update.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(SCRIPTS, 'lib', 'flow-before-save-update.mjs');
const { beforeSaveUpdateFindings, refusalText, notChecked } = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const byReference = (name, extra = '') => `
    <recordUpdates>
        <name>${name}</name>
        <inputReference>$Record</inputReference>${extra}
    </recordUpdates>`;
const assignments = `
        <inputAssignments>
            <field>Status</field>
            <value><stringValue>Open</stringValue></value>
        </inputAssignments>`;
const byFilter = (name, object = 'Account', value = '$Record.Id') => `
    <recordUpdates>
        <name>${name}</name>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value><elementReference>${value}</elementReference></value>
        </filters>
        <inputAssignments>
            <field>Status</field>
            <value><stringValue>Open</stringValue></value>
        </inputAssignments>
        <object>${object}</object>
    </recordUpdates>`;
const start = (type, object = 'Account') => `
    <start>
        <object>${object}</object>
        <triggerType>${type}</triggerType>
    </start>`;
const flow = (...parts) => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>${parts.join('')}
</Flow>
`;
const BEFORE = start('RecordBeforeSave');
const AFTER = start('RecordAfterSave');
const P = 'force-app/main/default/flows/Account_Before_Save.flow-meta.xml';

console.log('beforeSaveUpdateFindings');
let f = beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status')), null, P);
check('inputReference $Record without field assignments is a finding',
  f.length === 1 && JSON.stringify(f[0]) === JSON.stringify({ path: P, element: 'Set_Status' }), JSON.stringify(f));
f = beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status', assignments)), null, P);
check('inputReference $Record with inputAssignments is a finding', f.length === 1 && f[0].element === 'Set_Status', JSON.stringify(f));
f = beforeSaveUpdateFindings(flow(BEFORE, byFilter('Update_Same')), null, P);
check('the start object filtered by Id = $Record.Id is a finding', f.length === 1 && f[0].element === 'Update_Same', JSON.stringify(f));
check('another object filtered by Id = $Record.Id is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byFilter('Update_Contact', 'Contact')), null, P).length === 0);
check('the start object filtered by another value is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byFilter('Update_Other', 'Account', 'Get_Account.Id')), null, P).length === 0);
check('an Update Records element on a different record variable is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byReference('Update_Var').replace('$Record', 'varAccount')), null, P).length === 0);
check('an after-save flow is not a finding',
  beforeSaveUpdateFindings(flow(AFTER, byReference('Set_Status'), byFilter('Update_Same')), null, P).length === 0);
check('a flow with no Update Records element is not a finding', beforeSaveUpdateFindings(flow(BEFORE), null, P).length === 0);

const head = flow(BEFORE, byReference('Set_Status'));
check('an element unchanged from HEAD is not a finding', beforeSaveUpdateFindings(head, head, P).length === 0);
check('an element already in HEAD with a new field list is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status', assignments)), head, P).length === 0);
const connector = '\n        <connector><targetReference>New_Step</targetReference></connector>';
check('an element already in HEAD with a new connector is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status', connector)), head, P).length === 0);
check('an element already in HEAD with a new location is not a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status', '\n        <locationX>300</locationX>')),
    flow(BEFORE, byReference('Set_Status', '\n        <locationX>176</locationX>')), P).length === 0);
check('an element already in HEAD with other whitespace and line endings is not a finding',
  beforeSaveUpdateFindings(head.replace(/\n {4}/g, '\r\n  ').replace(/\n {8}/g, '\r\n\t'), head, P).length === 0);
check('an element renamed from HEAD is a finding',
  beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Priority')), head, P)[0]?.element === 'Set_Priority');
f = beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status'), byReference('Set_Priority')), head, P);
check('only the added element reports', f.length === 1 && f[0].element === 'Set_Priority', JSON.stringify(f));
f = beforeSaveUpdateFindings(flow(BEFORE, byReference('Set_Status'), byFilter('Update_Same')),
  flow(AFTER, byReference('Set_Status')), P);
check('a flow switched from after-save to before-save reports every matching element',
  f.length === 2 && f[0].element === 'Set_Status' && f[1].element === 'Update_Same', JSON.stringify(f));

console.log('refusalText and notChecked');
const text = refusalText([{ path: P, element: 'Set_Status' }, { path: P, element: 'Set_Priority' }]);
check('the refusal starts with !! and names each path and element',
  text.startsWith('!! ') && text.includes(`    ${P}: Set_Status`) && text.includes(`    ${P}: Set_Priority`), text);
check('the refusal names Assignment, $Record, after-save and the retry',
  ['Assignment element', '$Record', 'after-save flow', 'Then retry the commit.'].every(p => text.includes(p)), text);
check('notChecked drops a trailing period',
  notChecked('git failed.') === '!! The before-save triggering record update check did not run: git failed.');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-before-save-check-')));
let n = 0;
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const repo = () => {
  const dir = join(root, `r${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'sfdx-project.json'), '{}\n');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
};
const stage = (dir, rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
  git(dir, 'add', rel);
};

try {
  console.log('--git-hook');
  const run = dir => spawnSync(process.execPath, [SCRIPT, '--git-hook'], { cwd: dir, encoding: 'utf8' });
  const BAD = flow(BEFORE, byReference('Set_Status'));
  let d, r;

  d = repo();
  stage(d, P, BAD);
  r = run(d);
  check('a staged before-save Update Records on $Record exits 3', r.status === 3, `status ${r.status} ${r.stderr}`);
  check('the refusal is on stderr', r.stderr.includes(`    ${P}: Set_Status`), r.stderr);

  d = repo();
  stage(d, P, BAD);
  git(d, 'commit', '-q', '--no-verify', '-m', 'bad flow');
  writeFileSync(join(d, P), BAD.replace('<apiVersion>65.0', '<apiVersion>66.0'));
  git(d, 'add', P);
  r = run(d);
  check('an element unchanged from HEAD is not refused', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, flow(BEFORE));
  r = run(d);
  check('a before-save flow with no Update Records exits 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, flow(AFTER, byReference('Set_Status')));
  r = run(d);
  check('an after-save flow exits 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, BAD);
  git(d, 'commit', '-q', '--no-verify', '-m', 'bad flow');
  git(d, 'rm', '-q', P);
  r = run(d);
  check('a deleted flow is ignored', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, BAD);
  writeFileSync(join(d, '.git', 'MERGE_HEAD'), `${git(d, 'rev-parse', 'HEAD').trim()}\n`);
  r = run(d);
  check('a merge in progress is skipped', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  r = run(root);
  check('outside a repository it exits 0 with the not-checked line',
    r.status === 0 && r.stderr.startsWith('!! The before-save triggering record update check did not run: '), `status ${r.status} ${r.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
