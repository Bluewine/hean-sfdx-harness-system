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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync, copyFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'lwc-code-analyzer-check.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'lwc-code-analyzer-check-')));
const BIN = join(sandbox, 'bin');
const CALLS = join(sandbox, 'calls.log');
mkdirSync(BIN);
// FAKE_SF_MODE: unset = JSON like the real analyzer; 'broken' = one violation attached to no file;
// 'slow' = every code-analyzer call waits 5 seconds first.
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
if (mode === 'slow') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
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

/** Run the hook as Claude Code does before a Bash call; the parsed output, or {} when silent. */
function gate(repo, command, { session = `session-${++sessions}`, hook = HOOK } = {}) {
  const out = execFileSync('node', [hook], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: session, cwd: repo, tool_input: { command } }) });
  return out ? JSON.parse(out) : {};
}

/** The gate's refusal text, or null when allowed. */
function refusal(repo, command, options) {
  const o = gate(repo, command, options).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

const runs = () => calls().filter(c => c.args[0] === 'code-analyzer' && c.args[1] === 'run').length;

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

console.log('Commit gate');
const g = makeRepo('gate');
{
  write(g, LWC_JS, TIMER);
  git(g, 'add', '--', LWC_JS);
  const r = refusal(g, 'git commit -m x');
  check('a staged file with a finding is refused', r?.startsWith(WORK_ORDER), JSON.stringify(r));
  has('the refusal names the file, line and rule', r, `${LWC_JS}:4`, '@lwc/lwc/no-async-operation');
}
{
  write(g, LWC_JS, CLEAN_JS);
  const pre = spawnSync('node', [HOOK, '--check', LWC_JS], { env, encoding: 'utf8', cwd: g });
  check('--check records the clean file first', pre.status === 0, pre.stderr);
  git(g, 'add', '--', LWC_JS);
  const before = runs();
  const out = gate(g, 'git commit -m x');
  check('a recorded clean file is allowed', JSON.stringify(out) === '{}', JSON.stringify(out));
  check('a recorded clean file runs no analyzer', runs() === before);
  git(g, 'commit', '-q', '-m', 'clean foo');
}
{
  write(g, LWC_JS, CLEAN_JS + '// v3\n');
  const out = gate(g, `git add ${LWC_JS} && git commit -m x`);
  check('same-call staging of an unrecorded clean file is allowed', JSON.stringify(out) === '{}', JSON.stringify(out));
  check('same-call staging records the clean file', cleanRecord(g)[LWC_JS]?.oid === git(g, 'hash-object', '--', LWC_JS), JSON.stringify(cleanRecord(g)));
}
{
  write(g, LWC_JS, CLEAN_JS + '// staged\n');
  git(g, 'add', '--', LWC_JS);
  write(g, LWC_JS, CLEAN_JS + '// working\n');
  has('staged content unlike the working copy is refused', refusal(g, 'git commit -m x'), LWC_JS, 'stage the whole file');
  git(g, 'checkout', '--', '.');
  git(g, 'reset', '-q');
  git(g, 'checkout', '--', '.');
}
{
  write(g, LWC_META, '<LightningComponentBundle/>\n');
  write(g, 'README.md', '# x\n');
  git(g, 'add', '--', LWC_META, 'README.md');
  const before = calls().length;
  const out = gate(g, 'git commit -m x');
  check('a commit of only out-of-scope files is allowed', JSON.stringify(out) === '{}', JSON.stringify(out));
  check('a commit of only out-of-scope files calls no sf', calls().length === before);
  git(g, 'commit', '-q', '-m', 'meta');
}
{
  write(g, LWC_CSS, '.a {\n  color: var(--slds-g-color-surface-1);\n}\n');
  git(g, 'add', '--', LWC_CSS);
  has('a staged CSS file with a Moderate SLDS finding is refused', refusal(g, 'git commit -m x'),
    WORK_ORDER, `${LWC_CSS}:2`, '@salesforce-ux/slds/no-slds-var-without-fallback');
  git(g, 'reset', '-q');
  rmSync(join(g, LWC_CSS));
}
{
  git(g, 'rm', '-q', '--', LWC_JS);
  const out = gate(g, 'git commit -m x');
  check('a commit that deletes the file is allowed', JSON.stringify(out) === '{}', JSON.stringify(out));
  git(g, 'reset', '-q', '--hard');
}
{
  env.HEAN_LWC_ANALYZER_DEADLINE_MS = '1000';
  env.FAKE_SF_MODE = 'slow';
  write(g, LWC_JS, CLEAN_JS + '// slow\n');
  git(g, 'add', '--', LWC_JS);
  const r = refusal(g, 'git commit -m x');
  delete env.HEAN_LWC_ANALYZER_DEADLINE_MS;
  delete env.FAKE_SF_MODE;
  has('a passed deadline refuses as could not run', r, 'could not run', 'deadline');
  has('a passed deadline names the --check command', r, '--check');
  git(g, 'reset', '-q', '--hard');
}
{
  write(g, LWC_JS, TIMER);
  git(g, 'add', '--', LWC_JS);
  writeFileSync(join(g, '.git', 'MERGE_HEAD'), git(g, 'rev-parse', 'HEAD') + '\n');
  const out = gate(g, 'git commit -m x');
  rmSync(join(g, '.git', 'MERGE_HEAD'));
  check('a commit during a merge is allowed', JSON.stringify(out) === '{}', JSON.stringify(out));
  git(g, 'reset', '-q', '--hard');
}

console.log('Commands that are not a commit or push');
{
  const before = calls().length;
  const out = gate(g, 'git status');
  check('git status is silent', JSON.stringify(out) === '{}', JSON.stringify(out));
  check('git status calls no sf', calls().length === before);
  const copy = join(sandbox, 'copy');
  mkdirSync(join(copy, 'hooks'), { recursive: true });
  mkdirSync(join(copy, 'scripts', 'lib'), { recursive: true });
  copyFileSync(HOOK, join(copy, 'hooks', 'lwc-code-analyzer-check.mjs'));
  copyFileSync(join(HOOKS, 'git-identity-guard.mjs'), join(copy, 'hooks', 'git-identity-guard.mjs'));
  cpSync(join(dirname(HOOKS), 'scripts', 'lib'), join(copy, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(copy, 'scripts', 'lib', 'lwc-code-analyzer.mjs'), "throw new Error('loaded');\n");
  const hook = join(copy, 'hooks', 'lwc-code-analyzer-check.mjs');
  const run = spawnSync('node', [hook], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's', cwd: g, tool_input: { command: 'git status' } }) });
  check('git status exits 0 when the library throws on load', run.status === 0, run.stderr);
  check('git status prints nothing when the library throws on load', run.stdout === '', run.stdout);
  write(g, LWC_JS, TIMER);
  git(g, 'add', '--', LWC_JS);
  has('a commit is refused when the library throws on load', refusal(g, 'git commit -m x', { hook }), 'could not run', 'loaded');
  git(g, 'reset', '-q', '--hard');
  const plainGate = makeRepo('plain-gate', { sfdx: false });
  write(plainGate, LWC_JS, TIMER);
  git(plainGate, 'add', '--', LWC_JS);
  const plainOut = gate(plainGate, 'git commit -m x', { hook });
  check('a commit without sfdx-project.json is silent when the library throws on load', JSON.stringify(plainOut) === '{}', JSON.stringify(plainOut));
}

