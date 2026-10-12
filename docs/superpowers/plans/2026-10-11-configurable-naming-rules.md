# Configurable Naming Prefix and Suffix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a per-repository Apex and LWC naming answer (use or not, prefix, suffix), suggest it from the code, point the two naming rules to it, and refuse a new Apex class or LWC whose name does not match it.

**Architecture:** A library `scripts/lib/naming.mjs` owns the answer (read, validate, save), the Node scan that suggests it, and the name match. A command-line script `scripts/naming.mjs` exposes `status`, `suggest`, `set`, `expect`. A `PreToolUse` hook `hooks/naming-check.mjs` refuses mismatching new names on `Write` and on `sf … generate` commands. A setup step `scripts/install-naming.mjs` asks or saves during setup; `start-implementation` asks when nothing is saved. The two rule files change in one section each.

**Tech Stack:** Node.js ESM, no dependencies; plain `node` test files.

**Spec:** `docs/superpowers/specs/2026-10-11-configurable-naming-rules.md`

## Global Constraints

- Saved under key `naming` in the main checkout's `.claude/hean-harness.json`, through `readSettings` / `writeSetting` in `scripts/lib/settings.mjs`. Shape: `{ "apex": { "use": true, "prefix": "ABC_", "suffix": "_UK" }, "lwc": { "use": false } }`. A missing key or type = not asked yet.
- `use: true` requires a non-empty prefix or suffix.
- Validation (plugin rule, refused with a reason):
  - Apex prefix: `^[A-Za-z][A-Za-z0-9_]*$`, no `__`. Apex suffix: `^[A-Za-z0-9_]+$`, no `__`, not ending in `_`. Apex prefix + suffix length ≤ 20.
  - LWC prefix: `^[a-z][a-z0-9]*$`. LWC suffix: `^[A-Z0-9][A-Za-z0-9]*$`.
  - Apex class names are at most 40 characters (deploy error "Type name too long, maximum length is 40"); LWC folder rules per developer.salesforce.com "Component Folder". No Salesforce page states the Apex identifier characters; the Apex character rule above is the plugin's conservative choice, and the code comment says so.
- Suffix ends the production name; `Test` is always last: `ABC_AccountService_UK` / `ABC_AccountService_UKTest`; `abcAccountPickerUk` / `abcAccountPickerUkTest`.
- Suggestion: a prefix or suffix is suggested when at least 60% of names share it.
- The hook checks only creation of new names; existing files, edits, renames, Apex triggers and Aura are never refused. Any error allows the call.
- The scan runs in Node; no shell globbing anywhere in this feature.
- Commit subjects `@HEAN-1: Capitalised imperative summary`, ≤ 10 words and ≤ 77 characters; no attribution trailers of any kind; commit by explicit path.
- Shipped text and tests name no client project (no REWS, rewsfs, field-service).
- Skill and rule text: imperative and declarative; no `---` lines except frontmatter delimiters; files end with exactly one newline.
- Tests never call a real org and leave no process running.

## Review Focus

1. **A name with the prefix in a different case** (`abc_Account` when the prefix is `ABC_`): expected refused, since Salesforce names are case-insensitive but the rule is exact. Pinned in Task 1 (`matchName`).
2. **An LWC created by writing `lwc/<name>/__tests__/<name>.test.js` first**: the folder `lwc/<name>/` does not exist yet, so the name is checked. Pinned in Task 3.
3. **A `.cls` written outside a package folder** (for example `scripts/apex/Foo.cls` or a runbook `.apex`): never checked. Pinned in Task 3.
4. **The settings file missing or holding invalid JSON**: the hook allows; `status` exits 2. Pinned in Tasks 2 and 3.
5. **`sf lightning generate component` without `--type lwc`** (Aura is the CLI default): not checked. Pinned in Task 3.

---

### Task 1: Naming library

**Files:**
- Create: `plugins/hean-harness/scripts/lib/naming.mjs`
- Test: `plugins/hean-harness/scripts/__tests__/naming.test.mjs`

**Interfaces:**
- Consumes: `readSettings(repo)`, `writeSetting(repo, key, value)` from `scripts/lib/settings.mjs`; `packageDirectories(repoRoot)` from `scripts/lib/apex-coverage.mjs`.
- Produces:
  - `TYPES = ['apex', 'lwc']`
  - `readNaming(repo): { apex?: Answer, lwc?: Answer }` (`{}` when none or unreadable)
  - `validate(type, answer): string|null` — the refusal reason, or null
  - `saveNaming(repo, type, answer): void` — throws `Error(reason)` when `validate` fails
  - `matchName(type, answer, name): { ok: boolean, reason?: string, expected?: string }`
  - `suggest(repoRoot): { apex: Suggestion, lwc: Suggestion }` where `Suggestion = { total, prefix: {token, count}|null, suffix: {token, count}|null }`
  - `describe(type, answer): string` — one line, for reports
  - `Answer = { use: boolean, prefix?: string, suffix?: string }`

- [ ] **Step 1: Write the failing test**

Create `plugins/hean-harness/scripts/__tests__/naming.test.mjs`:

