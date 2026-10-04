#!/usr/bin/env node
/**
 * What the runbook compile check reports after a write, and which commits its
 * gate lets through.
 *
 * No org is called. Each throwaway repository gets a fake node_modules holding
 * @store-sfdcbt-net/CICD_node-run-list-exec-lib,
 * @store-sfdcbt-net/CICD_node-jsforce-util and a fake jsforce whose
 * tooling.executeAnonymous() answers from the source it is given, and PATH
 * starts with a fake `sf` that prints an org display result. The record lives
 * in a throwaway CLAUDE_CONFIG_DIR.
 *
 * Run: node hooks/__tests__/runbook-compile-check.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'runbook-compile-check.mjs');
const { pipelineApiVersion } = await import(join(dirname(HOOKS), 'scripts', 'lib', 'runbook-compile.mjs'));

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-compile-')));
const BIN = join(sandbox, 'bin');
const CALLS = join(sandbox, 'calls.log');
mkdirSync(BIN);
const SF_ARGS = join(sandbox, 'sf-args.log');
writeFileSync(join(BIN, 'sf'), `#!/bin/sh\necho "$*" >> '${SF_ARGS}'\necho \'{"status":0,"result":{"instanceUrl":"https://fake.example.com","accessToken":"fake-token"}}\'\n`);
chmodSync(join(BIN, 'sf'), 0o755);
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${BIN}:${process.env.PATH}`, FAKE_JSFORCE_LOG: CALLS };

const RUNNER = 'node_modules/@store-sfdcbt-net/CICD_node-run-list-exec-lib';
const UTIL = 'node_modules/@store-sfdcbt-net/CICD_node-jsforce-util';
const pkg = (repo, folder, name) => { mkdirSync(join(repo, folder), { recursive: true }); writeFileSync(join(repo, folder, 'package.json'), JSON.stringify({ name, version: '1.0.0' })); };
const FAKE_JSFORCE = `
const fs = require('fs');
class Connection {
  constructor(o) { this.version = o.version; this.tooling = { executeAnonymous: async body => {
    fs.appendFileSync(process.env.FAKE_JSFORCE_LOG, JSON.stringify({ version: this.version, body }) + '\\n');
    const lines = body.split('\\n');
    const hit = (word, problem) => { const i = lines.findIndex(l => l.includes(word)); return i < 0 ? null :
      { compiled: false, success: false, line: i + 1, column: lines[i].indexOf(word) + 1, compileProblem: problem }; };
    return hit('New_Field__c', "No such column 'New_Field__c' on entity 'Account'.")
      ?? hit('oops', "Unexpected token 'oops'.")
      ?? { compiled: true, success: true, line: -1, column: -1, compileProblem: null };
  } }; }
}
module.exports = { Connection };`;

function jsforceAt(repo, folder, version) {
  const dir = join(repo, folder);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'jsforce', version: '1.11.1', main: './index' }));
  writeFileSync(join(dir, 'index.js'), FAKE_JSFORCE);
  writeFileSync(join(dir, 'lib', 'connection.js'), `var defaults = {\n  loginUrl: "https://login.salesforce.com",\n  instanceUrl: "",\n  version: "${version}"\n};\n`);
}

/** A fresh repository with a saved development deploy target and, unless told otherwise, the pipeline packages. */
function makeRepo(name, { modules = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T']);
  writeFileSync(join(repo, '.gitignore'), '.claude/\nnode_modules/\n');
  writeFileSync(join(repo, '.claude', 'hean-harness.json'), JSON.stringify({ orgs: {
    '00D000000000001': { alias: 'dev-sandbox', username: 'dev@example.com', role: 'development', deploy: true, branch: null } } }));
  if (modules) {
    pkg(repo, RUNNER, '@store-sfdcbt-net/CICD_node-run-list-exec-lib');
    pkg(repo, UTIL, '@store-sfdcbt-net/CICD_node-jsforce-util');
    jsforceAt(repo, 'node_modules/jsforce', '42.0');
  }
  writeFileSync(join(repo, 'notes.txt'), 'one\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'base']);
  return repo;
}

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const calls = () => existsSync(CALLS) ? readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const recorded = () => existsSync(join(sandbox, 'config', 'hean-harness', 'runbook-compile'));

/** Run the hook as Claude Code does after a Write; the parsed output, or {} when silent. */
function afterWrite(repo, rel) {
  const out = execFileSync('node', [HOOK], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Write', cwd: repo, tool_input: { file_path: join(repo, rel), content: '' } }) });
  return out ? JSON.parse(out) : {};
}

/** Run the gate as Claude Code does before a Bash call; the parsed output, or {} when silent. */
function gate(repo, command) {
  const out = execFileSync('node', [HOOK], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: repo, tool_input: { command } }) });
  return out ? JSON.parse(out) : {};
}

