#!/usr/bin/env node
/**
 * What the Collection Filter condition check finds in flow XML, and what its --git-hook mode does with a staged flow.
 *
 * The git cases run in a throwaway repository; no client repository is touched.
 *
 * Run: node scripts/__tests__/flow-collection-filter.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(SCRIPTS, 'lib', 'flow-collection-filter.mjs');
const { filterFindings, refusalText, notChecked } = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const cond = (left, value = 'Active') => `
    <conditions>
        <leftValueReference>${left}</leftValueReference>
        <operator>EqualTo</operator>
        <rightValue><stringValue>${value}</stringValue></rightValue>
    </conditions>`;

const processor = ({ name = 'Sample_Filter', type = 'FilterCollectionProcessor', assign = `currentItem_${name}`, body = '' }) => `
<collectionProcessors>
    <name>${name}</name>
    <elementSubtype>${type}</elementSubtype>${assign === null ? '' : `
    <assignNextValueToReference>${assign}</assignNextValueToReference>`}
    <collectionProcessorType>${type}</collectionProcessorType>
    <collectionReference>Sample_Records</collectionReference>
    <conditionLogic>or</conditionLogic>${body}
</collectionProcessors>`;

const flow = (...parts) => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>${parts.join('')}
</Flow>
`;

console.log('filterFindings');
const P = 'force-app/main/default/flows/Sample.flow-meta.xml';

check('plain item-field conditions pass',
  filterFindings(flow(processor({ body: cond('currentItem_Sample_Filter.Status__c') + cond('currentItem_Sample_Filter.Type__c') })), P).length === 0);

const bad = filterFindings(flow(processor({ body: cond('UseActiveOnly', 'false') + cond('currentItem_Sample_Filter.Status__c') })), P);
check('a flow-resource left side is one finding', bad.length === 1);
check('the finding carries path, element, left and prefix',
  JSON.stringify(bad[0]) === JSON.stringify({ path: P, element: 'Sample_Filter', left: 'UseActiveOnly', prefix: 'currentItem_Sample_Filter' }),
  JSON.stringify(bad[0]));

check('a prefix that only starts with V (no dot) is a finding',
  filterFindings(flow(processor({ body: cond('currentItem_Sample_Filter2.Status__c') })), P).length === 1);

check('a filter over plain values may use the current item itself as the left side',
  filterFindings(flow(processor({ body: cond('currentItem_Sample_Filter') })), P).length === 0);
check('the current item itself next to a field condition passes',
  filterFindings(flow(processor({ body: cond('currentItem_Sample_Filter') + cond('currentItem_Sample_Filter.Status__c') })), P).length === 0);

check('formula form (no conditions) passes',
  filterFindings(flow(processor({ body: '\n    <formula>{!currentItem_Sample_Filter.Status__c} = "Active"</formula>' })), P).length === 0);

const two = filterFindings(flow(
  processor({ name: 'Good_Filter', body: cond('currentItem_Good_Filter.Status__c') }),
  processor({ name: 'Bad_Filter', body: cond('SomeVariable') + cond('Other.Field') })), P);
check('two filters in one file, one bad: only the bad one reports',
  two.length === 2 && two.every(f => f.element === 'Bad_Filter' && f.prefix === 'currentItem_Bad_Filter'), JSON.stringify(two));

check('a SortCollectionProcessor is ignored',
  filterFindings(flow(processor({ type: 'SortCollectionProcessor', assign: null, body: cond('SomeVariable') })), P).length === 0);

const noAssign = filterFindings(flow(processor({ assign: null, body: cond('currentItem_Sample_Filter.Status__c') })), P);
check('a filter with no assignNextValueToReference reports each condition with an empty prefix',
  noAssign.length === 1 && noAssign[0].prefix === '', JSON.stringify(noAssign));

check('a flow with no collection processors passes', filterFindings(flow(), P).length === 0);

console.log('texts');
const text = refusalText(bad);
check('refusal is exactly the full text for one finding', text ===
  '!! This commit records Collection Filter conditions Flow Builder cannot display. The flow deploys and runs, but Flow Builder marks each one invalid:\n\n' +
  `    ${P}: Sample_Filter: left side \`UseActiveOnly\`, expected \`currentItem_Sample_Filter\` or \`currentItem_Sample_Filter.<Field>\`\n\n` +
  "In a FilterCollectionProcessor, every condition's left side must be the current item or one of its fields. " +
  'To combine a flow variable, formula or constant with item fields, set <conditionLogic>formula_evaluates_to_true</conditionLogic>, ' +
  'write the test in <formula> with {!<currentItem>.<Field>} (TEXT() around a picklist field), and remove the <conditions> elements. ' +
  'Then retry the commit.', text);
check('notChecked is the exact line', notChecked('git failed') === '!! The Collection Filter check did not run: git failed.');
check('notChecked drops a trailing period', notChecked('git failed.') === '!! The Collection Filter check did not run: git failed.');

console.log('--git-hook');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-filter-check-')));
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
const run = dir => spawnSync(process.execPath, [SCRIPT, '--git-hook'], { cwd: dir, encoding: 'utf8' });

const BAD = flow(processor({ body: cond('UseActiveOnly', 'false') }));
const GOOD = flow(processor({ body: cond('currentItem_Sample_Filter.Status__c') }));

try {
  let d = repo();
  stage(d, P, BAD);
  let r = run(d);
  check('bad staged flow exits 3', r.status === 3, `status ${r.status} ${r.stderr}`);
  check('the refusal is on stderr', r.stderr.includes(`    ${P}: Sample_Filter: left side \`UseActiveOnly\``), r.stderr);

  d = repo();
  stage(d, P, GOOD);
  r = run(d);
  check('good staged flow exits 0 silently', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

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

  d = repo();
  stage(d, 'notes/Sample.flow-meta.xml.txt', BAD);
  r = run(d);
  check('a file that does not end .flow-meta.xml is ignored', r.status === 0 && r.stderr === '', `status ${r.status} ${r.stderr}`);

  r = run(root);
  check('outside a repository it exits 0 with the not-checked line',
    r.status === 0 && r.stderr.startsWith('!! The Collection Filter check did not run: '), `status ${r.status} ${r.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