```js
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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
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

  console.log('suggest');
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
    const r = repo({ classes: ['ABC_A', 'ABC_B'], pkg: 'src/core' });
    check('nested package folder scanned', lib.suggest(r).apex.prefix?.token === 'ABC_');
  }
  {
    const r = repo();
    const s = lib.suggest(r);
    check('empty repository', s.apex.total === 0 && s.apex.prefix === null && s.lwc.total === 0);
  }

  console.log('describe');
  check('describe both', lib.describe('apex', both) === 'Apex: prefix ABC_, suffix _UK');
  check('describe no', lib.describe('lwc', { use: false }) === 'LWC: no prefix or suffix');
  check('describe not asked', lib.describe('lwc', undefined) === 'LWC: not chosen');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/naming.mjs`.

- [ ] **Step 3: Implement the library**

Create `plugins/hean-harness/scripts/lib/naming.mjs`:

```js
/**
 * The repository's naming answer for Apex classes and Lightning Web Components:
 * whether a prefix or suffix is used, and which. Saved under `naming` in the
 * main checkout's .claude/hean-harness.json, so every worktree shares it.
 *
 * The two naming rules point the agent to this answer, and the naming-check
 * hook refuses a new class or component whose name does not match it.
 *
 * Validation is this plugin's conservative rule. Salesforce limits an Apex
 * class name to 40 characters and documents LWC folder names (begins
 * lowercase; letters, digits, underscore; no hyphen, no "__", no trailing "_");
 * no Salesforce page states the Apex identifier characters.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSettings, writeSetting } from './settings.mjs';
import { packageDirectories } from './apex-coverage.mjs';

export const TYPES = ['apex', 'lwc'];
const LABEL = { apex: 'Apex', lwc: 'LWC' };
const SHARE = 0.6;
const MAX_APEX_TOKENS = 20;

/** The saved answers by type, or {} when none are saved or the file is unreadable. */
export function readNaming(repo) {
  const n = readSettings(repo).naming;
  return n && typeof n === 'object' && !Array.isArray(n) ? n : {};
}

/** Why this answer cannot be saved, or null when it can. */
export function validate(type, answer) {
  if (!TYPES.includes(type)) return `the type must be apex or lwc, not "${type}"`;
  if (!answer || typeof answer.use !== 'boolean') return 'the answer needs use: true or false';
  if (!answer.use) return null;
  const prefix = answer.prefix ?? '';
  const suffix = answer.suffix ?? '';
  if (!prefix && !suffix) return 'a prefix or a suffix is needed when use is yes';
  if (type === 'apex') {
    if (prefix && (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix) || prefix.includes('__'))) {
      return `the Apex prefix "${prefix}" must start with a letter and use only letters, digits and single underscores`;
    }
    if (suffix && (!/^[A-Za-z0-9_]+$/.test(suffix) || suffix.includes('__') || suffix.endsWith('_'))) {
      return `the Apex suffix "${suffix}" must use only letters, digits and single underscores, and not end with "_"`;
    }
    if (prefix.length + suffix.length > MAX_APEX_TOKENS) {
      return `the Apex prefix and suffix together are ${prefix.length + suffix.length} characters; keep them to ${MAX_APEX_TOKENS} so class names stay under the 40-character limit`;
    }
    return null;
  }
  if (prefix && !/^[a-z][a-z0-9]*$/.test(prefix)) {
    return `the LWC prefix "${prefix}" must start with a lowercase letter and use only lowercase letters and digits`;
  }
  if (suffix && !/^[A-Z0-9][A-Za-z0-9]*$/.test(suffix)) {
    return `the LWC suffix "${suffix}" must start with an uppercase letter or a digit and use only letters and digits`;
  }
  return null;
}

/** Saves one type's answer; throws when it is not valid. */
export function saveNaming(repo, type, answer) {
  const reason = validate(type, answer);
  if (reason) throw new Error(reason);
  const clean = answer.use ? { use: true, prefix: answer.prefix ?? '', suffix: answer.suffix ?? '' } : { use: false };
  writeSetting(repo, 'naming', { ...readNaming(repo), [type]: clean });
}

/**
 * Whether a name matches the answer. The name may end in one `Test`; the
 * suffix comes before it. Case is exact.
 */
export function matchName(type, answer, name) {
  if (!answer?.use) return { ok: true };
  const prefix = answer.prefix ?? '';
  const suffix = answer.suffix ?? '';
  const isTest = name.endsWith('Test') && name.length > 4;
  const core = isTest ? name.slice(0, -4) : name;
  const missing = [];
  if (prefix && !core.startsWith(prefix)) missing.push(`does not start with the prefix ${prefix}`);
  if (suffix && !core.endsWith(suffix)) missing.push(`does not end with the suffix ${suffix}${isTest ? ' before Test' : ''}`);
  if (!missing.length) return { ok: true };
  let middle = core;
  if (prefix && middle.startsWith(prefix)) middle = middle.slice(prefix.length);
  if (suffix && middle.endsWith(suffix)) middle = middle.slice(0, -suffix.length);
  if (type === 'lwc' && prefix) middle = middle.charAt(0).toUpperCase() + middle.slice(1);
  const expected = `${prefix}${middle}${suffix}${isTest ? 'Test' : ''}`;
  return { ok: false, reason: `${name} ${missing.join(' and ')}`, expected };
}

/** Every name of one kind under the repository's package folders. */
function names(repoRoot) {
  const apex = [];
  const lwc = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'lwc') {
          for (const c of readdirSync(p, { withFileTypes: true })) if (c.isDirectory() && !c.name.startsWith('_')) lwc.push(c.name);
          continue;
        }
        walk(p);
      } else if (e.name.endsWith('.cls') && dir.endsWith(`${'/'}classes`)) {
        apex.push(e.name.slice(0, -4));
      }
    }
  };
  for (const pkg of packageDirectories(repoRoot)) walk(join(repoRoot, pkg));
  return { apex, lwc };
}

/** The most common token and how many names carry it, or null below the share. */
function top(tokens, total) {
  const counts = new Map();
  for (const t of tokens) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = null;
  for (const [token, count] of counts) if (!best || count > best.count) best = { token, count };
  return best && total && best.count / total >= SHARE ? best : null;
}

const withoutTest = n => (n.endsWith('Test') && n.length > 4 ? n.slice(0, -4) : n);

/** The answer the repository's existing names suggest, per type. */
export function suggest(repoRoot) {
  const { apex, lwc } = names(repoRoot);
  const apexSuffix = n => {
    const core = withoutTest(n);
    const first = core.indexOf('_');
    const last = core.lastIndexOf('_');
    return first >= 0 && last > first ? core.slice(last) : null;
  };
  const lwcPrefix = n => n.match(/^[a-z][a-z0-9]*(?=[A-Z])/)?.[0] ?? null;
  const lwcSuffix = n => {
    const core = withoutTest(n);
    return lwcPrefix(core) ? core.match(/[A-Z0-9][a-z0-9]*$/)?.[0] ?? null : null;
  };
  return {
    apex: {
      total: apex.length,
      prefix: top(apex.map(n => n.match(/^[A-Za-z][A-Za-z0-9]*_/)?.[0] ?? null), apex.length),
      suffix: top(apex.map(apexSuffix), apex.length)
    },
    lwc: {
      total: lwc.length,
      prefix: top(lwc.map(lwcPrefix), lwc.length),
      suffix: top(lwc.map(lwcSuffix), lwc.length)
    }
  };
}

/** One line for reports: "Apex: prefix ABC_, suffix _UK". */
export function describe(type, answer) {
  if (!answer) return `${LABEL[type]}: not chosen`;
  if (!answer.use) return `${LABEL[type]}: no prefix or suffix`;
  const parts = [];
  if (answer.prefix) parts.push(`prefix ${answer.prefix}`);
  if (answer.suffix) parts.push(`suffix ${answer.suffix}`);
  return `${LABEL[type]}: ${parts.join(', ')}`;
}
```