/** The gate's refusal text, or null when allowed. */
function refusal(repo, command) {
  const o = gate(repo, command).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);

const PRE = 'runbooks/pre-deploy/apex/01_Fix_Data.apex';
const POST = 'runbooks/post-deploy/apex/02_Backfill.apex';
const GOOD = 'List<Account> accounts = [SELECT Id FROM Account LIMIT 1];\nSystem.debug(accounts);\n';
const GAP = 'Account a = new Account();\n\nSystem.debug(a.New_Field__c);\n';
const BROKEN = 'Integer i = 1;\noops\n';

console.log('Version resolution');
{
  const repo = makeRepo('versions');
  check('hoisted packages and jsforce are read', pipelineApiVersion(repo).version === '42.0', JSON.stringify(pipelineApiVersion(repo)));
  jsforceAt(repo, `${UTIL}/node_modules/jsforce`, '40.0');
  check('a jsforce nested under the hoisted jsforce-util wins over the hoisted jsforce', pipelineApiVersion(repo).version === '40.0');
  const NESTED_UTIL = `${RUNNER}/node_modules/@store-sfdcbt-net/CICD_node-jsforce-util`;
  pkg(repo, NESTED_UTIL, '@store-sfdcbt-net/CICD_node-jsforce-util');
  jsforceAt(repo, `${NESTED_UTIL}/node_modules/jsforce`, '41.0');
  const v = pipelineApiVersion(repo);
  check('the jsforce-util nested under the runner, and its own jsforce, win', v.version === '41.0' && v.source.includes(NESTED_UTIL), JSON.stringify(v));
  writeFileSync(join(repo, NESTED_UTIL, 'node_modules/jsforce/lib/connection.js'), 'module.exports = {};\n');
  has('an unknown connection module shape is an error', pipelineApiVersion(repo).error, 'shape is unknown');
  rmSync(join(repo, RUNNER), { recursive: true });
  has('a missing runner package is an error', pipelineApiVersion(repo).error, 'CICD_node-run-list-exec-lib is not installed');
  const bare = makeRepo('bare', { modules: false });
  has('no node_modules is an error', pipelineApiVersion(bare).error, 'no node_modules');
}

console.log('After a write');
{
  const repo = makeRepo('missing', { modules: false });
  write(repo, PRE, GOOD);
  const out = afterWrite(repo, PRE);
  check('missing node_modules does not block', out.decision === undefined, JSON.stringify(out));
  has('missing node_modules warns to run npm install', out.hookSpecificOutput?.additionalContext,
    'npm install', 'was not compiled; commits of it are not checked until the version can be read');
  check('missing node_modules records nothing', !recorded() && calls().length === 0);
  git(repo, 'add', '--', PRE);
  const o = gate(repo, 'git commit -m "x"');
  check('missing node_modules: the commit is allowed', o.hookSpecificOutput?.permissionDecision === undefined, JSON.stringify(o));
  has('missing node_modules: the commit warns the user', o.systemMessage, PRE, 'npm install');
  has('missing node_modules: the commit warns Claude', o.hookSpecificOutput?.additionalContext, PRE, 'npm install');
}
{
  const repo = makeRepo('target');
  writeFileSync(join(repo, '.claude', 'hean-harness.json'), '{}');
  write(repo, PRE, GOOD);
  has('no saved deploy target names org-roles', afterWrite(repo, PRE).hookSpecificOutput?.additionalContext, '/hean-harness:org-roles');
  git(repo, 'add', '--', PRE);
  has('no saved deploy target: the commit is refused', refusal(repo, 'git commit -m "x"'), PRE);
}

const repo = makeRepo('main');
write(repo, 'force-app/main/default/classes/Foo.cls', 'public class Foo {}\n');
write(repo, 'runbooks/pre-deploy/apex/readme.txt', 'x\n');
check('a force-app file is silent', JSON.stringify(afterWrite(repo, 'force-app/main/default/classes/Foo.cls')) === '{}');
check('a non-apex runbook file is silent', JSON.stringify(afterWrite(repo, 'runbooks/pre-deploy/apex/readme.txt')) === '{}');
check('no org call for non-runbook files', calls().length === 0);

write(repo, PRE, GOOD);
let out = afterWrite(repo, PRE);
check('a pass does not block', out.decision === undefined);
check('a pass is one line of context naming the org',
  out.hookSpecificOutput?.additionalContext === `${PRE} compiles at API 42.0 on dev@example.com (the pipeline's anonymous Apex version).`,
  JSON.stringify(out));
