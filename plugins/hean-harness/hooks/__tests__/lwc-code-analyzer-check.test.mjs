#!/usr/bin/env node
/**
 * What the LWC code analyzer check reports after a write, and what its
 * --check mode records.
 *
 * No real analyzer runs. PATH starts with a fake `sf` that answers
 * `plugins --json`, `code-analyzer rules` and `code-analyzer run`, writes JSON
 * to the -f path as the real analyzer does, and logs every call. Each
 * repository is a throwaway git repository in a temp sandbox, and the record
 * and session files live in a throwaway CLAUDE_CONFIG_DIR.
 *
 * Run: node hooks/__tests__/lwc-code-analyzer-check.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'lwc-code-analyzer-check.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'lwc-code-analyzer-check-')));
const BIN = join(sandbox, 'bin');
const CALLS = join(sandbox, 'calls.log');
mkdirSync(BIN);
// FAKE_SF_MODE: unset = JSON like the real analyzer; 'broken' = one violation attached to no file.
const FAKE_SF = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const all = n => args.flatMap((a, i) => a === n ? [args[i + 1]] : []);
const arg = n => all(n)[0];
fs.appendFileSync(process.env.FAKE_SF_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const mode = process.env.FAKE_SF_MODE;
if (args[0] === 'plugins') {
  console.log(JSON.stringify([{ name: '@salesforce/plugin-code-analyzer', version: '5.13.0' }]));
  process.exit(0);
}
if (args[0] !== 'code-analyzer') { console.error('unexpected ' + args.join(' ')); process.exit(1); }
const slds = arg('-r') === 'eslint:slds';
const ofKind = t => slds ? /\\.(html|css)$/.test(t) : /\\.js$/.test(t);
const targets = all('-t');
if (args[1] === 'rules') {
  const rules = !targets.some(ofKind) ? [] : slds
    ? [{ name: '@salesforce-ux/slds/no-slds-var-without-fallback', engine: 'eslint', severity: 3 }]
    : [{ name: '@lwc/lwc/no-async-operation', engine: 'eslint', severity: 3 }];
  fs.writeFileSync(arg('-f'), JSON.stringify({ rules }));
  process.exit(0);
}
const checks = slds
  ? [['var(--slds-g-color-surface-1)', '@salesforce-ux/slds/no-slds-var-without-fallback', 3, 'Add a fallback value.'],
     ['#ffffff', '@salesforce-ux/slds/no-hardcoded-values-slds2', 4, 'Use a styling hook.']]
  : [['setTimeout', '@lwc/lwc/no-async-operation', 3, 'Restricted async operation "setTimeout"'],
     ['\\u00a0', 'no-irregular-whitespace', 2, 'Irregular whitespace not allowed.']];
let violations = [];
if (mode === 'broken') {
  violations = [{ rule: 'UninstantiableEngineError', engine: 'eslint', severity: 1, message: 'Failed to instantiate engine eslint: config threw',
    locations: [{ comment: 'Undefined Code Location' }] }];
} else {
  for (const t of targets.filter(ofKind)) {
    const lines = fs.readFileSync(path.resolve(t), 'utf8').split('\\n');
    lines.forEach((l, i) => { for (const [word, rule, severity, message] of checks) {
      if (l.includes(word)) violations.push({ rule, engine: 'eslint', severity, message,
        locations: [{ file: path.relative(process.cwd(), path.resolve(t)), startLine: i + 1, startColumn: l.indexOf(word) + 1 }] });
    } });
  }
}
fs.writeFileSync(arg('-f'), JSON.stringify({ runDir: process.cwd(), violationCounts: { total: violations.length }, violations }));
process.exit(violations.some(v => v.severity <= Number(arg('-s') ?? 5)) ? 1 : 0);
`;
writeFileSync(join(BIN, 'sf'), FAKE_SF);
chmodSync(join(BIN, 'sf'), 0o755);
const HOME = join(sandbox, 'home');
mkdirSync(HOME);
Object.assign(process.env, { HOME, CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${BIN}:${process.env.PATH}`, FAKE_SF_LOG: CALLS });
delete process.env.FAKE_SF_MODE;
delete process.env.HEAN_LWC_ANALYZER_DEADLINE_MS;
const env = { ...process.env };
delete env.CLAUDE_CODE_CHILD_SESSION;

const { stateDirFor, WORK_ORDER, PRE_EXISTING_HEADING } = await import(join(dirname(HOOKS), 'scripts', 'lib', 'lwc-code-analyzer.mjs'));

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };

/** A fresh repository on main with one commit; SFDX and eslint.config.js unless told otherwise. */
function makeRepo(name, { eslint = true, sfdx = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'commit.gpgsign', 'false');
  if (sfdx) write(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
  if (eslint) write(repo, 'eslint.config.js', 'export default [];\n');
  write(repo, '.gitignore', 'node_modules/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

const calls = () => existsSync(CALLS) ? readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const cleanRecord = repo => { try { return JSON.parse(readFileSync(join(stateDirFor(repo), 'clean.json'), 'utf8')); } catch { return {}; } };

let sessions = 0;
/** Run the hook as Claude Code does after a Write; the parsed output, or {} when silent. */
function afterWrite(repo, rel, { session = `session-${++sessions}`, tool = 'Write' } = {}) {
  const out = execFileSync('node', [HOOK], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: tool, session_id: session, cwd: repo,
    tool_input: { file_path: join(repo, rel), content: '' } }) });
  return out ? JSON.parse(out) : {};
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);

