#!/usr/bin/env node
/**
 * Which commits the before-save triggering record update gate refuses.
 *
 * Each repository is a throwaway git repository holding flow files. HOME and
 * CLAUDE_CONFIG_DIR are throwaway folders and CLAUDE_CODE_CHILD_SESSION is
 * unset. The check needs no org.
 *
 * Run: node hooks/__tests__/flow-before-save-update-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'flow-before-save-update-gate.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'before-save-update-')));
const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A flow of the given trigger type holding one Update Records element on the triggering record. */
const flow = (trigger, element = 'Set_Status') => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <recordUpdates>
        <name>${element}</name>
        <inputReference>$Record</inputReference>
    </recordUpdates>
    <start>
        <object>Account</object>
        <triggerType>${trigger}</triggerType>
    </start>
</Flow>
`;
const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n    <start>\n        <object>Account</object>\n        <triggerType>RecordBeforeSave</triggerType>\n    </start>\n</Flow>\n`;
const BAD = flow('RecordBeforeSave');
const PATH = 'force-app/main/default/flows/Account_Before_Save.flow-meta.xml';

function makeRepo(name) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  write(repo, 'sfdx-project.json', '{}\n');
  write(repo, PATH, PLAIN);
  write(repo, 'notes.txt', 'one\n');
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
const REFUSED = '!! This commit adds an Update Records element on the triggering record to a record-triggered before-save flow';
const NOT_RUN = '!! The before-save triggering record update check did not run';
let r;

const repo = makeRepo('main');

console.log('Refused');
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
has('a staged before-save Update Records on $Record is refused', r.deny, REFUSED, `${PATH}: Set_Status`, 'Assignment element', 'Then retry the commit.');
reset(repo);
write(repo, PATH, BAD);
has('git add and commit in one call is refused', hook(repo, `git add -- ${PATH} && git commit -m "x"`).deny, REFUSED, PATH);
reset(repo);
write(repo, PATH, BAD);
has('commit -a with a changed tracked flow is refused', hook(repo, 'git commit -am "x"').deny, PATH);
reset(repo);

console.log('Allowed');
write(repo, PATH, flow('RecordAfterSave'));
git(repo, 'add', '--', PATH);
check('an after-save flow is silent', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, PATH, BAD);
check('an unstaged bad flow is not part of the commit', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
check('a command that is not a commit is silent', silent(hook(repo, 'git status')));
write(repo, 'bad/Old.flow-meta.xml', BAD);
git(repo, 'add', '--', 'bad/Old.flow-meta.xml');
git(repo, 'commit', '-q', '-m', 'bad flow already recorded');
git(repo, 'rm', '-q', '--', 'bad/Old.flow-meta.xml');
check('deleting a flow is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);

console.log('Unknown');
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'does not name');
has('... that Claude sees too', r.context, NOT_RUN);
reset(repo);

console.log('A repository that is not SFDX');
{
  const plain = makeRepo('plain');
  git(plain, 'rm', '-q', '--', 'sfdx-project.json');
  git(plain, 'commit', '-q', '-m', 'not sfdx');
  write(plain, PATH, BAD);
  git(plain, 'add', '--', PATH);
  r = hook(plain, 'git commit -m "x"');
  check('a bad flow in a repository without sfdx-project.json is not refused and prints nothing', silent(r) && r.context === null, JSON.stringify(r));
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
