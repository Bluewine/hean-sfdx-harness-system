#!/usr/bin/env node
/**
 * The shared code analyzer checker: scope, the two run kinds and their
 * generated configurations, the config proof and its session cache, the
 * fail-closed results, the clean record, finding labels and message text.
 *
 * No real analyzer runs. PATH starts with a fake `sf` that answers
 * `plugins --json`, `code-analyzer rules` and `code-analyzer run`, writes JSON
 * to the -f path as the real analyzer does, and logs every call with the
 * content of its -c file. Each repository is a throwaway git repository in a
 * temp sandbox, and the record and session files live in a throwaway
 * CLAUDE_CONFIG_DIR.
 *
 * Run: node scripts/__tests__/lwc-code-analyzer.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'lwc-code-analyzer-')));
const BIN = join(sandbox, 'bin');
const CALLS = join(sandbox, 'calls.log');
mkdirSync(BIN);
// FAKE_SF_MODE: unset = JSON like the real analyzer; 'broken' = one violation attached to no file;
// 'norules' = rules lists none; 'nolwcrules' = rules lists none for lwc .js targets; 'slow' = code-analyzer sleeps 5 s;
// 'text' = code-analyzer prints no JSON.
const FAKE_SF = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const all = n => args.flatMap((a, i) => a === n ? [args[i + 1]] : []);
const arg = n => all(n)[0];
const cfg = arg('-c');
fs.appendFileSync(process.env.FAKE_SF_LOG, JSON.stringify({ args, cwd: process.cwd(), noColor: process.env.NO_COLOR,
  config: cfg && fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : null }) + '\\n');
const mode = process.env.FAKE_SF_MODE;
if (args[0] === 'plugins') {
  console.log(JSON.stringify([{ name: '@salesforce/cli', version: '2.153.5' }, { name: '@salesforce/plugin-code-analyzer', version: '5.13.0' }]));
  process.exit(0);
}
if (args[0] !== 'code-analyzer') { console.error('unexpected ' + args.join(' ')); process.exit(1); }
if (mode === 'slow') { const end = Date.now() + 5000; while (Date.now() < end) {} }
if (mode === 'text') { console.error('Error: something went wrong'); process.exit(1); }
const selector = arg('-r');
const slds = selector === 'eslint:slds';
const ofKind = t => slds ? /\\.(html|css)$/.test(t) : /\\.js$/.test(t);
const targets = all('-t');
if (args[1] === 'rules') {
  const none = mode === 'norules' || (mode === 'nolwcrules' && targets.some(t => /(^|\\/)lwc\\//.test(t) && t.endsWith('.js')));
  const rules = none || !targets.some(ofKind) ? [] : slds
    ? [{ name: '@salesforce-ux/slds/no-slds-var-without-fallback', engine: 'eslint', severity: 3 }]
    : [{ name: '@lwc/lwc/no-async-operation', engine: 'eslint', severity: 3 }, { name: 'no-debugger', engine: 'eslint', severity: 4 }];
  fs.writeFileSync(arg('-f'), JSON.stringify({ rules }));
  process.exit(0);
}
const checks = slds
  ? [['var(--slds-g-color-surface-1)', '@salesforce-ux/slds/no-slds-var-without-fallback', 3, 'Add a fallback value.'],
     ['#ffffff', '@salesforce-ux/slds/no-hardcoded-values-slds2', 4, 'Use a styling hook.']]
  : [['setTimeout', '@lwc/lwc/no-async-operation', 3, 'Restricted async operation "setTimeout"'],
     ['\\u00a0', 'no-irregular-whitespace', 2, 'Irregular whitespace not allowed.'],
     ['debugger', 'no-debugger', 4, "Unexpected 'debugger' statement."]];
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
const threshold = Number(arg('-s') ?? 5);
fs.writeFileSync(arg('-f'), JSON.stringify({ runDir: process.cwd(), violationCounts: { total: violations.length }, versions: { 'code-analyzer': '5.13.0' }, violations }));
process.exit(violations.some(v => v.severity <= threshold) ? 1 : 0);
`;
writeFileSync(join(BIN, 'sf'), FAKE_SF);
chmodSync(join(BIN, 'sf'), 0o755);
const HOME = join(sandbox, 'home');
mkdirSync(HOME);
const ORIGINAL_PATH = process.env.PATH;
Object.assign(process.env, { HOME, CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${BIN}:${ORIGINAL_PATH}`, FAKE_SF_LOG: CALLS });
delete process.env.FAKE_SF_MODE;
const env = { ...process.env };

const lib = await import(join(SCRIPTS, 'lib', 'lwc-code-analyzer.mjs'));

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const ESLINT_CONFIG = 'export default [];\n';

/** A fresh SFDX repository on main with eslint.config.js and one commit. */
function makeRepo(name, { eslint = true, sfdx = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'commit.gpgsign', 'false');
  if (sfdx) write(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
  if (eslint) write(repo, 'eslint.config.js', ESLINT_CONFIG);
  write(repo, '.gitignore', 'node_modules/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

const calls = () => existsSync(CALLS) ? readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const since = n => calls().slice(n);
const isRun = c => c.args[0] === 'code-analyzer' && c.args[1] === 'run';
const isRules = c => c.args[0] === 'code-analyzer' && c.args[1] === 'rules';
const flagValues = (c, flag) => c.args.flatMap((a, i) => a === flag ? [c.args[i + 1]] : []);

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);

let sessions = 0;
const session = () => `session-${++sessions}`;
const analyze = (repo, files, opts = {}) =>
  lib.analyze(repo, files, { deadline: Date.now() + 30000, sessionId: session(), ...opts });

const LWC_JS = 'force-app/main/default/lwc/foo/foo.js';
const LWC_CSS = 'force-app/main/default/lwc/foo/foo.css';
const LWC_HTML = 'force-app/main/default/lwc/foo/foo.html';
const AURA_JS = 'force-app/main/default/aura/bar/barController.js';
const TIMER = 'import { LightningElement } from "lwc";\nexport default class Foo extends LightningElement {\n  connectedCallback() {\n    setTimeout(() => {}, 0);\n  }\n}\n';
const CLEAN_JS = 'import { LightningElement } from "lwc";\nexport default class Foo extends LightningElement {}\n';

console.log('Scope');
{
  check('IN_SCOPE matches an lwc .js file', lib.IN_SCOPE.test(LWC_JS));
  check('IN_SCOPE matches an aura .js file', lib.IN_SCOPE.test(AURA_JS));
  check('IN_SCOPE matches an lwc .html and .css file', lib.IN_SCOPE.test(LWC_HTML) && lib.IN_SCOPE.test(LWC_CSS));
  check('IN_SCOPE matches a Jest test file', lib.IN_SCOPE.test('force-app/main/default/lwc/foo/__tests__/foo.test.js'));
  check('IN_SCOPE leaves out a .js-meta.xml file', !lib.IN_SCOPE.test('force-app/main/default/lwc/foo/foo.js-meta.xml'));
  check('IN_SCOPE leaves out a file outside force-app', !lib.IN_SCOPE.test('src/lwc/foo/foo.js'));
  check('kindOf: .js is js, .html and .css are slds',
    lib.kindOf(LWC_JS) === 'js' && lib.kindOf(LWC_HTML) === 'slds' && lib.kindOf(LWC_CSS) === 'slds');
  check('familyOf: lwc .js, aura .js, and .css',
    lib.familyOf(LWC_JS) === 'js-lwc' && lib.familyOf(AURA_JS) === 'js-aura' && lib.familyOf(LWC_CSS) === 'slds');

  check('applies: no sfdx-project.json gives no note', JSON.stringify(lib.applies(makeRepo('no-sfdx', { sfdx: false }))) === '{"ok":false,"note":null}');
  const noEslint = makeRepo('no-eslint', { eslint: false });
  const a = lib.applies(noEslint);
  check('applies: no eslint.config.js gives the !! note', a.ok === false &&
    a.note === `!! The code analyzer check does not apply: ${noEslint} has no eslint.config.js.`, JSON.stringify(a));
  check('applies: both files present is ok', lib.applies(makeRepo('applies')).ok === true);
}

const repo = makeRepo('main');
write(repo, LWC_JS, TIMER);

console.log('JavaScript run');
{
  const before = calls().length;
  const r = await analyze(repo, [LWC_JS]);
  check('a setTimeout gives findings', r.kind === 'findings', JSON.stringify(r));
  const f = r.findings?.[0];
  check('the finding names the rule, the file, its line, column and severity',
    r.findings?.length === 1 && f.rule === '@lwc/lwc/no-async-operation' && f.file === LWC_JS && f.line === 4 && f.column === 5 && f.severity === 3,
    JSON.stringify(r.findings));
  has('the finding carries the message', f?.message, 'setTimeout');
  const run = since(before).find(isRun);
  check('the run uses -r eslint, -s 3 and -w <root>',
    flagValues(run, '-r')[0] === 'eslint' && flagValues(run, '-s')[0] === '3' && flagValues(run, '-w')[0] === repo, JSON.stringify(run?.args));
  check('every -t value is a file', flagValues(run, '-t').length === 1 &&
    flagValues(run, '-t').every(t => statSync(join(run.cwd, t), { throwIfNoEntry: false })?.isFile()), JSON.stringify(run?.args));
  check('sf runs in the repository root with colour off', run?.cwd === repo && run.noColor === '1', JSON.stringify(run?.cwd));
  const cfg = run?.config ?? '';
  for (const layer of ['javascript', 'lwc', 'typescript', 'react', 'slds'])
    has(`the js config turns off the ${layer} layer`, cfg, `disable_${layer}_base_config: true`);
  has('the js config names the absolute eslint.config.js', cfg, `eslint_config_file: ${JSON.stringify(join(repo, 'eslint.config.js'))}`);
  has('the js config turns off auto discovery', cfg, 'auto_discover_eslint_config: false');
  for (const engine of ['pmd', 'cpd', 'sfge', 'regex', 'retire-js', 'flow'])
    check(`the js config disables ${engine}`, new RegExp(`\\n  ${engine}:\\n    disable_engine: true\\n`).test(cfg), cfg);
  const proof = since(before).find(isRules);
  check('the proof uses the same generated config', proof?.config === cfg && flagValues(proof, '-r')[0] === 'eslint'
    && flagValues(proof, '-t')[0] === LWC_JS, JSON.stringify(proof?.args));
  check('the temporary folder is removed', !existsSync(flagValues(run, '-c')[0] ?? ''));
}
{
  write(repo, 'force-app/main/default/lwc/ws/ws.js', 'const a = 1; \n');
  const r = await analyze(repo, ['force-app/main/default/lwc/ws/ws.js']);
  check('a U+00A0 gives no-irregular-whitespace at severity 2', r.kind === 'findings' && r.findings[0].rule === 'no-irregular-whitespace' && r.findings[0].severity === 2, JSON.stringify(r));
  write(repo, 'force-app/main/default/lwc/dbg/dbg.js', 'export function x() {\n  debugger;\n}\n');
  const d = await analyze(repo, ['force-app/main/default/lwc/dbg/dbg.js']);
  check('a file with only a severity 4 finding is clean', d.kind === 'clean', JSON.stringify(d));
}

console.log('SLDS run');
{
  write(repo, LWC_CSS, ':host {\n  color: var(--slds-g-color-surface-1);\n}\n');
  const before = calls().length;
  const r = await analyze(repo, [LWC_CSS]);
  check('a var() without fallback gives findings', r.kind === 'findings' && r.findings[0].rule === '@salesforce-ux/slds/no-slds-var-without-fallback'
    && r.findings[0].line === 2, JSON.stringify(r));
  const run = since(before).find(isRun);
  check('the slds run uses -r eslint:slds', flagValues(run, '-r')[0] === 'eslint:slds', JSON.stringify(run?.args));
  const cfg = run?.config ?? '';
  check('the slds config names no eslint_config_file', !cfg.includes('eslint_config_file'), cfg);
  has('the slds config keeps the lwc and slds layers on', cfg, 'disable_lwc_base_config: false', 'disable_slds_base_config: false');
  has('the slds config turns off the other three layers', cfg,
    'disable_javascript_base_config: true', 'disable_typescript_base_config: true', 'disable_react_base_config: true');
  write(repo, 'force-app/main/default/lwc/hex/hex.css', ':host {\n  color: #ffffff;\n}\n');
  const h = await analyze(repo, ['force-app/main/default/lwc/hex/hex.css']);
  check('a hardcoded colour at severity 4 is clean', h.kind === 'clean', JSON.stringify(h));
}

console.log('Two kinds in one call');
{
  write(repo, 'force-app/main/default/lwc/both/both.js', CLEAN_JS);
  write(repo, 'force-app/main/default/lwc/both/both.css', ':host {}\n');
  const before = calls().length;
  const r = await analyze(repo, ['force-app/main/default/lwc/both/both.js', 'force-app/main/default/lwc/both/both.css']);
  const runs = since(before).filter(isRun);
  check('two kinds give two runs', runs.length === 2, JSON.stringify(runs.map(c => c.args)));
  check('the first run has only the .js file', JSON.stringify(flagValues(runs[0], '-t')) === '["force-app/main/default/lwc/both/both.js"]', JSON.stringify(runs[0]?.args));
  check('the second run has only the .css file', JSON.stringify(flagValues(runs[1], '-t')) === '["force-app/main/default/lwc/both/both.css"]', JSON.stringify(runs[1]?.args));
  check('both clean is clean', r.kind === 'clean', JSON.stringify(r));
  const mixed = await analyze(repo, [LWC_JS, LWC_CSS]);
  check('findings of both kinds are merged', mixed.kind === 'findings' && mixed.findings.length === 2, JSON.stringify(mixed));
}

console.log('Proof cache');
{
  const sid = session();
  write(repo, 'force-app/main/default/lwc/other/other.js', CLEAN_JS);
  const before = calls().length;
  await lib.analyze(repo, [LWC_JS], { deadline: Date.now() + 30000, sessionId: sid });
  await lib.analyze(repo, ['force-app/main/default/lwc/other/other.js'], { deadline: Date.now() + 30000, sessionId: sid });
  check('two .js calls in one session make one rules call', since(before).filter(isRules).length === 1, JSON.stringify(since(before).map(c => c.args.slice(0, 2))));
  check('the version is asked once per session', since(before).filter(c => c.args[0] === 'plugins').length === 1);
  const mid = calls().length;
  await lib.analyze(repo, [LWC_CSS], { deadline: Date.now() + 30000, sessionId: sid });
  const slds = since(mid).filter(isRules);
  check('a later .css call makes one more rules call with eslint:slds', slds.length === 1 && flagValues(slds[0], '-r')[0] === 'eslint:slds',
    JSON.stringify(slds.map(c => c.args)));
  write(repo, AURA_JS, '({ init: function () {} })\n');
  const auraBefore = calls().length;
  const a = await lib.analyze(repo, [AURA_JS], { deadline: Date.now() + 30000, sessionId: sid });
  const auraRules = since(auraBefore).filter(isRules);
  check('an aura .js file after an lwc proof makes its own rules call', auraRules.length === 1 && flagValues(auraRules[0], '-t')[0] === AURA_JS,
    JSON.stringify(auraRules.map(c => c.args)));
  check('the aura file is clean', a.kind === 'clean', JSON.stringify(a));
}

console.log('Could not run');
{
  process.env.FAKE_SF_MODE = 'nolwcrules';
  const n = await analyze(repo, [LWC_JS]);
  check('nolwcrules: an lwc .js file could not run', n.kind === 'could-not-run', JSON.stringify(n));
  const a = await analyze(repo, [AURA_JS]);
  check('nolwcrules: an aura .js file still runs', a.kind === 'clean', JSON.stringify(a));

  process.env.FAKE_SF_MODE = 'norules';
  const nr = await analyze(repo, [LWC_JS]);
  check('norules: could not run', nr.kind === 'could-not-run', JSON.stringify(nr));
  has('norules: the reason says the rules do not apply to the file', nr.reason, 'rules do not apply to', LWC_JS);

  process.env.FAKE_SF_MODE = 'broken';
  const b = await analyze(repo, [LWC_JS]);
  check('broken: could not run', b.kind === 'could-not-run', JSON.stringify(b));
  has('broken: the reason names UninstantiableEngineError', b.reason, 'UninstantiableEngineError');

  process.env.FAKE_SF_MODE = 'text';
  const t = await analyze(repo, [LWC_JS]);
  check('text: could not run', t.kind === 'could-not-run', JSON.stringify(t));
  has('text: the reason carries what sf printed', t.reason, 'something went wrong');

  process.env.FAKE_SF_MODE = 'slow';
  const start = Date.now();
  const s = await analyze(repo, [LWC_JS], { deadline: Date.now() + 1000 });
  const took = Date.now() - start;
  check('slow: could not run', s.kind === 'could-not-run', JSON.stringify(s));
  has('slow: the reason names the deadline', s.reason, 'deadline');
  check('slow: returns in under 3 s', took < 3000, `${took} ms`);
  const late = await analyze(repo, [LWC_JS], { deadline: Date.now() - 1 });
  check('a deadline already passed could not run', late.kind === 'could-not-run' && late.reason.includes('deadline'), JSON.stringify(late));
  delete process.env.FAKE_SF_MODE;

  process.env.PATH = ORIGINAL_PATH.split(':').filter(p => p && !existsSync(join(p, 'sf'))).join(':');
  const m = await analyze(repo, [LWC_JS]);
  process.env.PATH = `${BIN}:${ORIGINAL_PATH}`;
  check('sf missing: could not run', m.kind === 'could-not-run', JSON.stringify(m));
  has('sf missing: the reason names the install command', m.reason, 'sf plugins install @salesforce/plugin-code-analyzer');

  has('couldNotRunText starts with the !! line', lib.couldNotRunText('x went wrong'), '!! The code analyzer check could not run: x went wrong');
  check('couldNotRunText starts with it', lib.couldNotRunText('x').startsWith('!! The code analyzer check could not run: '));
}

console.log('Clean record');
{
  const sid = session();
  const k1 = lib.recordKey(repo, sid);
  check('recordKey is a sha1', /^[0-9a-f]{40}$/.test(k1), k1);
  check('recordKey is stable', lib.recordKey(repo, sid) === k1);
  write(repo, 'eslint.config.js', 'export default [{ rules: {} }];\n');
  const k2 = lib.recordKey(repo, sid);
  check('recordKey changes with eslint.config.js', k2 !== k1);
  write(repo, 'eslint.config.js', ESLINT_CONFIG);
  check('recordKey returns with the old eslint.config.js', lib.recordKey(repo, sid) === k1);
  write(repo, 'node_modules/.package-lock.json', '{"packages":{}}\n');
  const k3 = lib.recordKey(repo, sid);
  check('recordKey changes with node_modules/.package-lock.json', k3 !== k1);
  rmSync(join(repo, 'node_modules'), { recursive: true });

  check('nothing is recorded at first', lib.isRecordedClean(repo, LWC_JS, 'abc', k1) === false);
  lib.recordClean(repo, LWC_JS, 'abc', k1);
  check('a recorded file and key match', lib.isRecordedClean(repo, LWC_JS, 'abc', k1) === true);
  check('another object id does not match', lib.isRecordedClean(repo, LWC_JS, 'def', k1) === false);
  check('another key does not match', lib.isRecordedClean(repo, LWC_JS, 'abc', k2) === false);
  const recordDir = join(sandbox, 'config', 'hean-harness', 'lwc-code-analyzer');
  const stored = JSON.parse(readFileSync(join(recordDir, lib.stateDirFor(repo).split('/').at(-1), 'clean.json'), 'utf8'));
  check('the record is { rel: { oid, key } } under claudeDir()', JSON.stringify(stored[LWC_JS]) === JSON.stringify({ oid: 'abc', key: k1 }), JSON.stringify(stored));
}

console.log('Labels');
{
  const r = makeRepo('labels');
  const lines = Array.from({ length: 12 }, (_, i) => `const line${i + 1} = ${i + 1};`);
  write(r, LWC_JS, lines.join('\n') + '\n');
  git(r, 'add', '.');
  git(r, 'commit', '-q', '-m', 'component');
  git(r, 'checkout', '-q', '-b', 'work-ABC-1');
  lines[2] = 'setTimeout(() => {}, 0);';
  write(r, LWC_JS, lines.join('\n') + '\n');
  const finding = line => ({ file: LWC_JS, line, column: 1, rule: 'no-x', severity: 3, message: 'x' });
  const labelled = lib.labelFindings(r, [finding(3), finding(10)]);
  check('a finding on a changed line is new', labelled[0]?.preExisting === false, JSON.stringify(labelled));
  check('a finding on an unchanged line is pre-existing', labelled[1]?.preExisting === true, JSON.stringify(labelled));
  git(r, 'add', '.');
  git(r, 'commit', '-q', '-m', 'change');
  const committed = lib.labelFindings(r, [finding(3), finding(10)]);
  check('after a commit on the branch the labels hold', committed[0]?.preExisting === false && committed[1]?.preExisting === true, JSON.stringify(committed));
  const NEW = 'force-app/main/default/lwc/fresh/fresh.js';
  write(r, NEW, 'a\nb\nc\n');
  const fresh = lib.labelFindings(r, [{ ...finding(1), file: NEW }, { ...finding(3), file: NEW }]);
  check('every finding on an untracked file is new', fresh.length === 2 && fresh.every(f => f.preExisting === false), JSON.stringify(fresh));
}

console.log('Findings text');
{
  const labelled = [
    { file: LWC_JS, line: 4, column: 5, rule: '@lwc/lwc/no-async-operation', severity: 3, message: 'Restricted async operation "setTimeout"', preExisting: false },
    { file: LWC_JS, line: 9, column: 1, rule: 'no-use-before-define', severity: 2, message: "'x' was used before it was defined.", preExisting: true }
  ];
  const text = lib.findingsText(labelled);
  check('the text starts with the work-order line',
    text.startsWith('Fix these findings now, before any other step. Do not ask the user whether to start.'), text);
  has('the text lists each finding as file:line rule — message', text,
    `${LWC_JS}:4 @lwc/lwc/no-async-operation — Restricted async operation "setTimeout"`, `${LWC_JS}:9 no-use-before-define — 'x' was used before it was defined.`);
  has('the text names lwc-conventions.md section 4 for no-async-operation', text, '`lwc-conventions.md` section 4');
  has('pre-existing findings sit under their heading, followed by the pre-existing text', text,
    'Pre-existing (in the file before this branch):\nChange only what removes the finding, and keep the functionality, behavior and output exactly as before. ' +
    'If a finding cannot be fixed that way, leave it, and tell the user which finding and why; the commit stays refused until the user decides.');
  check('the pre-existing finding comes after its heading',
    text.indexOf('no-use-before-define') > text.indexOf('Pre-existing (in the file before this branch):'), text);
  check('the new finding comes before the pre-existing heading',
    text.indexOf('@lwc/lwc/no-async-operation') < text.indexOf('Pre-existing (in the file before this branch):'), text);
  const onlyNew = lib.findingsText([labelled[0]]);
  check('no pre-existing heading without pre-existing findings', !onlyNew.includes('Pre-existing'), onlyNew);
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