const LWC_JS = 'force-app/main/default/lwc/foo/foo.js';
const LWC_TEST = 'force-app/main/default/lwc/foo/__tests__/foo.test.js';
const LWC_CSS = 'force-app/main/default/lwc/foo/foo.css';
const LWC_META = 'force-app/main/default/lwc/foo/foo.js-meta.xml';
const TIMER = 'import { LightningElement } from "lwc";\nexport default class Foo extends LightningElement {\n  connectedCallback() {\n    setTimeout(() => {}, 0);\n  }\n}\n';
const CLEAN_JS = 'import { LightningElement } from "lwc";\nexport default class Foo extends LightningElement {}\n';

console.log('After a write');
const repo = makeRepo('main');
{
  write(repo, LWC_JS, TIMER);
  const out = afterWrite(repo, LWC_JS);
  check('a finding blocks', out.decision === 'block', JSON.stringify(out));
  check('the reason opens with the work order', out.reason?.startsWith(WORK_ORDER), JSON.stringify(out.reason));
  has('the reason names the file, line and rule', out.reason, `${LWC_JS}:4`, '@lwc/lwc/no-async-operation');
  has('a finding in a new untracked file is labelled new', out.reason, 'New (on lines this branch changed):');
  check('a new file has no pre-existing heading', !out.reason?.includes(PRE_EXISTING_HEADING));
}
{
  write(repo, LWC_TEST, 'it("x", () => {\n  const s = `a b`;\n});\n');
  const out = afterWrite(repo, LWC_TEST);
  check('a test file with U+00A0 blocks', out.decision === 'block', JSON.stringify(out));
  has('the block names no-irregular-whitespace', out.reason, `${LWC_TEST}:2`, 'no-irregular-whitespace');
}
{
  write(repo, LWC_JS, CLEAN_JS);
  const out = afterWrite(repo, LWC_JS, { tool: 'Edit' });
  check('a clean write is silent', JSON.stringify(out) === '{}', JSON.stringify(out));
  const oid = git(repo, 'hash-object', '--', LWC_JS);
  check('a clean write records the object id', cleanRecord(repo)[LWC_JS]?.oid === oid, JSON.stringify(cleanRecord(repo)));
}
{
  write(repo, LWC_CSS, '.a {\n  color: var(--slds-g-color-surface-1);\n}\n');
  const out = afterWrite(repo, LWC_CSS);
  check('a Moderate SLDS finding blocks', out.decision === 'block', JSON.stringify(out));
  has('the block names the SLDS rule', out.reason, `${LWC_CSS}:2`, '@salesforce-ux/slds/no-slds-var-without-fallback');
  const run = calls().filter(c => c.args[0] === 'code-analyzer' && c.args[1] === 'run').at(-1);
  check('the CSS write runs the SLDS selector', run?.args[run.args.indexOf('-r') + 1] === 'eslint:slds', JSON.stringify(run?.args));
  write(repo, LWC_CSS, '.a {\n  color: #ffffff;\n}\n');
  const low = afterWrite(repo, LWC_CSS);
  check('a Low SLDS finding is silent', JSON.stringify(low) === '{}', JSON.stringify(low));
}
{
  write(repo, LWC_META, '<LightningComponentBundle/>\n');
  const before = calls().length;
  const out = afterWrite(repo, LWC_META);
  check('a .js-meta.xml write is silent', JSON.stringify(out) === '{}', JSON.stringify(out));
  check('a .js-meta.xml write calls no sf', calls().length === before);
  write(repo, 'force-app/main/default/classes/Foo.cls', 'public class Foo {}\n');
  check('an out-of-scope file is silent', JSON.stringify(afterWrite(repo, 'force-app/main/default/classes/Foo.cls')) === '{}');
  check('an out-of-scope file calls no sf', calls().length === before);
}
{
  write(repo, LWC_JS, TIMER);
  git(repo, 'add', '--', LWC_JS);
  git(repo, 'commit', '-q', '-m', 'timer');
  write(repo, LWC_JS, TIMER.replace('class Foo', 'class Foo2'));
  const out = afterWrite(repo, LWC_JS);
  has('a finding on a line the branch did not change is pre-existing', out.reason, PRE_EXISTING_HEADING, `${LWC_JS}:4`);
  check('the pre-existing finding blocks', out.decision === 'block');
}
{
  env.FAKE_SF_MODE = 'broken';
  write(repo, LWC_JS, CLEAN_JS + '// broken\n');
  const out = afterWrite(repo, LWC_JS);
  delete env.FAKE_SF_MODE;
  check('a failed analyzer run blocks', out.decision === 'block', JSON.stringify(out));
  check('the reason says the check could not run', out.reason?.startsWith('!! The code analyzer check could not run: '), JSON.stringify(out.reason));
  check('a failed run records nothing', cleanRecord(repo)[LWC_JS]?.oid !== git(repo, 'hash-object', '--', LWC_JS));
}
{
  env.HEAN_LWC_ANALYZER_DEADLINE_MS = '1';
  write(repo, LWC_JS, CLEAN_JS + '// late\n');
  const out = afterWrite(repo, LWC_JS);
  delete env.HEAN_LWC_ANALYZER_DEADLINE_MS;
  check('a passed deadline blocks', out.decision === 'block', JSON.stringify(out));
  has('a passed deadline says the check could not run', out.reason, '!! The code analyzer check could not run: ', 'deadline');
}
{
  const blocker = join(sandbox, 'not-a-folder');
  writeFileSync(blocker, 'x\n');
  const saved = env.CLAUDE_CONFIG_DIR;
  env.CLAUDE_CONFIG_DIR = join(blocker, 'config');
  write(repo, LWC_JS, CLEAN_JS + '// crash\n');
  const out = afterWrite(repo, LWC_JS);
  const run = spawnSync('node', [HOOK, '--check', LWC_JS], { env, encoding: 'utf8', cwd: repo });
  env.CLAUDE_CONFIG_DIR = saved;
  check('an exception in the check blocks', out.decision === 'block', JSON.stringify(out));
  check('an exception says the check could not run', out.reason?.startsWith('!! The code analyzer check could not run: '), JSON.stringify(out.reason));
  check('--check exits 1 on an exception', run.status === 1 && run.stderr.includes('!! The code analyzer check could not run: '), run.stderr);
}

