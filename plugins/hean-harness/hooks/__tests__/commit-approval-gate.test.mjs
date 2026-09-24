/**
 * What the commit approval gate must let through, and what it must stop, as
 * the saved machine-wide implementation preference is set and changed, the
 * user types messages, and implementation runs start and finish. Also checks
 * that finishing a "no commits" subagent-driven run undoes its commits and
 * keeps every change.
 *
 * Every run uses a throwaway CLAUDE_CONFIG_DIR for the preference file and
 * the session state, and throwaway git repositories.
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
const RUN_SCRIPT = join(dirname(HOOKS), 'scripts', 'implementation-run.mjs');

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
/** Answer only one of the two implementation questions. */
const answerOne = (sid, field, label, cwd = A) => {
  const question = field === 'mode' ? 'Which development mode should implementation use?' : 'Commit after each task?';
  const header = field === 'mode' ? 'Dev mode' : 'Commits';
  return event(sid, {
    hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_response: { questions: [{ question, header, options: [] }], answers: { [question]: label } }
  }, cwd);
};

const run = (args, cwd = sandbox) => spawnSync('node', [RUN_SCRIPT, ...args], { encoding: 'utf8', env, cwd });
const clearPreference = () => run(['preference', 'clear']);

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

console.log('No preference saved');
let s = newSession();
refused('no preference refuses a commit', s, COMMIT, A, 'No implementation preference is saved');
allowed('status is never checked', s, 'git status && git diff');
allowed('push with no preference and no run', s, 'git push origin work-ABC-1');

console.log('First answers save the preference and start the run');
s = newSession();
const firstNote = answer(s, 'Subagent-driven', 'Commit per task', A);
expect('the model is told the run started', firstNote.includes('Implementation run recorded'), firstNote);
allowed('commit per task is allowed right away', s, COMMIT, A);

console.log('The saved preference applies elsewhere with no question');
const s2 = newSession();
allowed('another session, same repository, no question asked', s2, COMMIT, A);
allowed('commit per task allows commits in any repository, without a run', s2, COMMIT, B);
allowed('push is not held back when commits stay', s2, 'git push', A);

console.log('No commits refuses, and the approval word test');
s = newSession();
answer(s, 'Main session', 'No commits', A);
refused('no commits refuses by default', s, COMMIT, A, 'No commits');
prompt(s, "let's commit this now");
allowed('a message asking for a commit approves it this turn', s, COMMIT);
prompt(s, 'thanks, now look at the next thing');
refused('the next user message ends the approval', s, COMMIT);
prompt(s, 'please keep this uncommitted for now');
refused('"uncommitted" does not approve', s, COMMIT);

console.log('Task notifications and peer messages keep approval');
prompt(s, 'please commit that');
allowed('approved this turn', s, COMMIT);
prompt(s, '<task-notification>\n<task-id>x</task-id>\n</task-notification>');
allowed('a task notification keeps the approval', s, COMMIT);
prompt(s, 'Another Claude session sent a message:\n<cross-session-message from="x" from-name="fs">hi</cross-session-message>');
allowed('a peer session message keeps the approval', s, COMMIT);
prompt(s, 'ok, continue');
refused('a genuine new user message ends it', s, COMMIT);

console.log('A single-question answer changes only that field');
s = newSession();
answer(s, 'Subagent-driven', 'Commit per task', A);
allowed('starts as commit per task', s, COMMIT, A);
const oneNote = answerOne(s, 'commits', 'No commits', A);
expect('the note names the saved preference, not a new run', oneNote.includes('Saved preference') && !oneNote.includes('Implementation run recorded'), oneNote);
refused('commits alone switched to no', s, COMMIT, A, 'No commits');
const shownAfterOne = run(['preference', 'show']).stdout;
expect('mode was left unchanged', shownAfterOne.includes('subagent-driven'), shownAfterOne);

s = newSession();
clearPreference();
const ignoredNote = answerOne(s, 'mode', 'Main session', A);
expect('a single answer with nothing saved yet is ignored', ignoredNote.trim() === '', ignoredNote);
const stillNone = run(['preference', 'show']).stdout;
expect('still no preference saved', stillNone.includes('No implementation preference is saved'), stillNone);

