#!/usr/bin/env node
/**
 * What the commit message gate must let through, and what it must stop.
 * Also checks that the git hook setup installs accepts and refuses the same
 * subjects, since the two carry the pattern separately.
 *
 * Run: node hooks/__tests__/commit-message-gate.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SUBJECT } from '../commit-message-gate.mjs';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'commit-message-gate.mjs');
const GIT_HOOK = join(dirname(HOOKS), 'assets', 'githooks', 'commit-msg');

// One repository per saved commit format answer, plus one where setup never ran.
const sandbox = mkdtempSync(join(tmpdir(), 'gate-'));
const repoWith = (name, choice) => {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  if (choice) writeFileSync(join(repo, '.claude', 'hean-harness.json'), JSON.stringify({ commitFormat: choice }));
  return repo;
};
const ON = repoWith('on', 'on');
const OFF = repoWith('off', 'off');
const NONE = repoWith('none', null);
const NOT_A_REPO = mkdtempSync(join(tmpdir(), 'gate-plain-'));

/** Run the hook exactly as Claude Code does, and say whether it denied. */
function denied(command, cwd = ON) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8'
  });
  if (!out.trim()) return false;
  return JSON.parse(out).hookSpecificOutput?.permissionDecision === 'deny';
}

const ALLOW = [
  ['plain, correct',            `git commit -m "@ABC-123: Add the dedupe check"`],
  ['two-letter suffix',         `git commit -m "@ABC-123-UK: Add the dedupe check"`],
  ['long numeric id',           `git commit -m "@W-22028215: Fix the null territory"`],
  ['Sonar tag',                 `git commit -m "@ABC-123: [Sonar] Remove the unused variable"`],
  ['Sonar tag with suffix',     `git commit -m "@ABC-123-UK: [Sonar] Remove the unused variable"`],
  ['single quotes',             `git commit -m '@ABC-1: Update the layout'`],
  ['--message',                 `git commit --message "@ABC-1: Update the layout"`],
  ['--message=',                `git commit --message="@ABC-1: Update the layout"`],
  ['bundled -am',               `git commit -am "@ABC-1: Update the layout"`],
  ['amend with a message',      `git commit --amend -m "@ABC-1: Update the layout"`],
  ['body after the subject',    `git commit -m "@ABC-1: Update the layout\n\n- one\n- two"`],
  ['second -m is the body',     `git commit -m "@ABC-1: Update the layout" -m "free text here"`],
  ['staged then committed',     `git add -A && git commit -m "@ABC-1: Update the layout"`],

  ['no message at all',         `git commit`],
  ['opens an editor',           `git commit --amend`],
  ['reads a file',              `git commit -F /tmp/msg.txt`],
  ['reuses a message',          `git commit -C HEAD`],
  ['keeps the old message',     `git commit --amend --no-edit`],
  ['not a commit',              `git log --grep "fix the thing"`],
  ['prints the words',          `echo "run git commit -m 'whatever you like'"`],
  ['a commit in a comment',     `# git commit -m "whatever you like"\ngit status`],
  ['another tool entirely',     `npx jest path/to/thing.test.js`],
  ['empty command',             ``]
];

const DENY = [
  ['no work item',              `git commit -m "Add the dedupe check"`],
  ['no @ sigil',                `git commit -m "ABC-123: Add the dedupe check"`],
  ['lowercase first letter',    `git commit -m "@ABC-123: add the dedupe check"`],
  ['no space after the colon',  `git commit -m "@ABC-123:Add the dedupe check"`],
  ['no colon',                  `git commit -m "@ABC-123 Add the dedupe check"`],
  ['lowercase work id',         `git commit -m "@abc-123: Add the dedupe check"`],
  ['three-letter suffix',       `git commit -m "@ABC-123-UKX: Add the dedupe check"`],
  ['lowercase suffix',          `git commit -m "@ABC-123-uk: Add the dedupe check"`],
  ['no number',                 `git commit -m "@ABC: Add the dedupe check"`],
  ['empty subject',             `git commit -m ""`],
  ['a tag before the id',       `git commit -m "[Sonar] @ABC-123: Add the check"`],
  ['Sonar tag, lowercase',      `git commit -m "@ABC-123: [Sonar] remove the variable"`],
  ['Sonar tag, no space after', `git commit -m "@ABC-123: [Sonar]Remove the variable"`],
  ['lowercase Sonar tag',       `git commit -m "@ABC-123: [sonar] Remove the variable"`],
  ['bad subject, good body',    `git commit -m "add the check\n\n@ABC-123: Add the check"`],
  ['bundled -am, bad subject',  `git commit -am "add the dedupe check"`],
  ['second command is bad',     `git add -A && git commit -m "wip"`],
  ['amend to a bad subject',    `git commit --amend -m "wip"`],
  ['--message=, bad subject',   `git commit --message="wip"`]
];

