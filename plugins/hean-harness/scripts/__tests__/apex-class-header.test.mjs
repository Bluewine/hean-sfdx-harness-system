#!/usr/bin/env node
/**
 * What the Apex class header check finds in class source, and what its --git-hook mode does with staged classes.
 *
 * The git cases run in throwaway repositories; no client repository is touched.
 *
 * Run: node scripts/__tests__/apex-class-header.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(SCRIPTS, 'lib', 'apex-class-header.mjs');
const { headerFindings, refusalText, notChecked } = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const P = 'force-app/main/default/classes/SampleService.cls';
const ID = 'ABC-123';
const kinds = (source, opts) => headerFindings(source, { path: P, workId: ID, ...opts }).map(f => f.kind).join(',');
const cls = (tags, declaration = 'public with sharing class SampleService {') =>
  `/**\n * Does sample work.\n *\n${tags.map(t => ` * ${t}\n`).join('')} */\n${declaration}\n}\n`;

console.log('new class');
check('@since with the work ID passes', kinds(cls([`@since 2026-10-21 ${ID}`]), { isNew: true }) === '');
check('no class comment is a since finding', kinds('public class SampleService {\n}\n', { isNew: true }) === 'since');
check('@since for another story is a since finding', kinds(cls(['@since 2026-10-21 ABC-999']), { isNew: true }) === 'since');
check('@since without a date is a since finding', kinds(cls([`@since ${ID}`]), { isNew: true }) === 'since');
check('@changes alone does not satisfy a new class', kinds(cls([`@changes 2026-10-21 ${ID}: Add it`]), { isNew: true }) === 'since');
check('"Initial setup" in any case is an initial-setup finding',
  kinds(cls([`@since 2026-10-21 ${ID} initial SETUP`]), { isNew: true }) === 'initial-setup');
check('a missing @since and "Initial setup" report both',
  kinds(cls(['@since 2026-07-28 Initial setup']), { isNew: true }) === 'since,initial-setup');
check('a work ID that only starts with the branch ID does not match',
  kinds(cls([`@since 2026-10-21 ${ID}4`]), { isNew: true }) === 'since');

console.log('changed class');
check('@changes with the work ID and text passes', kinds(cls([`@changes 2026-10-21 ${ID}: Add the check`])) === '');
check('@since from the same story satisfies an edit', kinds(cls([`@since 2026-10-21 ${ID}`])) === '');
check('an older @since with only another story changes is a changes finding',
  kinds(cls(['@since 2026-07-28 Initial setup', '@changes 2026-09-02 ABC-140: Earlier work'])) === 'changes');
check('@changes with empty text is a changes finding', kinds(cls([`@changes 2026-10-21 ${ID}:   `])) === 'changes');
check('@changes without a colon is a changes finding', kinds(cls([`@changes 2026-10-21 ${ID} Add it`])) === 'changes');
check('no class comment is a changes finding', kinds('public class SampleService {\n}\n') === 'changes');
check('a legacy author and since line with a new changes line passes',
  kinds(cls(['@author Someone', '@since 2026-07-28 Initial setup', `@changes 2026-10-21 ${ID}: Add it`])) === '');
check('"Initial setup" on an edited class is not a finding',
  kinds(cls(['@since 2026-07-28 Initial setup', `@changes 2026-10-21 ${ID}: Add it`])) === '');

console.log('too many @changes');
const many = n => Array.from({ length: n }, (_, i) => `@changes 2026-10-2${i} ABC-10${i}: Work ${i}`);
check('5 @changes lines pass', kinds(cls([...many(4), `@changes 2026-10-21 ${ID}: Add it`])) === '');
const six = headerFindings(cls([...many(5), `@changes 2026-10-21 ${ID}: Add it`]), { path: P, workId: ID });
check('6 @changes lines are a too-many finding with the count', six.length === 1 && six[0].kind === 'too-many' && six[0].count === 6, JSON.stringify(six));
check('too-many also applies to a new class',
  kinds(cls([`@since 2026-10-21 ${ID}`, ...many(6)]), { isNew: true }) === 'too-many');

console.log('declaration shapes');
check('annotations and modifiers between the comment and class',
  kinds(cls([`@changes 2026-10-21 ${ID}: Add it`], '@SuppressWarnings(\'PMD.ApexDoc\')\n@IsTest\nglobal virtual class SampleService {')) === '');
check('a // inside an annotation string does not cut the scan',
  kinds(cls([`@changes 2026-10-21 ${ID}: Add it`], "@RestResource(urlMapping='/v1//a')\nglobal with sharing class SampleService {")) === '');
check('a test class', kinds(cls([`@since 2026-10-21 ${ID}`], '@IsTest\nprivate class SampleServiceTest {'), { isNew: true }) === '');
check('an interface', kinds(cls([`@since 2026-10-21 ${ID}`], 'public interface SampleApi {'), { isNew: true }) === '');
check('an enum', kinds(cls([`@since 2026-10-21 ${ID}`], 'public enum SampleKind {'), { isNew: true }) === '');
check('a file comment before another block comment is not the class comment',
  kinds(`/** Old header @since 2026-10-21 ${ID} */\nimport_marker;\npublic class SampleService {\n}\n`, { isNew: true }) === 'since');
check('a comment with code between it and the class is not the class comment',
  kinds(`/** @since 2026-10-21 ${ID} */\nstatic Integer x;\npublic class SampleService {\n}\n`, { isNew: true }) === 'since');
check('a tag inside an inner class comment does not count',
  kinds(`public class SampleService {\n  /** @since 2026-10-21 ${ID} */\n  public class Inner {}\n}\n`, { isNew: true }) === 'since');
check('the word class inside a string or comment is skipped',
  kinds(`// the class is\n/**\n * Does work.\n * @since 2026-10-21 ${ID}\n */\n@SuppressWarnings('class')\npublic class SampleService {\n}\n`, { isNew: true }) === '');

