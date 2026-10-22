#!/usr/bin/env node
/**
 * Which commits the feature toggle gate refuses.
 *
 * Each repository is a throwaway git repository holding flow files. HOME and
 * CLAUDE_CONFIG_DIR are throwaway folders and CLAUDE_CODE_CHILD_SESSION is
 * unset. The org is never called: a stub `sf` first on PATH answers the two
 * package queries from a file and logs every call.
 *
 * Run: node hooks/__tests__/flow-feature-toggle-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'flow-feature-toggle-gate.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'feature-toggle-')));
const bin = join(sandbox, 'bin');
const calls = join(sandbox, 'sf-calls.log');
const answer = join(sandbox, 'sf-answer');
mkdirSync(bin);
// The stub answers every query with one row when the answer file says "yes", with a failure when it says "fail", otherwise with none
writeFileSync(join(bin, 'sf'), `#!/bin/sh
echo "$*" >> "${calls}"
a=$(cat "${answer}" 2>/dev/null)
if [ "$a" = fail ]; then echo '{"message":"org unreachable"}'; exit 1; fi
if [ "$a" = yes ]; then echo '{"result":{"records":[{"Id":"1"}]}}'; else echo '{"result":{"records":[]}}'; fi
`);
chmodSync(join(bin, 'sf'), 0o755);

const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${bin}:${process.env.PATH}` };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const setAnswer = a => writeFileSync(answer, a);
const queries = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0);
const forgetCache = () => rmSync(join(env.CLAUDE_CONFIG_DIR, 'hean-harness', 'feature-toggle-package'), { recursive: true, force: true });

/** A flow of the given trigger type holding one Get Records on the toggle type. */
const flow = (trigger, extraRead = '') => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <recordLookups>
        <name>Get_Toggle</name>
        <object>Feature_Toggle__mdt</object>
    </recordLookups>${extraRead}
    <start>
        <triggerType>${trigger}</triggerType>
    </start>
</Flow>
`;
const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n    <start>\n        <triggerType>RecordAfterSave</triggerType>\n    </start>\n</Flow>\n`;
const BAD = flow('RecordAfterSave');
const PATH = 'force-app/main/default/flows/Sample.flow-meta.xml';

function makeRepo(name, { roles = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  write(repo, 'sfdx-project.json', '{}\n');
  write(repo, PATH, PLAIN);
  write(repo, 'notes.txt', 'one\n');
  if (roles) {
    write(repo, '.claude/hean-harness.json', JSON.stringify({ orgs: { '00DXX0000000001': { alias: 'dev', username: 'dev@example.com.dev', role: 'development', deploy: true, branch: null } } }));
    write(repo, '.gitignore', '.claude/\n');
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}
const reset = repo => { git(repo, 'reset', '-q', '--hard'); git(repo, 'clean', '-qfd'); };

/** Run the hook as Claude Code does before a Bash call: { deny, warn, context }, each null when absent. */
function hook(cwd, command) {
  const out = execFileSync(process.execPath, [HOOK], { env, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'test', cwd, tool_input: { command } }) });
  const o = out.trim() ? JSON.parse(out) : {};
  return {
    deny: o.hookSpecificOutput?.permissionDecision === 'deny' ? o.hookSpecificOutput.permissionDecisionReason : null,
    warn: o.systemMessage ?? null,
    context: o.hookSpecificOutput?.additionalContext ?? null
  };
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;
const REFUSED = '!! This commit adds Get Records reads of feature toggles that break the flow rule';
const NOT_RUN = '!! The feature toggle check did not run';
let r;

const repo = makeRepo('main');

console.log('Package installed');
setAnswer('yes');
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
has('a staged Get Records on the toggle type outside before-save is refused', r.deny, REFUSED, `${PATH}: Get_Toggle: Get Records on Feature_Toggle__mdt outside a before-save flow`, 'Then retry the commit.');
check('the org was asked', queries() === 2, String(queries()));
reset(repo);
write(repo, PATH, BAD);
has('git add and commit in one call is refused', hook(repo, `git add -- ${PATH} && git commit -m "x"`).deny, REFUSED, PATH);
reset(repo);
write(repo, PATH, BAD);
has('commit -a with a changed tracked flow is refused', hook(repo, 'git commit -am "x"').deny, PATH);
git(repo, 'add', '--', PATH);
has('a commit through git -C from another folder is refused', hook(sandbox, `git -C ${repo} commit -m "x"`).deny, PATH);
reset(repo);
write(repo, PATH, flow('RecordBeforeSave'));
git(repo, 'add', '--', PATH);
check('one Get Records in a before-save flow is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);

write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
const afterFirst = queries();
check('a second commit with a finding is refused again', hook(repo, 'git commit -m "x"').deny !== null);
check('... from the cache, with no further org query', queries() === afterFirst, `${afterFirst} -> ${queries()}`);
reset(repo);

console.log('Package not installed');
setAnswer('no');
forgetCache();
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
check('a finding is allowed silently when the package is not installed', silent(r) && r.context === null, JSON.stringify(r));
reset(repo);

console.log('Unknown');
setAnswer('fail');
forgetCache();
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
check('a failed org query allows the commit', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'org unreachable');
has('... that Claude sees too', r.context, NOT_RUN);
reset(repo);
{
  const noRoles = makeRepo('noroles', { roles: false });
  write(noRoles, PATH, BAD);
  git(noRoles, 'add', '--', PATH);
  r = hook(noRoles, 'git commit -m "x"');
  has('no saved deploy target allows the commit with a !! line', r.warn, NOT_RUN, 'no development deploy target');
  check('... without a refusal', r.deny === null);
}
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'does not name');
reset(repo);

console.log('No finding, no org query');
setAnswer('yes');
forgetCache();
const before = queries();
write(repo, PATH, PLAIN.replace('RecordAfterSave', 'Scheduled'));
git(repo, 'add', '--', PATH);
check('a flow with no toggle read is silent', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, PATH, BAD);
check('an unstaged bad flow is not part of the commit', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
check('a command that is not a commit is silent', silent(hook(repo, 'git status')));
git(repo, 'commit', '-q', '--allow-empty', '-m', 'noop');
write(repo, 'bad/Old.flow-meta.xml', BAD);
git(repo, 'add', '--', 'bad/Old.flow-meta.xml');
git(repo, 'commit', '-q', '-m', 'bad flow already recorded');
git(repo, 'rm', '-q', '--', 'bad/Old.flow-meta.xml');
check('deleting a flow is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
check('none of these asked the org', queries() === before, `${before} -> ${queries()}`);

console.log('A repository that is not SFDX');
{
  const plain = makeRepo('plain');
  git(plain, 'rm', '-q', '--', 'sfdx-project.json');
  git(plain, 'commit', '-q', '-m', 'not sfdx');
  write(plain, PATH, BAD);
  git(plain, 'add', '--', PATH);
  const q = queries();
  r = hook(plain, 'git commit -m "x"');
  check('a bad flow in a repository without sfdx-project.json is not refused and prints nothing', silent(r) && r.context === null, JSON.stringify(r));
  check('... and the org is not asked', queries() === q);
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
