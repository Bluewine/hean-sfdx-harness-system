#!/usr/bin/env node
/**
 * What the commit message gate must let through, and what it must stop.
 *
 * Run: node hooks/__tests__/commit-message-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(dirname(fileURLToPath(import.meta.url))), 'commit-message-gate.mjs');

/** Run the hook exactly as Claude Code does, and say whether it denied. */
function denied(command) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8'
  });
  if (!out.trim()) return false;
  return JSON.parse(out).hookSpecificOutput?.permissionDecision === 'deny';
}

const ALLOW = [
  ['plain, correct',            `git commit -m "@ABC-123: Add the dedupe check"`],
  ['two-letter suffix',         `git commit -m "@ABC-123-UK: Add the dedupe check"`],
  ['long numeric id',           `git commit -m "@W-22028215: Fix the null territory"`],
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
  ['bad subject, good body',    `git commit -m "add the check\n\n@ABC-123: Add the check"`],
  ['bundled -am, bad subject',  `git commit -am "add the dedupe check"`],
  ['second command is bad',     `git add -A && git commit -m "wip"`],
  ['amend to a bad subject',    `git commit --amend -m "wip"`],
  ['--message=, bad subject',   `git commit --message="wip"`]
];

let pass = 0, fail = 0;
const check = (label, expectDeny, command) => {
  const got = denied(command);
  const ok = got === expectDeny;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}\n        ${JSON.stringify(command)}\n        expected ${expectDeny ? 'deny' : 'allow'}, got ${got ? 'deny' : 'allow'}`);
};

console.log('Allowed');
for (const [label, cmd] of ALLOW) check(label, false, cmd);
console.log('Denied');
for (const [label, cmd] of DENY) check(label, true, cmd);

console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