console.log('ignored');
check('a file outside force-app is ignored', headerFindings('public class X {}', { isNew: true, workId: ID, path: 'runbook/X.cls' }).length === 0);
check('a .cls-meta.xml file is ignored', headerFindings('<x/>', { isNew: true, workId: ID, path: 'force-app/main/default/classes/X.cls-meta.xml' }).length === 0);
check('a branch without a work ID is not checked', headerFindings('public class X {}', { isNew: true, workId: null, path: P }).length === 0);
check('a nested force-app folder is checked',
  headerFindings('public class X {}', { isNew: true, workId: ID, path: 'packages/core/force-app/main/default/classes/X.cls' }).length === 1);

console.log('texts');
const findings = [
  { path: 'force-app/a/A.cls', kind: 'since' },
  { path: 'force-app/b/B.cls', kind: 'initial-setup' },
  { path: 'force-app/c/C.cls', kind: 'changes' },
  { path: 'force-app/d/D.cls', kind: 'too-many', count: 7 },
];
const text = refusalText(findings, ID);
check('refusal is exactly the full text', text ===
  '!! This commit changes Apex classes whose class comment does not follow "Class header" in apex-docstring-comments.md:\n\n' +
  `    force-app/a/A.cls: no "@since <date> ${ID}"\n` +
  '    force-app/b/B.cls: "Initial setup" in the class comment\n' +
  `    force-app/c/C.cls: no "@changes <date> ${ID}: …" line\n` +
  '    force-app/d/D.cls: 7 @changes lines (at most 5)\n\n' +
  `New class: end the class comment with "@since <YYYY-MM-DD> ${ID}". Edited class: add "@changes <YYYY-MM-DD> ${ID}: <what this story changed>" ` +
  'below the existing tags, keep at most 5 @changes lines (delete the oldest), and never change @since. Then retry the commit.', text);
check('notChecked is the exact line', notChecked('git failed') === '!! The Apex class header check did not run: git failed.');
check('notChecked drops a trailing period', notChecked('git failed.') === '!! The Apex class header check did not run: git failed.');