const call = calls().at(-1);
check('the compile ran at the pipeline version behind the guard',
  call?.version === '42.0' && call.body === `if (true) { return; } else {}\n${GOOD}`, JSON.stringify(call));
has('sf is asked for the saved username', readFileSync(SF_ARGS, 'utf8'), '--target-org dev@example.com');

write(repo, POST, GAP);
out = afterWrite(repo, POST);
let ctx = out.hookSpecificOutput?.additionalContext;
check('a version gap does not block', out.decision === undefined, JSON.stringify(out));
check('a version gap is context starting with "!! "', ctx?.startsWith('!! '), JSON.stringify(ctx));
has('the version gap names file, original line, problem, version and org', ctx,
  `${POST} line 3`, "No such column 'New_Field__c'", 'API 42.0', 'dev@example.com');
has('the version gap redirects to a force-app class', ctx,
  'passes `sf apex run` locally but will fail in Jenkins', 'force-app Apex class', 'test class', 'edit the script again');

write(repo, POST, BROKEN);
out = afterWrite(repo, POST);
ctx = out.hookSpecificOutput?.additionalContext;
check('another compile error does not block', out.decision === undefined, JSON.stringify(out));
has('another compile error is plain context', ctx, '!! ', `${POST} line 2`, "Unexpected token 'oops'", 'compile error in the script');
check('another compile error has no redirect', !ctx?.includes('force-app Apex class'));

console.log('Commit gate');
git(repo, 'add', '--', PRE);
check('a checked staged script is allowed', refusal(repo, 'git commit -m "x"') === null);
git(repo, 'add', '--', POST);
has('an unchecked staged script is refused', refusal(repo, 'git commit -m "x"'), POST, '--check');
check('the refusal leaves out the checked script', !refusal(repo, 'git commit -m "x"')?.includes(PRE));
git(repo, 'reset', '-q', '--', POST);
write(repo, PRE, GOOD + 'System.debug(1);\n');
git(repo, 'add', '--', PRE);
has('a script changed after its check is refused', refusal(repo, 'git commit -m "x"'), PRE);
write(repo, PRE, GOOD);
git(repo, 'add', '--', PRE);
git(repo, 'commit', '-q', '-m', 'pre');
git(repo, 'rm', '-q', '--', PRE);
check('a deleted script is allowed', refusal(repo, 'git commit -m "x"') === null);
git(repo, 'reset', '-q', '--hard');
has('stage and commit in one call, unchecked, is refused', refusal(repo, `git add -- ${POST} && git commit -m "x"`), POST);
has('commit -a with a changed unchecked script is refused',
  (write(repo, PRE, GOOD + '// changed\n'), refusal(repo, 'git commit -am "x"')), PRE);
write(repo, PRE, GOOD + '// v2\n');
afterWrite(repo, PRE);
check('stage and commit in one call of a checked script is allowed', refusal(repo, `git add -- ${PRE} && git commit -m "x"`) === null);

console.log('--check mode');
write(repo, POST, GOOD);
const run = spawnSync('node', [HOOK, '--check', join(repo, POST)], { env, encoding: 'utf8' });
check('--check exits 0 on a pass', run.status === 0, run.stderr);
has('--check reports the pass', run.stdout, `${POST} compiles at API 42.0`);
check('--check records the pass', refusal(repo, `git add -- ${POST} && git commit -m "x"`) === null);
has('git add -p and commit in one call is refused', refusal(repo, `git add -p -- ${POST} && git commit -m "x"`), 'interactively', POST);
has('git commit --patch is refused', refusal(repo, 'git commit --patch -m "x"'), 'interactively');
check('a commit message with p and i letters is not interactive', refusal(repo, `git add -- ${POST} && git commit -m "pick it"`) === null);
const bad = spawnSync('node', [HOOK, '--check', join(repo, 'notes.txt')], { env, encoding: 'utf8' });
check('--check refuses a file that is not a runbook script', bad.status === 1);

console.log('Line endings');
{
  const crlf = makeRepo('crlf');
  writeFileSync(join(crlf, '.gitattributes'), '* text=auto\n');
  git(crlf, 'add', '.gitattributes');
  git(crlf, 'commit', '-q', '-m', 'attributes');
  write(crlf, PRE, GOOD.replace(/\n/g, '\r\n'));
  has('a CRLF script compiles', afterWrite(crlf, PRE).hookSpecificOutput?.additionalContext, 'compiles at API 42.0');
  check('a CRLF script staged after its check is allowed', refusal(crlf, `git add -- ${PRE} && git commit -m "x"`) === null);
  git(crlf, 'add', '--', PRE);
  check('a CRLF script already staged is allowed', refusal(crlf, 'git commit -m "x"') === null);
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
