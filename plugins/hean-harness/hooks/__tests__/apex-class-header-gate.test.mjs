#!/usr/bin/env node
/**
 * Which commits the Apex class header gate refuses.
 *
 * Each repository is a throwaway git repository holding Apex classes. HOME and
 * CLAUDE_CONFIG_DIR are throwaway folders and CLAUDE_CODE_CHILD_SESSION is
 * unset. The gate makes no org call.
 *
 * Run: node hooks/__tests__/apex-class-header-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'apex-class-header-gate.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'apex-header-')));
const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const cls = (tags, name = 'Sample') => `/**\n * Does the work.\n *${tags.map(t => `\n * ${t}`).join('')}\n */\npublic with sharing class ${name} {\n}\n`;
const OLD = cls(['@since 2025-01-01 ABC-1']);
const CHANGED = cls(['@since 2025-01-01 ABC-1', '@changes 2026-10-22 ABC-123: Added a method']);
const NEW_GOOD = cls(['@since 2026-10-22 ABC-123']);
const NEW_BAD = cls(['Initial setup']);
const PATH = 'force-app/main/default/classes/Sample.cls';
const FRESH = 'force-app/main/default/classes/Fresh.cls';

function makeRepo(name, { branch = 'work-ABC-123', sfdx = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', branch);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  if (sfdx) write(repo, 'sfdx-project.json', '{}\n');
  write(repo, PATH, OLD);
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
const REFUSED = '!! This commit changes Apex classes whose class comment does not follow "Class header"';
let r;

const repo = makeRepo('main');

console.log('New class');
write(repo, FRESH, NEW_BAD);
git(repo, 'add', '--', FRESH);
has('a new class with no @since and "Initial setup" is refused', hook(repo, 'git commit -m "x"').deny, REFUSED, `${FRESH}: no "@since <date> ABC-123"`, '"Initial setup" in the class comment', 'Then retry the commit.');
write(repo, FRESH, NEW_GOOD);
git(repo, 'add', '--', FRESH);
check('a new class ending with @since for the branch story is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, FRESH, NEW_BAD);
has('git add and commit in one call is refused', hook(repo, `git add -- ${FRESH} && git commit -m "x"`).deny, REFUSED, FRESH);
reset(repo);

console.log('Edited class');
write(repo, PATH, OLD + '// edit\n');
git(repo, 'add', '--', PATH);
has('an edited class with no @changes line is refused', hook(repo, 'git commit -m "x"').deny, REFUSED, `${PATH}: no "@changes <date> ABC-123: …" line`);
has('commit -a with a changed tracked class is refused', hook(repo, 'git commit -am "x"').deny, PATH);
has('a commit through git -C from another folder is refused', hook(sandbox, `git -C ${repo} commit -m "x"`).deny, PATH);
write(repo, PATH, CHANGED);
git(repo, 'add', '--', PATH);
check('an edited class with a @changes line for the story is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, PATH, cls(['@since 2025-01-01 ABC-1', ...Array.from({ length: 6 }, (_, i) => `@changes 2026-10-0${i + 1} ABC-123: Step ${i}`)]));
git(repo, 'add', '--', PATH);
has('more than 5 @changes lines is refused', hook(repo, 'git commit -m "x"').deny, REFUSED, '6 @changes lines (at most 5)');
reset(repo);

console.log('Not checked');
write(repo, PATH, OLD + '// edit\n');
check('an unstaged bad class is not part of the commit', silent(hook(repo, 'git commit -m "x"')));
check('a command that is not a commit is silent', silent(hook(repo, 'git status')));
reset(repo);
write(repo, 'runbook/Script.cls', NEW_BAD);
git(repo, 'add', '--', 'runbook/Script.cls');
check('a runbook class outside force-app is ignored', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
git(repo, 'rm', '-q', '--', PATH);
check('deleting a class is allowed', silent(hook(repo, 'git commit -m "x"')));
reset(repo);
write(repo, PATH, OLD + '// edit\n');
git(repo, 'add', '--', PATH);
r = hook(repo, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, '!! The Apex class header check did not run', 'does not name');
reset(repo);

console.log('A branch with no work ID');
{
  const plain = makeRepo('nowork', { branch: 'integration' });
  write(plain, FRESH, NEW_BAD);
  git(plain, 'add', '--', FRESH);
  r = hook(plain, 'git commit -m "x"');
  check('a bad class on a branch with no work ID is not refused and prints nothing', silent(r) && r.context === null, JSON.stringify(r));
}

console.log('A repository that is not SFDX');
{
  const plain = makeRepo('plain', { sfdx: false });
  write(plain, FRESH, NEW_BAD);
  git(plain, 'add', '--', FRESH);
  r = hook(plain, 'git commit -m "x"');
  check('a bad class in a repository without sfdx-project.json is not refused and prints nothing', silent(r) && r.context === null, JSON.stringify(r));
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