console.log('--git-hook');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-header-check-')));
let n = 0;
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const repo = ({ sfdx = true, branch = `work-${ID}` } = {}) => {
  const dir = join(root, `r${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  if (sfdx) writeFileSync(join(dir, 'sfdx-project.json'), '{}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  if (branch) git(dir, 'checkout', '-q', '-b', branch);
  return dir;
};
const stage = (dir, rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
  git(dir, 'add', rel);
};
const run = dir => spawnSync(process.execPath, [SCRIPT, '--git-hook'], { cwd: dir, encoding: 'utf8' });
const quiet = r => r.status === 0 && r.stderr === '';

const OLD = cls(['@author Someone', '@since 2026-07-28 Initial setup']);
const OLD_EDITED = cls(['@author Someone', '@since 2026-07-28 Initial setup', `@changes 2026-10-21 ${ID}: Add it`]);
const NEW_GOOD = cls([`@since 2026-10-21 ${ID}`]);

try {
  let d = repo();
  stage(d, P, OLD);
  let r = run(d);
  check('a new class with Initial setup exits 3', r.status === 3, `status ${r.status} ${r.stderr}`);
  check('the refusal names the path and both reasons',
    r.stderr.includes(`    ${P}: no "@since <date> ${ID}"`) && r.stderr.includes(`    ${P}: "Initial setup" in the class comment`), r.stderr);

  d = repo();
  stage(d, P, NEW_GOOD);
  r = run(d);
  check('a new class with @since exits 0 silently', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo({ branch: null });
  stage(d, P, OLD);
  git(d, 'commit', '-q', '-m', 'add class');
  git(d, 'checkout', '-q', '-b', `work-${ID}`);
  stage(d, P, OLD.replace('Does sample work.', 'Does other work.'));
  r = run(d);
  check('a modified class without @changes exits 3', r.status === 3 && r.stderr.includes(`no "@changes <date> ${ID}: …" line`), `status ${r.status} ${r.stderr}`);
  stage(d, P, OLD_EDITED);
  r = run(d);
  check('a modified class with @changes exits 0 silently', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo({ branch: null });
  stage(d, P, OLD);
  git(d, 'commit', '-q', '-m', 'add class');
  git(d, 'checkout', '-q', '-b', `work-${ID}`);
  git(d, 'mv', P, 'force-app/main/default/classes/RenamedService.cls');
  r = run(d);
  check('a renamed class counts as changed', r.status === 3 && r.stderr.includes('RenamedService.cls: no "@changes'), `status ${r.status} ${r.stderr}`);

  d = repo({ branch: null });
  stage(d, P, OLD);
  git(d, 'commit', '-q', '-m', 'add class');
  git(d, 'checkout', '-q', '-b', `work-${ID}`);
  git(d, 'rm', '-q', P);
  r = run(d);
  check('a deleted class is ignored', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, 'runbook/Script.cls', OLD);
  stage(d, 'force-app/main/default/classes/SampleService.cls-meta.xml', '<x/>\n');
  r = run(d);
  check('a class outside force-app and a meta file are ignored', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo({ branch: 'main-fix' });
  stage(d, P, OLD);
  r = run(d);
  check('a branch without a work ID is not checked', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo({ sfdx: false });
  stage(d, P, OLD);
  r = run(d);
  check('a repository without sfdx-project.json is not checked', quiet(r), `status ${r.status} ${r.stderr}`);

  d = repo();
  stage(d, P, OLD);
  writeFileSync(join(d, '.git', 'MERGE_HEAD'), `${git(d, 'rev-parse', 'HEAD').trim()}\n`);
  r = run(d);
  check('a merge in progress is skipped', quiet(r), `status ${r.status} ${r.stderr}`);

  r = run(root);
  check('outside a repository it exits 0 with the not-checked line',
    r.status === 0 && r.stderr.startsWith('!! The Apex class header check did not run: '), `status ${r.status} ${r.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