console.log('An unrelated question starts no run and saves nothing');
clearPreference();
s = newSession();
event(s, { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
           tool_response: { questions: [{ question: 'Pick one', header: 'Other' }], answers: { 'Pick one': 'x' } } });
refused('still no preference', s, COMMIT, A, 'No implementation preference is saved');

console.log('start, and preference show/clear/set');
clearPreference();
s = newSession();
const noPref = run(['start', '--session', s], A);
expect('start with no preference exits 2', noPref.status === 2 && noPref.stdout.includes('No implementation preference is saved'), noPref.stdout);

const setMode = run(['preference', 'set', 'mode', 'subagent']);
expect('set fills the other field with its default', setMode.stdout.includes('subagent-driven, no commits') && setMode.stdout.includes('filled with its default'), setMode.stdout);
const setCommits = run(['preference', 'set', 'commits', 'on']);
expect('set on an existing preference changes only that field', setCommits.stdout.includes('subagent-driven, commit per task') && !setCommits.stdout.includes('filled with its default'), setCommits.stdout);

const withPref = run(['start', '--session', s], A);
expect('start with a preference exits 0', withPref.status === 0, withPref.stdout);
expect('start prints the dev mode', withPref.stdout.includes('Dev mode: Subagent-driven'), withPref.stdout);
allowed('commit per task allows after start', s, COMMIT, A);

const shown = run(['preference', 'show']);
expect('preference show reports it', shown.stdout.includes('subagent-driven, commit per task'), shown.stdout);
run(['preference', 'clear']);
const clearedShown = run(['preference', 'show']);
expect('preference clear removes it', clearedShown.stdout.includes('No implementation preference is saved'), clearedShown.stdout);

console.log('Subagent-driven, no commits');
s = newSession();
const note = answer(s, 'Subagent-driven', 'No commits', A);
expect('the model is told the run started', note.includes('Implementation run recorded'), note);
const base = git(A, 'rev-parse', 'HEAD');
allowed('per-task commits are allowed', s, COMMIT, A);
refused('push is held back until the undo', s, 'git push origin work-ABC-1', A, 'finish-implementation');
refused('reset --hard is held back', s, 'git reset --hard HEAD~1', A, 'finish-implementation');
allowed('reset --soft is not', s, 'git reset --soft HEAD~1', A);
writeFileSync(join(A, 'task1.txt'), 'one\n'); git(A, 'add', '.'); git(A, 'commit', '-q', '-m', 'task 1');
writeFileSync(join(A, 'task2.txt'), 'two\n'); git(A, 'add', '.'); git(A, 'commit', '-q', '-m', 'task 2');
const tasksHead = git(A, 'rev-parse', 'HEAD');

git(A, 'checkout', '-q', '-b', 'elsewhere');
const wrongBranch = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish on another branch refuses', wrongBranch.status === 1 && git(A, 'rev-parse', 'HEAD') === tasksHead, wrongBranch.stdout);
git(A, 'checkout', '-q', 'work-ABC-1');

const done = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish exits 0', done.status === 0, done.stdout + done.stderr);
expect('the branch is back at the run start', git(A, 'rev-parse', 'HEAD') === base);
expect('both task files are still there', existsSync(join(A, 'task1.txt')) && existsSync(join(A, 'task2.txt')));
expect('nothing is staged', git(A, 'diff', '--cached', '--name-only') === '');
expect('the undone commits are listed', done.stdout.includes('task 1') && done.stdout.includes('task 2'), done.stdout);
expect('the reflog line names the old head', done.stdout.includes(tasksHead), done.stdout);
allowed('push is allowed once the run is finished', s, 'git push origin work-ABC-1', A);
refused('commit needs approval again', s, COMMIT, A, 'No commits');
const again = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('a second finish does nothing', again.status === 0 && again.stdout.includes('No implementation run'), again.stdout);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