Note: `lwcSuffix` on `abcAccountPicker` returns `Picker`; across components these differ, so no token reaches 60% unless a real suffix is shared.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs`
Expected: every line `pass`, `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/lib/naming.mjs plugins/hean-harness/scripts/__tests__/naming.test.mjs
git commit -m "@HEAN-1: Add the Apex and LWC naming answer library"
```

---

### Task 2: `naming.mjs` command line

**Files:**
- Create: `plugins/hean-harness/scripts/naming.mjs`
- Modify: `plugins/hean-harness/scripts/__tests__/naming.test.mjs` (add a command-line section before `} finally {`)

**Interfaces:**
- Consumes: Task 1 exports; `projectRoot(dir)` from `scripts/lib/org-roles.mjs`.
- Produces (used by Tasks 4 and 5):
  - `node naming.mjs status` — prints `describe` per type; exit 0 when both types are answered, 2 when either is not, 1 outside an SFDX project.
  - `node naming.mjs suggest` — prints per type `SUGGEST apex prefix=ABC_ suffix=_UK (prefix on 9 of 10 classes, suffix on 0 of 10)` or `SUGGEST apex none (10 classes)`; exit 0.
  - `node naming.mjs set apex|lwc --use yes|no [--prefix X] [--suffix Y]` — saves; prints `Saved` + `describe`; exit 1 with `ERROR: <reason>` when invalid.
  - `node naming.mjs expect apex|lwc <name>` — prints `OK` or `MISMATCH <reason>; expected <name>`; exit 0 match, 3 mismatch.

- [ ] **Step 1: Write the failing test**

In `naming.test.mjs`, add `import { spawnSync } from 'node:child_process';` to the imports and insert before `} finally {`:

```js
  console.log('command line');
  {
    const CLI = join(SCRIPTS, 'naming.mjs');
    const r = repo({ classes: ['ABC_A', 'ABC_B', 'ABC_C'], lwc: ['abcList', 'abcForm'] });
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
    writeFileSync(join(r, '.claude', 'hean-harness.json'), '{ not json');
    check('status with an unreadable settings file exits 2', run('status').status === 2);
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs`
Expected: the library section passes; the command-line checks FAIL (the script does not exist); exit 1.

- [ ] **Step 3: Implement the script**

Create `plugins/hean-harness/scripts/naming.mjs`:

```js
#!/usr/bin/env node
/**
 * The repository's Apex and LWC naming answer.
 *
 *   naming.mjs status                                    exit 0 both answered, 2 not, 1 not an SFDX project
 *   naming.mjs suggest                                   the answer the existing names suggest
 *   naming.mjs set apex|lwc --use yes|no [--prefix X] [--suffix Y]
 *   naming.mjs expect apex|lwc <name>                    exit 0 match, 3 mismatch
 */

import { projectRoot } from './lib/org-roles.mjs';
import { TYPES, readNaming, saveNaming, matchName, suggest, describe } from './lib/naming.mjs';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const fail = reason => { console.log(`ERROR: ${reason}`); process.exit(1); };

const root = projectRoot(process.cwd());
if (!root) fail('run this from inside an SFDX project (no sfdx-project.json found)');

const cmd = argv[0];
if (cmd === 'status') {
  const n = readNaming(root);
  for (const t of TYPES) console.log(describe(t, n[t]));
  process.exit(TYPES.every(t => n[t]) ? 0 : 2);
}

if (cmd === 'suggest') {
  const s = suggest(root);
  const unit = { apex: 'classes', lwc: 'components' };
  for (const t of TYPES) {
    const { total, prefix, suffix } = s[t];
    if (!prefix && !suffix) { console.log(`SUGGEST ${t} none (${total} ${unit[t]})`); continue; }
    const tokens = [prefix && `prefix=${prefix.token}`, suffix && `suffix=${suffix.token}`].filter(Boolean).join(' ');
    console.log(`SUGGEST ${t} ${tokens} (prefix on ${prefix?.count ?? 0} of ${total} ${unit[t]}, suffix on ${suffix?.count ?? 0} of ${total})`);
  }
  process.exit(0);
}

if (cmd === 'set') {
  const type = argv[1];
  const use = opt('--use');
  if (!['yes', 'no'].includes(use)) fail('--use takes yes or no');
  const answer = use === 'yes' ? { use: true, prefix: opt('--prefix') ?? '', suffix: opt('--suffix') ?? '' } : { use: false };
  try { saveNaming(root, type, answer); } catch (e) { fail(e.message); }
  console.log(`Saved  ${describe(type, readNaming(root)[type])}`);
  process.exit(0);
}

if (cmd === 'expect') {
  const [, type, name] = argv;
  if (!TYPES.includes(type) || !name) fail('usage: naming.mjs expect apex|lwc <name>');
  const m = matchName(type, readNaming(root)[type], name);
  if (m.ok) { console.log('OK'); process.exit(0); }
  console.log(`MISMATCH ${m.reason}; expected ${m.expected}`);
  process.exit(3);
}

fail('usage: naming.mjs status | suggest | set apex|lwc --use yes|no [--prefix X] [--suffix Y] | expect apex|lwc <name>');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs`
Expected: `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/naming.mjs plugins/hean-harness/scripts/__tests__/naming.test.mjs
git commit -m "@HEAN-1: Add the naming status, suggest, set and expect script"
```

---

### Task 3: Name check hook

**Files:**
- Create: `plugins/hean-harness/hooks/naming-check.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json` (register under `PreToolUse`)
- Test: `plugins/hean-harness/hooks/__tests__/naming-check.test.mjs`

**Interfaces:**
- Consumes: `readNaming`, `matchName` (Task 1); `projectRoot` (`scripts/lib/org-roles.mjs`); `packageDirectories` (`scripts/lib/apex-coverage.mjs`); `commandsIn` (`scripts/lib/command-line.mjs`).
- Produces: `check(input): string|null` (exported; the refusal text or null) and the hook process (stdin JSON → deny JSON on stdout, always exit 0).

- [ ] **Step 1: Write the failing test**

Create `plugins/hean-harness/hooks/__tests__/naming-check.test.mjs`:

```js
#!/usr/bin/env node
/**
 * Which new Apex classes and LWC folders the naming check refuses.
 *
 * Each case runs the hook exactly as Claude Code does, with the tool call on
 * standard input, against a throwaway SFDX project with a saved naming answer.
 *
 * Run: node hooks/__tests__/naming-check.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'naming-check.mjs');
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'naming-check-')));

function project(name, naming) {
  const root = join(sandbox, name);
  mkdirSync(join(root, 'force-app', 'main', 'default', 'classes'), { recursive: true });
  mkdirSync(join(root, 'force-app', 'main', 'default', 'lwc', 'abcExistingUk'), { recursive: true });
  writeFileSync(join(root, 'force-app', 'main', 'default', 'classes', 'LegacyThing.cls'), '');
  writeFileSync(join(root, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
  if (naming !== undefined) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'hean-harness.json'), typeof naming === 'string' ? naming : JSON.stringify({ naming }));
  }
  return root;
}
const BOTH = { apex: { use: true, prefix: 'ABC_', suffix: '_UK' }, lwc: { use: true, prefix: 'abc', suffix: 'Uk' } };
const P = project('both', BOTH);
const NO = project('no', { apex: { use: false }, lwc: { use: false } });
const NONE = project('none');
const BROKEN = project('broken', '{ not json');
const PLAIN = join(sandbox, 'plain');
mkdirSync(PLAIN);

const cls = (root, name, ext = '.cls') => join(root, 'force-app', 'main', 'default', 'classes', `${name}${ext}`);
const lwcFile = (root, name, file) => join(root, 'force-app', 'main', 'default', 'lwc', name, file);

/** The refusal text, or null when allowed. */
function refusal(input) {
  const out = execFileSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  if (!out.trim()) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}
const write = (file, cwd = P) => ({ tool_name: 'Write', tool_input: { file_path: file, content: '' }, cwd });
const bash = (command, cwd = P) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

let failures = 0;
const check = (label, got, expectDeny, ...texts) => {
  const ok = expectDeny ? got !== null && texts.every(t => got.includes(t)) : got === null;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

try {
  console.log('Apex');
  check('matching new class', refusal(write(cls(P, 'ABC_AccountService_UK'))), false);
  check('matching new test class', refusal(write(cls(P, 'ABC_AccountService_UKTest'))), false);
  check('new class without prefix', refusal(write(cls(P, 'AccountService_UK'))), true, 'ABC_AccountService_UK', 'naming.apex');
  check('new meta file without suffix', refusal(write(cls(P, 'ABC_AccountService', '.cls-meta.xml'))), true, 'ABC_AccountService_UK');
  check('prefix case is exact', refusal(write(cls(P, 'abc_AccountService_UK'))), true);
  check('existing class is never refused', refusal(write(cls(P, 'LegacyThing'))), false);
  check('a .cls outside a package folder', refusal(write(join(P, 'scripts', 'apex', 'Foo.cls'))), false);
  console.log('LWC');
  check('new matching component', refusal(write(lwcFile(P, 'abcAccountPickerUk', 'abcAccountPickerUk.js'))), false);
  check('new component without prefix', refusal(write(lwcFile(P, 'accountPicker', 'accountPicker.js'))), true, 'abcAccountPickerUk', 'naming.lwc');
  check('new component created through its test file', refusal(write(lwcFile(P, 'accountPicker', '__tests__/accountPicker.test.js'))), true);
  check('file in an existing component', refusal(write(lwcFile(P, 'abcExistingUk', 'helper.js'))), false);
  console.log('Commands');
  check('sf apex generate class, wrong name', refusal(bash('sf apex generate class --name AccountService --output-dir force-app/main/default/classes')), true, 'ABC_AccountService_UK');
  check('sf apex generate class -n, right name', refusal(bash('sf apex generate class -n ABC_AccountService_UK')), false);
  check('sfdx force:apex:class:create, wrong name', refusal(bash('sfdx force:apex:class:create -n AccountService')), true);
  check('sf lightning generate component --type lwc, wrong name', refusal(bash('sf lightning generate component --name accountPicker --type lwc')), true, 'abcAccountPickerUk');
  check('sf lightning generate component without --type (Aura default)', refusal(bash('sf lightning generate component --name accountPicker')), false);
  check('unrelated command', refusal(bash('ls force-app')), false);
  console.log('No check');
  check('use no', refusal(write(cls(NO, 'Anything'))), false);
  check('nothing saved', refusal(write(cls(NONE, 'Anything'))), false);
  check('unreadable settings', refusal(write(cls(BROKEN, 'Anything'))), false);
  check('outside an SFDX project', refusal(write(join(PLAIN, 'classes', 'Foo.cls'), PLAIN)), false);
  check('bad input JSON', refusal('not json'), false);
  check('another tool', refusal({ tool_name: 'Read', tool_input: { file_path: cls(P, 'Foo') }, cwd: P }), false);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/hooks/__tests__/naming-check.test.mjs`
Expected: FAIL (the hook file does not exist; `execFileSync` throws). Exit non-zero.

- [ ] **Step 3: Implement the hook**

Create `plugins/hean-harness/hooks/naming-check.mjs`:

```js
#!/usr/bin/env node
/**
 * Refuses a new Apex class or Lightning Web Component whose name does not
 * match the repository's saved naming answer (naming.apex / naming.lwc in the
 * main checkout's .claude/hean-harness.json).
 *
 * Checked: a Write of a .cls or .cls-meta.xml file that does not exist yet in
 * a package folder's classes folder; a Write into a package folder's
 * lwc/<name>/ when that folder does not exist yet; `sf apex generate class`
 * and `sf lightning generate component --type lwc` (and their sfdx aliases).
 * Never checked: existing files, edits, renames, triggers, Aura.
 *
 * Any error allows the call: this hook never blocks work it cannot read.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { projectRoot } from '../scripts/lib/org-roles.mjs';
import { packageDirectories } from '../scripts/lib/apex-coverage.mjs';
import { readNaming, matchName } from '../scripts/lib/naming.mjs';
import { commandsIn } from '../scripts/lib/command-line.mjs';

const refusalText = (type, name, m) => {
  const key = `naming.${type}`;
  const label = type === 'apex' ? 'Apex class' : 'Lightning Web Component';
  return `This ${label} name does not match the project's saved naming answer: ${m.reason}.\n` +
         `Expected: ${m.expected} (a test name adds Test at the end).\n` +
         `The answer is saved in .claude/hean-harness.json under ${key}. Rename to the expected form; ` +
         `to change the answer, run naming.mjs set ${type} as the naming rule describes.`;
};

/** The new Apex class or LWC name a Write creates, or null. */
function nameFromWrite(file, root) {
  const rel = relative(root, file);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(sep);
  const inPackage = packageDirectories(root).some(p => rel === p || rel.startsWith(p.replace(/\/+$/, '') + sep));
  if (!inPackage) return null;
  const base = parts[parts.length - 1];
  const apex = base.match(/^(.+)\.cls(-meta\.xml)?$/);
  if (apex && parts[parts.length - 2] === 'classes') {
    return existsSync(file) ? null : { type: 'apex', name: apex[1] };
  }
  const i = parts.lastIndexOf('lwc');
  if (i >= 0 && parts.length > i + 2) {
    const folder = join(root, ...parts.slice(0, i + 2));
    return existsSync(folder) ? null : { type: 'lwc', name: parts[i + 1] };
  }
  return null;
}

const flag = (args, names) => {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) return args[i + 1];
    for (const n of names) if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
  }
  return undefined;
};

/** The names an sf / sfdx generate command creates. */
function namesFromCommand(command, cwd) {
  const out = [];
  for (const { words, dir } of commandsIn(command, cwd)) {
    if (!['sf', 'sfdx'].includes(words[0])) continue;
    const topic = [];
    let i = 1;
    for (; i < words.length && !words[i].startsWith('-'); i++) topic.push(...words[i].split(':'));
    const t = topic.join(' ');
    const args = words.slice(i);
    const name = flag(args, ['--name', '-n', '--classname', '--componentname']);
    if (!name) continue;
    if (t === 'apex generate class' || t === 'force apex class create') out.push({ type: 'apex', name, dir: dir ?? cwd });
    const type = flag(args, ['--type']);
    if ((t === 'lightning generate component' || t === 'force lightning component create') && type === 'lwc') {
      out.push({ type: 'lwc', name, dir: dir ?? cwd });
    }
  }
  return out;
}

/** The refusal text for this tool call, or null. */
export function check(input) {
  const cwd = input?.cwd || process.cwd();
  let targets = [];
  if (input?.tool_name === 'Write' && input.tool_input?.file_path) {
    const file = input.tool_input.file_path;
    const root = projectRoot(dirname(file));
    const t = root && nameFromWrite(file, root);
    if (t) targets.push({ ...t, root });
  } else if (input?.tool_name === 'Bash' && input.tool_input?.command) {
    targets = namesFromCommand(input.tool_input.command, cwd)
      .map(t => ({ ...t, root: projectRoot(t.dir) })).filter(t => t.root);
  }
  for (const t of targets) {
    const answer = readNaming(t.root)[t.type];
    const m = matchName(t.type, answer, t.name);
    if (!m.ok) return refusalText(t.type, t.name, m);
  }
  return null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('naming-check.mjs');
if (isMain) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const reason = check(input);
    if (reason) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
      }));
    }
  } catch { /* fail open */ }
  process.exit(0);
}
```

In `plugins/hean-harness/hooks/hooks.json`, under `"PreToolUse"`:
- append to the existing `"matcher": "Bash"` group's `hooks` array:
  `{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/naming-check.mjs\"", "timeout": 10 }`
- add a new group `{ "matcher": "Write", "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/naming-check.mjs\"", "timeout": 10 } ] }`.
Keep the file valid JSON (check with `node -e "JSON.parse(require('fs').readFileSync('plugins/hean-harness/hooks/hooks.json','utf8'))"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/hooks/__tests__/naming-check.test.mjs`
Expected: every line `pass`, `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/hooks/naming-check.mjs plugins/hean-harness/hooks/__tests__/naming-check.test.mjs plugins/hean-harness/hooks/hooks.json
git commit -m "@HEAN-1: Refuse new Apex and LWC names off the saved answer"
```

---

### Task 4: Rules, developer agent, setup and start-implementation

**Files:**
- Modify: `plugins/hean-harness/assets/rules/project/apex-naming-conventions.md` (the section "## Find the project's prefix first", lines 10-24, only)
- Modify: `plugins/hean-harness/assets/rules/project/lwc-naming-conventions.md` (the section "## Find the project's prefix first", lines 13-26, only)
- Modify: `plugins/hean-harness/agents/developer.md` (Investigation_Protocol step 1 and the Constraints list)
- Create: `plugins/hean-harness/scripts/install-naming.mjs`
- Modify: `plugins/hean-harness/scripts/setup.mjs` (STEPS and flag pass-through)
- Modify: `plugins/hean-harness/skills/setup/SKILL.md` (step 2 ask, step 3 flags)
- Modify: `plugins/hean-harness/skills/start-implementation/SKILL.md` (new step after the dev-mode step)
- Modify: `plugins/hean-harness/scripts/doctor.mjs` (a "Naming" block after "Implementation preference")
- Test: `plugins/hean-harness/scripts/__tests__/naming.test.mjs` (install-naming and rule text sections)

**Interfaces:**
- Consumes: `naming.mjs` (Task 2) commands; Task 1 `readNaming`, `saveNaming`, `describe`, `suggest`, `TYPES`.
- Produces: setup flags `--naming-apex <spec>` and `--naming-lwc <spec>`, where `<spec>` is `use=no` or `use=yes,prefix=X,suffix=Y` (either token may be omitted); setup preview line `!! ASK — NAMING NOT CHOSEN`.

- [ ] **Step 1: Write the failing tests**

In `naming.test.mjs`, insert before `} finally {`:

```js
  console.log('setup step');
  {
    const STEP = join(SCRIPTS, 'install-naming.mjs');
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
    const dry = repo();
    spawnSync('node', [STEP, '--repo', dry, '--dry-run', '--naming-apex', 'use=no'], { encoding: 'utf8' });
    check('a dry run saves nothing', JSON.stringify(lib.readNaming(dry)) === '{}');
  }

  console.log('rules');
  {
    const { readFileSync } = await import('node:fs');
    const RULES = join(dirname(SCRIPTS), 'assets', 'rules', 'project');
    for (const [file, key] of [['apex-naming-conventions.md', 'naming.apex'], ['lwc-naming-conventions.md', 'naming.lwc']]) {
      const text = readFileSync(join(RULES, file), 'utf8');
      check(`${file} points to ${key}`, text.includes(key) && text.includes('.claude/hean-harness.json'));
      check(`${file} has no shell scan`, !text.includes('ls force-app') && !text.includes('ls -d force-app') && !text.includes('uniq -c'));
      check(`${file} keeps its other sections`, text.includes('## Abbreviations') && text.includes('Every applicable line must pass.'));
    }
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs`
Expected: the setup-step checks FAIL (the script does not exist) and the rules checks FAIL (the scan is still there); exit 1.

- [ ] **Step 3: Replace the one section in each rule**

In `apex-naming-conventions.md`, replace lines 10-24 (from `## Find the project's prefix first` up to, not including, `## Character limit`) with:

```markdown
## The project's prefix and suffix

The project saves its Apex naming answer in `.claude/hean-harness.json` under `naming.apex`, in the
repository's main checkout. Read it before naming a class. Never scan existing class names for a
prefix.

- `use: true`: `{PREFIX}` is the saved `prefix` and `{SUFFIX}` the saved `suffix`; either may be
  empty. A production class is `{PREFIX}<PascalCaseName>{SUFFIX}`, for example `ABC_AccountService_UK`
  for prefix `ABC_` and suffix `_UK`. A test class is the production class name plus `Test`, always
  last: `ABC_AccountService_UKTest`.
- Every formula and rule below that names `{PREFIX}` also ends the production name with `{SUFFIX}`.
  `{SUFFIX}` is exempt from "no underscores inside the name part".
- `use: false`, or no `naming.apex` saved: the project uses no prefix or suffix. Drop `{PREFIX}` from
  every formula below and read the examples' `ABC_` as absent.
- A new class whose name does not match the saved answer is refused when the file is created. Rename
  it to the expected form the refusal gives.
```

In `lwc-naming-conventions.md`, replace lines 13-26 (from `## Find the project's prefix first` up to, not including, `## Length`) with:

```markdown
## The project's prefix and suffix

The project saves its LWC naming answer in `.claude/hean-harness.json` under `naming.lwc`, in the
repository's main checkout. Read it before naming a component. Never scan existing component names
for a prefix.

- `use: true`: `{prefix}` is the saved `prefix` (lowercase) and `{Suffix}` the saved `suffix`; either
  may be empty. A component is `{prefix}<PascalCaseDescriptor>{Suffix}`, for example
  `abcAccountPickerUk` for prefix `abc` and suffix `Uk`. A test component is the component name plus
  `Test`, always last: `abcAccountPickerUkTest`.
- Every formula and rule below that names `{prefix}` also ends the component name with `{Suffix}`.
- `use: false`, or no `naming.lwc` saved: the project uses no prefix or suffix. Drop `{prefix}` from
  every formula below and read the examples' `abc` as absent.
- A new component whose name does not match the saved answer is refused when its folder is created.
  Rename it to the expected form the refusal gives.
```

Change nothing else in either file.

- [ ] **Step 4: Developer agent**

In `plugins/hean-harness/agents/developer.md`:
- Investigation_Protocol step 1, the line `- LWC (new or existing): \`@.claude/rules/lwc-conventions.md\` + \`@.claude/rules/slds-responsive-grid.md\`` becomes
  `- LWC (new or existing): \`@.claude/rules/lwc-conventions.md\` + \`@.claude/rules/lwc-naming-conventions.md\` + \`@.claude/rules/slds-responsive-grid.md\``.
- In `<Constraints>`, after the "Rule files are mandatory" bullet, add:
  `- **Saved naming answer**: The prefix and suffix saved under \`naming\` in \`.claude/hean-harness.json\` decide every new Apex class and LWC name over any pattern found in the code. A name the naming check refuses is renamed to the expected form; never work around the refusal.`

- [ ] **Step 5: Setup step**

Create `plugins/hean-harness/scripts/install-naming.mjs`:

```js
#!/usr/bin/env node
/**
 * Setup step: the repository's Apex and LWC naming answer.
 *
 * With --naming-apex / --naming-lwc (use=no, or use=yes,prefix=X,suffix=Y) it
 * saves the answer. A saved answer is reused. When a type has no answer, it
 * prints "!! ASK — NAMING NOT CHOSEN" with the suggestion the existing names
 * give, so the setup skill can ask.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TYPES, readNaming, saveNaming, describe, suggest } from './lib/naming.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

function parseSpec(spec) {
  const fields = Object.fromEntries(String(spec).split(',').map(p => p.split('=')).map(([k, v = '']) => [k.trim(), v.trim()]));
  if (!['yes', 'no'].includes(fields.use)) throw new Error(`use must be yes or no in "${spec}"`);
  return fields.use === 'yes' ? { use: true, prefix: fields.prefix ?? '', suffix: fields.suffix ?? '' } : { use: false };
}

function main() {
  const start = repoArg >= 0 ? argv[repoArg + 1] : process.cwd();
  let repo;
  try {
    repo = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { repo = start; }
  if (!existsSync(join(repo, 'sfdx-project.json'))) { log('Not an SFDX project; no naming answer to save.'); return; }

  for (const type of TYPES) {
    const i = argv.indexOf(`--naming-${type}`);
    if (i < 0) continue;
    let answer;
    try { answer = parseSpec(argv[i + 1]); } catch (e) { log(`ERROR: ${e.message}`); process.exit(1); }
    if (dryRun) { log(`Would save  ${describe(type, answer)}`); continue; }
    try { saveNaming(repo, type, answer); } catch (e) { log(`ERROR: ${e.message}`); process.exit(1); }
    log(`Saved  ${describe(type, answer)}`);
  }

  const saved = readNaming(repo);
  const missing = TYPES.filter(t => !saved[t]);
  for (const t of TYPES) if (saved[t]) log(describe(t, saved[t]));
  if (!missing.length) return;
  const s = suggest(repo);
  log('!! ASK — NAMING NOT CHOSEN for this repository.');
  for (const t of missing) {
    const { prefix, suffix, total } = s[t];
    const tokens = [prefix && `prefix=${prefix.token}`, suffix && `suffix=${suffix.token}`].filter(Boolean).join(',');
    log(`!! ${t}: suggested ${tokens ? `use=yes,${tokens}` : 'use=no'} (from ${total} existing names). ` +
        `Run setup with --naming-${t} use=no or --naming-${t} use=yes,prefix=X,suffix=Y.`);
  }
}

main();
```

In `plugins/hean-harness/scripts/setup.mjs`:
- after the `--auto-update` pass-through lines, add:
  ```js
  for (const f of ['--naming-apex', '--naming-lwc']) {
    const i = argv.indexOf(f);
    if (i >= 0) optIns.push(f, argv[i + 1]);
  }
  ```
- add to `STEPS`, after `{ name: 'Commit format', … }`:
  `{ name: 'Naming',        script: 'install-naming.mjs',      wantsRepo: true },`

In `plugins/hean-harness/skills/setup/SKILL.md`, step 2, after the auto-update paragraph, add:

```markdown
   When the output has a line starting `!! ASK — NAMING NOT CHOSEN`, ask in one `AskUserQuestion`
   call, one question per type the following `!! apex:` / `!! lwc:` lines name: the suggested answer
   as the first option, "No prefix or suffix", and a typed answer (prefix, suffix, or both). Ask only
   then. A saved answer is reused, and `naming.mjs set` changes it later.
```

and in step 3's command, add `[--naming-apex <spec>] [--naming-lwc <spec>]`, with one sentence: `<spec>` is `use=no` or `use=yes,prefix=X,suffix=Y`, leaving out an empty token.

- [ ] **Step 6: start-implementation**

In `plugins/hean-harness/skills/start-implementation/SKILL.md`, add step 3 after step 2:

```markdown
3. In an SFDX project (a `sfdx-project.json` at the repository root), check the naming answer:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" status
   ```

   - **Exit 0:** say nothing.
   - **Exit 2:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" suggest`, then ask one
     `AskUserQuestion` call with one question per unanswered type: the suggested answer as the first
     option, "No prefix or suffix", and a typed answer. Save each answer with
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" set apex|lwc --use yes|no [--prefix X] [--suffix Y]`
     and report the `Saved` lines.
   - **Exit 1 (not an SFDX project):** skip this step.
```

and add to `## Rules`: `- Never ask the naming question when \`naming.mjs status\` exits 0.`

- [ ] **Step 7: Doctor**

In `plugins/hean-harness/scripts/doctor.mjs`, add `import { TYPES, readNaming, describe } from './lib/naming.mjs';` and, right after the "Implementation preference" block (`log('');` that follows it), add:

```js
  const namingRepo = currentRepo() ?? repoRoot();
  if (namingRepo && existsSync(join(namingRepo, 'sfdx-project.json'))) {
    log('Naming');
    const n = readNaming(namingRepo);
    for (const t of TYPES) log(`  ${describe(t, n[t])}`);
    if (TYPES.some(t => !n[t])) log('  asked at the next implementation or setup');
    log('');
  }
```

(`existsSync`, `join`, `currentRepo` and `repoRoot` are already used in `doctor.mjs`; import `existsSync`/`join` if a lint of the file shows them missing.)

- [ ] **Step 8: Run the tests**

Run: `node plugins/hean-harness/scripts/__tests__/naming.test.mjs` → `all passed`.
Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs` (about 3-4 minutes, 600000 ms timeout) → exit 0. The new Naming step must not fail setup there: with no flags it prints either "Not an SFDX project" or the `!! ASK` lines, and exits 0.
Text checks: `grep -c '^---$'` on both rule files prints `2`; `grep -n -i -E 'rews|rewsfs|field-service'` on every file changed in this task prints nothing.

- [ ] **Step 9: Commit**

```bash
git add plugins/hean-harness/assets/rules/project/apex-naming-conventions.md plugins/hean-harness/assets/rules/project/lwc-naming-conventions.md plugins/hean-harness/agents/developer.md plugins/hean-harness/scripts/install-naming.mjs plugins/hean-harness/scripts/setup.mjs plugins/hean-harness/skills/setup/SKILL.md plugins/hean-harness/skills/start-implementation/SKILL.md plugins/hean-harness/scripts/doctor.mjs plugins/hean-harness/scripts/__tests__/naming.test.mjs
git commit -m "@HEAN-1: Ask and use the saved naming answer in rules and setup"
```

- [ ] **Step 10: Full loop**

Run every test file once (in the background or with a timeout above 600000 ms; check `pgrep -fl test.mjs` first; never two loops at once):
`for t in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do node "$t" > /dev/null 2>&1 && echo "ok $t" || echo "FAILED: $t"; done`
Expected: no `FAILED:` line. Then `ps -axo pid,command | grep -E "check-environment|ego-browser nodejs|test\.mjs|setup\.mjs" | grep -v grep` prints nothing. Never commit `assets/rules/user/zz-test-dropped-rule.md`.

Wiki coverage (repository rule `.claude/rules/wiki-coverage-tracking.md`): the new hook `naming-check.mjs` needs a row in `docs/wiki-coverage.md`; the controller asks the user whether it gets a Hooks wiki entry and adds the row with the answer.
