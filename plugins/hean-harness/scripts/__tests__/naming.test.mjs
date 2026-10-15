#!/usr/bin/env node
/**
 * The naming answer: validation, saving, the name match, and the scan that
 * suggests an answer from a repository's existing Apex classes and LWC folders.
 *
 * Each repository is a throwaway folder holding sfdx-project.json and empty
 * class and component files. No org is called.
 *
 * Run: node scripts/__tests__/naming.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SETUP = join(dirname(SCRIPTS), 'skills', 'setup', 'scripts');
const lib = await import(join(SCRIPTS, 'lib', 'naming.mjs'));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'naming-')));
let counter = 0;
/** A repository with these class names and LWC folder names under force-app/main/default. */
function repo({ classes = [], lwc = [], pkg = 'force-app' } = {}) {
  const root = join(sandbox, `r${++counter}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: pkg, default: true }] }));
  const cls = join(root, pkg, 'main', 'default', 'classes');
  const comp = join(root, pkg, 'main', 'default', 'lwc');
  mkdirSync(cls, { recursive: true });
  mkdirSync(comp, { recursive: true });
  for (const c of classes) {
    writeFileSync(join(cls, `${c}.cls`), '');
    writeFileSync(join(cls, `${c}.cls-meta.xml`), '');
  }
  for (const l of lwc) {
    mkdirSync(join(comp, l));
    writeFileSync(join(comp, l, `${l}.js`), '');
  }
  return root;
}

try {
  console.log('validate');
  const ok = (type, a) => lib.validate(type, a) === null;
  check('apex prefix and suffix', ok('apex', { use: true, prefix: 'ABC_', suffix: '_UK' }));
  check('apex prefix only', ok('apex', { use: true, prefix: 'ABC_' }));
  check('apex suffix only', ok('apex', { use: true, suffix: '_UK' }));
  check('use no', ok('apex', { use: false }));
  check('use yes needs a token', !ok('apex', { use: true, prefix: '', suffix: '' }));
  check('apex prefix must start with a letter', !ok('apex', { use: true, prefix: '1AB_' }));
  check('apex prefix rejects __', !ok('apex', { use: true, prefix: 'AB__' }));
  check('apex prefix rejects a hyphen', !ok('apex', { use: true, prefix: 'AB-' }));
  check('apex suffix rejects a trailing _', !ok('apex', { use: true, suffix: '_UK_' }));
  check('apex prefix + suffix over 20 refused', !ok('apex', { use: true, prefix: 'ABCDEFGHIJ_', suffix: '_KLMNOPQRS' }));
  check('apex prefix + suffix of 20 allowed', ok('apex', { use: true, prefix: 'ABCDEFGHI_', suffix: '_KLMNOPQRS' }));
  check('lwc prefix lowercase', ok('lwc', { use: true, prefix: 'abc', suffix: 'Uk' }));
  check('lwc prefix rejects uppercase', !ok('lwc', { use: true, prefix: 'Abc' }));
  check('lwc prefix rejects _', !ok('lwc', { use: true, prefix: 'abc_' }));
  check('lwc suffix must start uppercase or digit', !ok('lwc', { use: true, suffix: 'uk' }));
  check('apex suffix ending in Test refused', lib.validate('apex', { use: true, suffix: '_UKTest' }) !== null);
  check('lwc suffix ending in Test refused', lib.validate('lwc', { use: true, suffix: 'UkTest' }) !== null);
  check('unknown type refused', lib.validate('aura', { use: false }) !== null);

  console.log('save and read');
  {
    const r = repo();
    check('nothing saved reads {}', JSON.stringify(lib.readNaming(r)) === '{}');
    lib.saveNaming(r, 'apex', { use: true, prefix: 'ABC_', suffix: '' });
    lib.saveNaming(r, 'lwc', { use: false });
    const n = lib.readNaming(r);
    check('apex saved', n.apex?.use === true && n.apex.prefix === 'ABC_' && n.apex.suffix === '');
    check('lwc saved', n.lwc?.use === false);
    let threw = false; try { lib.saveNaming(r, 'apex', { use: true, prefix: '1x' }); } catch { threw = true; }
    check('invalid answer is not saved', threw && lib.readNaming(r).apex.prefix === 'ABC_');
    writeFileSync(join(r, '.claude', 'hean-harness.json'), '{ not json');
    check('unreadable settings read as {}', JSON.stringify(lib.readNaming(r)) === '{}');
  }

  console.log('matchName');
  const both = { use: true, prefix: 'ABC_', suffix: '_UK' };
  check('apex both, production', lib.matchName('apex', both, 'ABC_AccountService_UK').ok);
  check('apex both, test', lib.matchName('apex', both, 'ABC_AccountService_UKTest').ok);
  const noPrefix = lib.matchName('apex', both, 'AccountService_UK');
  check('apex missing prefix refused with expected name', !noPrefix.ok && noPrefix.expected === 'ABC_AccountService_UK', JSON.stringify(noPrefix));
  const noSuffix = lib.matchName('apex', both, 'ABC_AccountServiceTest');
  check('apex missing suffix on a test refused', !noSuffix.ok && noSuffix.expected === 'ABC_AccountService_UKTest', JSON.stringify(noSuffix));
  check('apex prefix case is exact', !lib.matchName('apex', both, 'abc_AccountService_UK').ok);
  check('use no matches anything', lib.matchName('apex', { use: false }, 'Anything').ok);
  const lwcBoth = { use: true, prefix: 'abc', suffix: 'Uk' };
  check('lwc both', lib.matchName('lwc', lwcBoth, 'abcAccountPickerUk').ok);
  check('lwc test', lib.matchName('lwc', lwcBoth, 'abcAccountPickerUkTest').ok);
  const lwcBad = lib.matchName('lwc', lwcBoth, 'accountPicker');
  check('lwc missing prefix and suffix', !lwcBad.ok && lwcBad.expected === 'abcAccountPickerUk', JSON.stringify(lwcBad));
  const exp = (t, a, n) => lib.matchName(t, a, n).expected;
  check('expected: wrong-case apex prefix not doubled', exp('apex', both, 'abc_AccountService_UK') === 'ABC_AccountService_UK');
  check('expected: apex prefix without underscore not doubled', exp('apex', { use: true, prefix: 'ABC_' }, 'ABCAccountService') === 'ABC_AccountService');
  check('expected: wrong-case apex suffix not doubled', exp('apex', { use: true, prefix: 'ABC_', suffix: '_UK' }, 'ABC_AccountService_uk') === 'ABC_AccountService_UK');
  check('expected: wrong-case lwc prefix not doubled', exp('lwc', { use: true, prefix: 'abc' }, 'AbcAccountPicker') === 'abcAccountPicker');
  check('expected: prefix is not cut into a word', exp('apex', { use: true, prefix: 'AB_' }, 'Abbey_Service') === 'AB_Abbey_Service' && exp('apex', { use: true, prefix: 'AB_' }, 'Abbey') === 'AB_Abbey');
  check('expected: lwc prefix is not cut into a word', exp('lwc', { use: true, prefix: 'ab' }, 'Abort') === 'abAbort');
  const sfxOnly = { use: true, suffix: 'Uk' };
  check('lwc suffix only: expected starts lowercase', exp('lwc', sfxOnly, 'AccountPicker') === 'accountPickerUk', exp('lwc', sfxOnly, 'AccountPicker'));
  check('lwc suffix only: uppercase start refused even with the suffix', !lib.matchName('lwc', sfxOnly, 'AccountPickerUk').ok && exp('lwc', sfxOnly, 'AccountPickerUk') === 'accountPickerUk');
  check('lwc suffix only: lowercase start allowed', lib.matchName('lwc', sfxOnly, 'accountPickerUk').ok);
  check('expected: trailing _ before Test dropped', exp('apex', both, 'ABC_Foo_UK_Test') === 'ABC_Foo_UKTest', exp('apex', both, 'ABC_Foo_UK_Test'));
  const testBefore = lib.matchName('apex', both, 'ABC_AccountServiceTest_UK');
  check('apex Test before the suffix refused', !testBefore.ok && testBefore.expected === 'ABC_AccountService_UKTest' && /Test must come after the suffix/.test(testBefore.reason), JSON.stringify(testBefore));
  const lwcTestBefore = lib.matchName('lwc', lwcBoth, 'abcPickerTestUk');
  check('lwc Test before the suffix refused', !lwcTestBefore.ok && lwcTestBefore.expected === 'abcPickerUkTest', JSON.stringify(lwcTestBefore));

  console.log('suggest');
  {
    const r = repo({ classes: ['Foo_U$K', 'Bar_U$K', 'Baz_U$K'] });
    check('suggested suffix that fails validation is dropped', lib.suggest(r).apex.suffix === null, JSON.stringify(lib.suggest(r).apex));
  }
  {
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C', 'ABC_D', 'ABC_E', 'ABC_F', 'ABC_G', 'ABC_H', 'ABC_ITest', 'Other'] });
    const s = lib.suggest(r);
    check('apex prefix at 90%', s.apex.total === 10 && s.apex.prefix?.token === 'ABC_' && s.apex.prefix.count === 9, JSON.stringify(s.apex));
    check('apex no suffix', s.apex.suffix === null);
  }
  {
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'XYZ_C', 'XYZ_D', 'Q_E'] });
    check('mixed prefixes below 60% suggest none', lib.suggest(r).apex.prefix === null);
  }
  {
    const r = repo({ classes: ['ABC_Acct_UK', 'ABC_Case_UK', 'ABC_Lead_UKTest', 'ABC_Opp_UK', 'ABC_Task'] });
    const s = lib.suggest(r);
    check('apex suffix at 80% ignoring Test', s.apex.suffix?.token === '_UK' && s.apex.suffix.count === 4, JSON.stringify(s.apex));
  }
  {
    const r = repo({ lwc: ['abcAccountPicker', 'abcCaseList', 'abcLeadForm', 'other'] });
    const s = lib.suggest(r);
    check('lwc prefix at 75%', s.lwc.prefix?.token === 'abc' && s.lwc.prefix.count === 3, JSON.stringify(s.lwc));
  }
  {
    const r = repo({ lwc: ['abcAccountPickerUk', 'abcCaseListUk', 'abcLeadFormUkTest'] });
    check('lwc suffix', lib.suggest(r).lwc.suffix?.token === 'Uk');
  }
  {
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C'], pkg: 'src/core' });
    check('nested package folder scanned', lib.suggest(r).apex.prefix?.token === 'ABC_');
  }
  {
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C'] });
    const sub = join(r, 'force-app', 'main', 'default', 'classes', 'services');
    mkdirSync(sub, { recursive: true });
    for (const c of ['ABC_S1', 'ABC_S2', 'ABC_S3', 'ABC_S4', 'ABC_S5']) writeFileSync(join(sub, `${c}.cls`), '');
    check('classes in a subfolder of classes counted', lib.suggest(r).apex.total === 8, JSON.stringify(lib.suggest(r).apex));
  }
  {
    const r = repo({ classes: ['AccountService_UK', 'Contact_UK', 'Lead_UK', 'Case_UK', 'Task'] });
    const s = lib.suggest(r);
    check('apex suffix-only repository suggests suffix', s.apex.suffix?.token === '_UK' && s.apex.suffix.count === 4, JSON.stringify(s.apex));
  }
  {
    const r = repo({ lwc: ['abcPickerUK', 'abcListUK', 'abcFormUK'] });
    check('lwc all-capital suffix suggested whole', lib.suggest(r).lwc.suffix?.token === 'UK', JSON.stringify(lib.suggest(r).lwc));
  }
  {
    const r = repo({ lwc: ['abcA', 'abcB'] });
    const locked = join(r, 'force-app', 'other', 'lwc');
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    let threw = false; try { lib.suggest(r); } catch { threw = true; }
    chmodSync(locked, 0o755);
    check('unreadable lwc folder does not throw', !threw);
  }
    const tiny = repo({ lwc: ['abcList'] });
    check('suggest ignores a sample under 3 names', lib.suggest(tiny).lwc.suffix === null && lib.suggest(tiny).lwc.prefix === null);
  {
    const r = repo();
    const s = lib.suggest(r);
    check('empty repository', s.apex.total === 0 && s.apex.prefix === null && s.lwc.total === 0);
  }

  console.log('describe');
  check('describe both', lib.describe('apex', both) === 'Apex: prefix ABC_, suffix _UK');
  check('describe no', lib.describe('lwc', { use: false }) === 'LWC: no prefix or suffix');
  check('describe not asked', lib.describe('lwc', undefined) === 'LWC: not chosen');
  console.log('command line');
  {
    const CLI = join(SCRIPTS, 'naming.mjs');
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C'], lwc: ['abcList', 'abcForm', 'abcView'] });
    const run = (...args) => spawnSync('node', [CLI, ...args], { cwd: r, encoding: 'utf8' });
    const s0 = run('status');
    check('status exits 2 when nothing is saved', s0.status === 2 && s0.stdout.includes('Apex: not chosen'), s0.stdout + s0.stderr);
    const sg = run('suggest');
    check('suggest names the apex prefix', sg.status === 0 && sg.stdout.includes('SUGGEST apex prefix=ABC_'), sg.stdout);
    check('suggest names the lwc prefix', sg.stdout.includes('SUGGEST lwc prefix=abc'), sg.stdout);
    const bad = run('set', 'apex', '--use', 'yes', '--prefix', '1x');
    check('set refuses an invalid prefix', bad.status === 1 && bad.stdout.includes('ERROR:'), bad.stdout);
    check('set apex', run('set', 'apex', '--use', 'yes', '--prefix', 'ABC_').status === 0);
    check('status still 2 with lwc unanswered', run('status').status === 2);
    check('set lwc no', run('set', 'lwc', '--use', 'no').status === 0);
    const s1 = run('status');
    check('status exits 0 when both are answered', s1.status === 0 && s1.stdout.includes('Apex: prefix ABC_') && s1.stdout.includes('LWC: no prefix or suffix'), s1.stdout);
    const ex = run('expect', 'apex', 'AccountService');
    check('expect reports a mismatch with the expected name', ex.status === 3 && ex.stdout.includes('expected ABC_AccountService'), ex.stdout);
    check('expect accepts a match', run('expect', 'apex', 'ABC_AccountServiceTest').status === 0);
    const outside = spawnSync('node', [CLI, 'status'], { cwd: sandbox, encoding: 'utf8' });
    check('status outside an SFDX project exits 1', outside.status === 1, outside.stdout);
    const set = (...a) => run('set', ...a);
    const noType = set('--use', 'no');
    check('set checks the type first', noType.status === 1 && noType.stdout.includes('ERROR: usage: naming.mjs set apex|lwc'), noType.stdout);
    check('set refuses an unknown type', set('css', '--use', 'no').status === 1);
    const dup = set('apex', '--use', 'yes', '--prefix', 'A_', '--prefix', 'B_');
    check('set refuses a repeated flag', dup.status === 1 && dup.stdout.includes('ERROR: --prefix needs exactly one value'), dup.stdout);
    const dash = set('apex', '--use', 'yes', '--prefix', '--suffix', 'X');
    check('set refuses a value starting with --', dash.status === 1 && dash.stdout.includes('--prefix needs exactly one value'), dash.stdout);
    const none = set('apex', '--use', 'yes', '--prefix');
    check('set refuses a flag with no value', none.status === 1 && none.stdout.includes('--prefix needs exactly one value'), none.stdout);
    check('refused flags saved nothing', run('status').stdout.includes('Apex: prefix ABC_'));
    check('set accepts --flag=value', set('apex', '--use=yes', '--prefix=EQ_').status === 0 && run('status').stdout.includes('Apex: prefix EQ_'));
    const keep = '{ not json';
    writeFileSync(join(r, '.claude', 'hean-harness.json'), keep);
    const guarded = set('lwc', '--use', 'no');
    check('set refuses an unparseable settings file', guarded.status === 1 && guarded.stdout.includes('ERROR:') && guarded.stdout.includes('cannot be read as JSON'), guarded.stdout);
    check('unparseable settings file is unchanged', readFileSync(join(r, '.claude', 'hean-harness.json'), 'utf8') === keep);
    writeFileSync(join(r, '.claude', 'hean-harness.json'), '{ not json');
    check('status with an unreadable settings file exits 2', run('status').status === 2);
  }

  console.log('setup step');
  {
    const STEP = join(SETUP, 'install-naming.mjs');
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C'] });
    const step = (...args) => spawnSync('node', [STEP, '--repo', r, ...args], { encoding: 'utf8' });
    const ask = step('--dry-run');
    check('unanswered asks with the suggestion', ask.status === 0 && ask.stdout.includes('!! ASK — NAMING NOT CHOSEN') && ask.stdout.includes('prefix=ABC_'), ask.stdout);
    const saved = step('--naming-apex', 'use=yes,prefix=ABC_', '--naming-lwc', 'use=no');
    check('flags save both answers', saved.status === 0 && lib.readNaming(r).apex?.prefix === 'ABC_' && lib.readNaming(r).lwc?.use === false, saved.stdout + saved.stderr);
    const rerun = step('--dry-run');
    check('a rerun reuses the answer without asking', !rerun.stdout.includes('!! ASK') && rerun.stdout.includes('Apex: prefix ABC_'), rerun.stdout);
    const badFlag = step('--naming-apex', 'use=yes,prefix=1x');
    check('an invalid flag fails with the reason', badFlag.status === 1 && badFlag.stdout.includes('ERROR:'), badFlag.stdout);
    const dryBad = step('--dry-run', '--naming-apex', 'use=yes,prefix=1x');
    check('a dry run with an invalid flag fails with the reason', dryBad.status === 1 && dryBad.stdout.includes('ERROR:'), dryBad.stdout);
    const typo = step('--naming-apex', 'use=yes,sufix=_UK');
    check('an unknown spec key fails with ERROR', typo.status === 1 && typo.stdout.includes('ERROR:') && typo.stdout.includes('sufix'), typo.stdout);
    const sub = join(r, 'force-app', 'main');
    const fromSub = spawnSync('node', [STEP, '--repo', sub, '--dry-run'], { encoding: 'utf8' });
    check('the step finds sfdx-project.json above the given folder', fromSub.status === 0 && !fromSub.stdout.includes('Not an SFDX project'), fromSub.stdout);
    const dry = repo();
    spawnSync('node', [STEP, '--repo', dry, '--dry-run', '--naming-apex', 'use=no'], { encoding: 'utf8' });
    check('a dry run saves nothing', JSON.stringify(lib.readNaming(dry)) === '{}');
  }

  console.log('rules');
  {
    const RULES = join(dirname(SCRIPTS), 'assets', 'rules', 'project');
    const lwcRule = readFileSync(join(RULES, 'lwc-naming-conventions.md'), 'utf8');
    check('lwc rule says no-prefix names override checklist items 2 and 4', lwcRule.includes('overrides checklist items 2 and 4'));
    for (const [file, key] of [['apex-naming-conventions.md', 'naming.apex'], ['lwc-naming-conventions.md', 'naming.lwc']]) {
      const text = readFileSync(join(RULES, file), 'utf8');
      check(`${file} points to ${key}`, text.includes(key) && text.includes('.claude/hean-harness.json'));
      check(`${file} has no shell scan`, !text.includes('ls force-app') && !text.includes('ls -d force-app') && !text.includes('uniq -c'));
      check(`${file} no longer tells the agent to copy existing spelling`, !text.includes('spell it'));
      check(`${file} keeps its other sections`, text.includes('## Abbreviations') && text.includes('Every applicable line must pass.'));
    }
  }

} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
