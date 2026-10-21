#!/usr/bin/env node
/**
 * Which commits the Collection Filter gate refuses.
 *
 * Each repository is a throwaway git repository holding flow files with a
 * FilterCollectionProcessor. HOME and CLAUDE_CONFIG_DIR are throwaway folders
 * and CLAUDE_CODE_CHILD_SESSION is unset. No sf is called.
 *
 * Run: node hooks/__tests__/flow-collection-filter-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'flow-collection-filter-gate.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'collection-filter-')));
const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A flow with one Collection Filter whose single condition has the given left side. */
const flow = left => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <collectionProcessors>
        <name>Sample_Filter</name>
        <collectionProcessorType>FilterCollectionProcessor</collectionProcessorType>
        <assignNextValueToReference>currentItem_Sample_Filter</assignNextValueToReference>
        <collectionReference>items</collectionReference>
        <conditionLogic>and</conditionLogic>
        <conditions>
            <leftValueReference>${left}</leftValueReference>
            <operator>EqualTo</operator>
            <rightValue>
                <stringValue>x</stringValue>
            </rightValue>
        </conditions>
    </collectionProcessors>
</Flow>
`;
const GOOD = flow('currentItem_Sample_Filter.Status');
const BAD = flow('myVariable');
const PATH = 'force-app/main/default/flows/Sample.flow-meta.xml';

function makeRepo(name) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  write(repo, 'sfdx-project.json', '{}\n');
  write(repo, PATH, GOOD);
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
const REFUSED = '!! This commit records Collection Filter conditions Flow Builder cannot display';
const NOT_RUN = '!! The Collection Filter check did not run';
let r;

console.log('Refused');
const repo = makeRepo('main');
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
has('a staged flow with a bad left side is refused', r.deny, REFUSED, `${PATH}: Sample_Filter: left side \`myVariable\`, expected \`currentItem_Sample_Filter\` or \`currentItem_Sample_Filter.<Field>\``, 'Then retry the commit.');
reset(repo);
write(repo, PATH, BAD);
has('git add and commit in one call is refused', hook(repo, `git add -- ${PATH} && git commit -m "x"`).deny, REFUSED, PATH);
reset(repo);
write(repo, PATH, BAD);
has('commit -a with a changed tracked flow is refused', hook(repo, 'git commit -am "x"').deny, PATH);
has('a commit by path naming it is refused', hook(repo, `git commit -m "x" -- ${PATH}`).deny, PATH);
write(repo, 'notes.txt', 'two\n');
git(repo, 'add', '--', PATH);
check('a commit by path of other files leaves the staged flow out', silent(hook(repo, 'git commit -m "x" -- notes.txt')));
reset(repo);
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
has('a commit through git -C from another folder is refused', hook(sandbox, `git -C ${repo} commit -m "x"`).deny, PATH);
reset(repo);
write(repo, PATH, GOOD);
git(repo, 'add', '--', PATH);
write(repo, PATH, BAD);
check('the staged content is checked, not the working tree', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, 'other/Extra.flow-meta.xml', BAD);
git(repo, 'add', '--', 'other/Extra.flow-meta.xml');
has('a flow in any folder is checked', hook(repo, 'git commit -m "x"').deny, 'other/Extra.flow-meta.xml');
reset(repo);
write(repo, PATH, BAD.replace('<collectionProcessors>', `<description>${'x'.repeat(2 * 1024 * 1024)}</description>\n    <collectionProcessors>`));
git(repo, 'add', '--', PATH);
has('a staged flow over 1 MiB is checked', hook(repo, 'git commit -m "x"').deny, REFUSED, PATH);
reset(repo);

console.log('Allowed');
write(repo, PATH, flow('currentItem_Sample_Filter.Name'));
git(repo, 'add', '--', PATH);
r = hook(repo, 'git commit -m "x"');
check('a good flow is allowed', silent(r), JSON.stringify(r));
reset(repo);
write(repo, PATH, BAD);
check('an unstaged bad flow is not part of the commit', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
check('a command that is not a commit is silent', silent(hook(repo, 'git status')));
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
check('a dry run is not checked', silent(hook(repo, 'git commit --dry-run -m "x"')));
reset(repo);
git(repo, 'commit', '-q', '--allow-empty', '-m', 'noop');
write(repo, 'bad/Old.flow-meta.xml', BAD);
git(repo, 'add', '--', 'bad/Old.flow-meta.xml');
git(repo, 'commit', '-q', '-m', 'bad flow already recorded');
git(repo, 'rm', '-q', '--', 'bad/Old.flow-meta.xml');
check('deleting a bad flow is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);

console.log('Not checked');
write(repo, PATH, BAD);
git(repo, 'add', '--', PATH);
r = hook(repo, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'does not name');
has('... that Claude sees too', r.context, NOT_RUN);
reset(repo);
git(repo, 'checkout', '-q', '-b', 'other');
write(repo, PATH, BAD);
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'other');
git(repo, 'checkout', '-q', 'integration');
git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'other');
check('a merge in progress is not checked', silent(hook(repo, 'git commit -m "x"')));
git(repo, 'merge', '--abort');

console.log('A first commit');
{
  const fresh = join(sandbox, 'fresh');
  mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'integration');
  write(fresh, 'sfdx-project.json', '{}\n');
  write(fresh, PATH, BAD);
  git(fresh, 'add', '-A');
  has('a first commit is checked', hook(fresh, 'git commit -m "x"').deny, REFUSED, PATH);
}

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