console.log('Push gate');
{
  const p = makeRepo('push');
  const remote = join(sandbox, 'push-remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env });
  git(p, 'remote', 'add', 'origin', remote);
  git(p, 'push', '-q', 'origin', 'main');
  write(p, LWC_JS, TIMER);
  git(p, 'add', '--', LWC_JS);
  git(p, 'commit', '-q', '-m', 'timer');
  const r = refusal(p, 'git push');
  check('a pushed commit with an unrecorded finding is refused', r?.startsWith(WORK_ORDER), JSON.stringify(r));
  has('the push refusal names the file and rule', r, `${LWC_JS}:4`, '@lwc/lwc/no-async-operation');
  const before = calls().length;
  const dry = gate(p, 'git push --dry-run');
  check('git push --dry-run is allowed', JSON.stringify(dry) === '{}', JSON.stringify(dry));
  check('git push --dry-run calls no sf', calls().length === before);

  git(p, 'checkout', '-q', '-b', 'b');
  git(p, 'checkout', '-q', '-b', 'a');
  write(p, LWC_JS, CLEAN_JS);
  const pre = spawnSync('node', [HOOK, '--check', LWC_JS], { env, encoding: 'utf8', cwd: p });
  check('--check records the clean copy on branch a', pre.status === 0, pre.stderr);
  git(p, 'add', '--', LWC_JS);
  git(p, 'commit', '-q', '-m', 'clean on a');
  check('a push of branch a, clean and recorded, is allowed', refusal(p, 'git push origin a') === null);
  has('a push of branch b from branch a is refused', refusal(p, 'git push origin b'), 'the pushed content of these files differs', LWC_JS);
  has('git push --all, which sends branch b, is refused', refusal(p, 'git push --all origin'), 'the pushed content of these files differs', LWC_JS);
  has('a push whose refspec is a variable is refused', refusal(p, 'git push origin "$BRANCH"'), 'variable or a glob', '`$BRANCH`', 'Name the branch');
}
{
  const m = makeRepo('merge');
  const remote = join(sandbox, 'merge-remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env });
  git(m, 'remote', 'add', 'origin', remote);
  write(m, LWC_JS, CLEAN_JS);
  git(m, 'add', '--', LWC_JS);
  git(m, 'commit', '-q', '-m', 'foo');
  git(m, 'checkout', '-q', '-b', 'side');
  write(m, LWC_JS, CLEAN_JS + '// side\n');
  git(m, 'commit', '-q', '-am', 'side');
  git(m, 'checkout', '-q', 'main');
  write(m, LWC_JS, CLEAN_JS + '// main\n');
  git(m, 'commit', '-q', '-am', 'main');
  git(m, 'push', '-q', 'origin', 'main', 'side');
  const merge = spawnSync('git', ['-C', m, 'merge', '-q', 'side'], { env, encoding: 'utf8' });
  check('the merge stops on a conflict', merge.status !== 0, merge.stdout);
  write(m, LWC_JS, TIMER);
  git(m, 'add', '--', LWC_JS);
  git(m, 'commit', '-q', '--no-edit');
  const r = refusal(m, 'git push');
  check('a pushed merge whose conflict resolution adds a finding is refused', r?.startsWith(WORK_ORDER), JSON.stringify(r));
  has('the merge refusal names the file and rule', r, LWC_JS, '@lwc/lwc/no-async-operation');
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