let pass = 0, fail = 0;
const check = (label, expectDeny, command, cwd) => {
  const got = denied(command, cwd);
  const ok = got === expectDeny;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}\n        ${JSON.stringify(command)}\n        expected ${expectDeny ? 'deny' : 'allow'}, got ${got ? 'deny' : 'allow'}`);
};

console.log('Allowed');
for (const [label, cmd] of ALLOW) check(label, false, cmd);
console.log('Denied');
for (const [label, cmd] of DENY) check(label, true, cmd);

console.log('Switch');
const BAD = `git commit -m "Add the dedupe check"`;
check('format switched off', false, BAD, OFF);
check('setup never asked here', false, BAD, NONE);
check('not a repository', false, BAD, NOT_A_REPO);
check('format switched on', true, BAD, ON);

// The repository checked is the one the commit goes to, not the session's folder.
console.log('Target repository');
const B = `commit -m "Add the dedupe check"`;
check('cd into an unenrolled repo',        false, `cd ${NONE} && git ${B}`, ON);
check('cd into an enrolled repo',          true,  `cd ${ON} && git ${B}`, NONE);
check('relative cd',                       true,  `cd ../on && git ${B}`, NONE);
check('git -C an enrolled repo',           true,  `git -C ${ON} ${B}`, NONE);
check('git -C an unenrolled repo',         false, `git -C ${NONE} ${B}`, ON);
check('git -C twice, relative',            true,  `git -C ${sandbox} -C on ${B}`, NONE);
check('git -c before commit',              true,  `git -c user.name=x ${B}`, ON);
check('--git-dir of an enrolled repo',     true,  `git --git-dir=${ON}/.git ${B}`, NONE);
check('--work-tree of an unenrolled repo', false, `git --work-tree=${NONE} --git-dir=${NONE}/.git ${B}`, ON);
check('cd inside a subshell ends there',   true,  `(cd ${NONE} && git status) && git ${B}`, ON);
check('cd to a variable falls back',       true,  `cd "$X" && git ${B}`, ON);
check('two commits, second is enrolled',   true,  `git -C ${NONE} ${B} && git -C ${ON} ${B}`, OFF);
check('good subject in an enrolled repo',  false, `cd ${ON} && git commit -m "@ABC-1: Update the layout"`, NONE);
rmSync(sandbox, { recursive: true, force: true });
rmSync(NOT_A_REPO, { recursive: true, force: true });

// The git hook reads the message from a file. The subject is its first line.
const SUBJECTS = [
  '@ABC-123: Add the dedupe check',
  '@ABC-123-UK: Add the dedupe check',
  '@ABC-123: [Sonar] Remove the unused variable',
  'Add the dedupe check',
  '@ABC-123: add the dedupe check',
  '@ABC-123:Add the dedupe check',
  '@ABC-123-UKX: Add the dedupe check',
  '[Sonar] @ABC-123: Add the check',
  '@ABC-123: [Sonar] remove the variable',
  '@ABC-123: [sonar] Remove the variable',
  'add the check\n\n@ABC-123: Add the check'
];
console.log('Git hook matches the gate');
const dir = mkdtempSync(join(tmpdir(), 'hean-commit-msg-'));
try {
  for (const msg of SUBJECTS) {
    const file = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(file, msg + '\n');
    const hookDenied = spawnSync('sh', [GIT_HOOK, file], { stdio: 'ignore' }).status !== 0;
    const gateDenied = !SUBJECT.test(msg.split('\n')[0]);
    const ok = hookDenied === gateDenied;
    ok ? pass++ : fail++;
    if (!ok) console.log(`  FAIL  ${JSON.stringify(msg)}\n        gate ${gateDenied ? 'denies' : 'allows'}, git hook ${hookDenied ? 'denies' : 'allows'}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