console.log('Repositories it does not apply to');
{
  const noEslint = makeRepo('no-eslint', { eslint: false });
  write(noEslint, LWC_JS, TIMER);
  const before = calls().length;
  const out = afterWrite(noEslint, LWC_JS);
  check('no eslint.config.js does not block', out.decision === undefined, JSON.stringify(out));
  has('no eslint.config.js adds the !! does-not-apply line', out.hookSpecificOutput?.additionalContext,
    '!! The code analyzer check does not apply', 'eslint.config.js');
  check('no eslint.config.js calls no sf', calls().length === before);
  const plain = makeRepo('plain', { sfdx: false });
  write(plain, LWC_JS, TIMER);
  check('a repository without sfdx-project.json is silent', JSON.stringify(afterWrite(plain, LWC_JS)) === '{}');
  check('a repository without sfdx-project.json calls no sf', calls().length === before);
}

console.log('--check mode');
{
  write(repo, LWC_JS, CLEAN_JS + '// checked\n');
  const run = spawnSync('node', [HOOK, '--check', LWC_JS], { env, encoding: 'utf8', cwd: repo });
  check('--check exits 0 on a clean file', run.status === 0, run.stderr);
  check('--check records the clean file', cleanRecord(repo)[LWC_JS]?.oid === git(repo, 'hash-object', '--', LWC_JS));
  write(repo, LWC_JS, TIMER);
  const bad = spawnSync('node', [HOOK, '--check', LWC_JS, LWC_CSS], { env, encoding: 'utf8', cwd: repo });
  check('--check exits 1 on a finding', bad.status === 1);
  has('--check prints the findings on stderr', bad.stderr, WORK_ORDER, `${LWC_JS}:4`, '@lwc/lwc/no-async-operation');
  const meta = spawnSync('node', [HOOK, '--check', LWC_META], { env, encoding: 'utf8', cwd: repo });
  check('--check refuses an out-of-scope file', meta.status === 1 && meta.stderr.length > 0, meta.stderr);
  const none = spawnSync('node', [HOOK, '--check'], { env, encoding: 'utf8', cwd: repo });
  check('--check with no file exits 1', none.status === 1);
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
