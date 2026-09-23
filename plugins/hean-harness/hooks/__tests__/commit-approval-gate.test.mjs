#!/usr/bin/env node
/**
 * What the commit approval gate must let through, and what it must stop, as
 * the user types messages, lifecycle skills run and implementation runs start
 * and finish. Also checks that finishing a "no commits" subagent-driven run
 * undoes its commits and keeps every change.
 *
 * Every run uses a throwaway CLAUDE_CONFIG_DIR for the session state, and
 * throwaway git repositories.
 *
 * Run: node hooks/__tests__/commit-approval-gate.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE = join(HOOKS, 'commit-approval-gate.mjs');
const EVENTS = join(HOOKS, 'commit-lifecycle-events.mjs');
const FINISH = join(dirname(HOOKS), 'scripts', 'implementation-run.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'commit-gate-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env }).trim();

const repo = name => {
  const r = join(sandbox, name);
  mkdirSync(r);
  git(r, 'init', '-q', '-b', 'work-ABC-1');
  git(r, 'config', 'user.email', 't@example.com');
  git(r, 'config', 'user.name', 'T');
  writeFileSync(join(r, 'base.txt'), 'base\n');
  git(r, 'add', '.');
  git(r, 'commit', '-q', '-m', 'base');
  return r;
};
const A = repo('a');
const B = repo('b');

let session = 0;
const newSession = () => `s${++session}`;

const event = (sid, payload, cwd = A) => execFileSync('node', [EVENTS], {
  input: JSON.stringify({ session_id: sid, cwd, ...payload }), encoding: 'utf8', env
});
const prompt = (sid, text) => event(sid, { hook_event_name: 'UserPromptSubmit', prompt: text });
const skill = (sid, name) => event(sid, { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: name } });
const answer = (sid, mode, commits, cwd = A) => event(sid, {
  hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_response: {
    questions: [
      { question: 'Which development mode should implementation use?', header: 'Dev mode', options: [] },
      { question: 'Commit after each task?', header: 'Commits', options: [] }
    ],
    answers: { 'Which development mode should implementation use?': mode, 'Commit after each task?': commits }
  }
}, cwd);

/** Run the gate exactly as Claude Code does; the refusal text, or null when allowed. */
function refusal(sid, command, cwd = A) {
  const out = execFileSync('node', [GATE], {
    input: JSON.stringify({ session_id: sid, tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env
  });
  if (!out.trim()) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

let pass = 0, fail = 0;
const expect = (label, ok, detail = '') => { ok ? pass++ : (fail++, console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)); };
const allowed = (label, sid, command, cwd) => { const r = refusal(sid, command, cwd); expect(label, r === null, `refused: ${r}`); };
const refused = (label, sid, command, cwd, text = '') => { const r = refusal(sid, command, cwd); expect(label, r !== null && r.includes(text), `got: ${r}`); };

const COMMIT = 'git commit -m "@ABC-1: Add the thing"';

console.log('Approval by typed message');
let s = newSession();
refused('no approval, no run', s, COMMIT, A, '/hean-harness:commit');
allowed('status is never checked', s, 'git status && git diff');
allowed('push with no run', s, 'git push origin work-ABC-1');
prompt(s, "don't commit yet, let me look");
refused('"commit" in a message is not approval', s, COMMIT);
prompt(s, '/hean-harness:commit the org roles change');
allowed('typed /hean-harness:commit', s, COMMIT);
allowed('cd into the repository first', s, `cd ${A} && ${COMMIT}`, sandbox);
prompt(s, '<task-notification>\n<task-id>x</task-id>\n</task-notification>');
allowed('a task notification keeps the approval', s, COMMIT);
prompt(s, 'Another Claude session sent a message:\n<cross-session-message from="x" from-name="fs">hi</cross-session-message>');
allowed('a peer session message keeps the approval', s, COMMIT);
prompt(s, 'thanks, now look at the next thing');
refused('the next user message ends the approval', s, COMMIT);
skill(s, 'hean-harness:commit');
refused('the model starting the commit skill grants nothing', s, COMMIT);

console.log('Lifecycle skills');
s = newSession();
skill(s, 'hean-harness:version-bump');
allowed('version-bump started by the model', s, COMMIT);
skill(s, 'superpowers:writing-plans');
allowed('another skill in the same turn keeps it', s, COMMIT);
prompt(s, 'ok');
refused('next message ends it', s, COMMIT);
prompt(s, '/hean-harness:uat-hotfix');
allowed('uat-hotfix typed by the user', s, COMMIT);

console.log('Implementation runs');
s = newSession();
answer(s, 'Main session', 'No commits');
refused('main session, no commits', s, COMMIT, A, 'no commits');
prompt(s, '/hean-harness:commit');
allowed('typed approval still works inside that run', s, COMMIT);

s = newSession();
answer(s, 'Main session', 'Commit per task');
allowed('main session, commit per task', s, COMMIT);
refused('the run covers only its own repository', s, COMMIT, B);

s = newSession();
answer(s, 'Subagent-driven (Recommended)', 'Commit per task');
allowed('subagent-driven, commit per task', s, COMMIT);
allowed('push is not held back when commits stay', s, 'git push');

s = newSession();
event(s, { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
           tool_response: { questions: [{ question: 'Pick one', header: 'Other' }], answers: { 'Pick one': 'x' } } });
refused('an unrelated question starts no run', s, COMMIT);

console.log('Subagent-driven, no commits');
s = newSession();
const note = answer(s, 'Subagent-driven', 'No commits');
expect('the model is told the run started', note.includes('Implementation run recorded'), note);
const base = git(A, 'rev-parse', 'HEAD');
allowed('per-task commits are allowed', s, COMMIT);
refused('push is held back until the undo', s, 'git push origin work-ABC-1', A, 'finish-implementation');
refused('reset --hard is held back', s, 'git reset --hard HEAD~1', A, 'finish-implementation');
allowed('reset --soft is not', s, 'git reset --soft HEAD~1');
writeFileSync(join(A, 'task1.txt'), 'one\n'); git(A, 'add', '.'); git(A, 'commit', '-q', '-m', 'task 1');
writeFileSync(join(A, 'task2.txt'), 'two\n'); git(A, 'add', '.'); git(A, 'commit', '-q', '-m', 'task 2');
const tasksHead = git(A, 'rev-parse', 'HEAD');

git(A, 'checkout', '-q', '-b', 'elsewhere');
const wrongBranch = spawnSync('node', [FINISH, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish on another branch refuses', wrongBranch.status === 1 && git(A, 'rev-parse', 'HEAD') === tasksHead, wrongBranch.stdout);
git(A, 'checkout', '-q', 'work-ABC-1');

const done = spawnSync('node', [FINISH, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish exits 0', done.status === 0, done.stdout + done.stderr);
expect('the branch is back at the run start', git(A, 'rev-parse', 'HEAD') === base);
expect('both task files are still there', existsSync(join(A, 'task1.txt')) && existsSync(join(A, 'task2.txt')));
expect('nothing is staged', git(A, 'diff', '--cached', '--name-only') === '');
expect('the undone commits are listed', done.stdout.includes('task 1') && done.stdout.includes('task 2'), done.stdout);
expect('the reflog line names the old head', done.stdout.includes(tasksHead), done.stdout);
allowed('push is allowed once the run is finished', s, 'git push origin work-ABC-1');
refused('commit needs approval again', s, COMMIT);
const again = spawnSync('node', [FINISH, 'finish', '--session', s], { encoding: 'utf8', env });
expect('a second finish does nothing', again.status === 0 && again.stdout.includes('No implementation run'), again.stdout);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
