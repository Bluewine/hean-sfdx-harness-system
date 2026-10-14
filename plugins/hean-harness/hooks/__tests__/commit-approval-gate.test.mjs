/**
 * What the commit approval gate must let through, and what it must stop, as
 * the saved machine-wide implementation preference is set and changed and
 * implementation runs start and finish. A commit is never refused; push and
 * reset --hard are refused only during a "no commits" run. Also checks that
 * finishing a "no commits" run, in either dev mode, undoes its commits and
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
allowed('no preference does not refuse a commit', s, COMMIT, A);
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

console.log('No commits saved, checks outside the run\'s session or repository');
s = newSession();
answer(s, 'Main session', 'No commits', A);
const strayState = newSession();
allowed('a commit is allowed in a session with no run', strayState, COMMIT, A);
allowed('a commit is allowed in another repository', strayState, COMMIT, B);
allowed('push is allowed with no open run in the session', strayState, 'git push origin work-ABC-1', A);
allowed('reset --hard is allowed with no open run in the session', strayState, 'git reset --hard HEAD', A);
allowed('a run in repository A does not hold back push in repository B', s, 'git push', B);
const oldState = newSession();
mkdirSync(join(sandbox, 'config', 'hean-harness', 'sessions'), { recursive: true });
writeFileSync(join(sandbox, 'config', 'hean-harness', 'sessions', `${oldState}.json`),
              JSON.stringify({ turn: { approved: true }, run: { repo: git(A, 'rev-parse', '--show-toplevel'), mode: 'main', commits: 'no', base: git(A, 'rev-parse', 'HEAD'), branch: 'work-ABC-1' } }));
refused('an old state file that still has a turn field keeps its run guard', oldState, 'git push', A, 'finish-implementation');
allowed('an old state file that still has a turn field allows a commit', oldState, COMMIT, A);

console.log('A single-question answer changes only that field');
s = newSession();
answer(s, 'Subagent-driven', 'Commit per task', A);
allowed('starts as commit per task', s, COMMIT, A);
const oneNote = answerOne(s, 'commits', 'No commits', A);
expect('the note names the saved preference, not a new run', oneNote.includes('Saved preference') && !oneNote.includes('Implementation run recorded'), oneNote);
allowed('commits alone switched to no still allows a commit', s, COMMIT, A);
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
const noneNow = run(['preference', 'show']).stdout;
expect('still no preference', noneNow.includes('No implementation preference is saved'), noneNow);

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
allowed('a commit is allowed after start', s, COMMIT, A);

const shown = run(['preference', 'show']);
expect('preference show reports it', shown.stdout.includes('subagent-driven, commit per task'), shown.stdout);
run(['preference', 'clear']);
const clearedShown = run(['preference', 'show']);
expect('preference clear removes it', clearedShown.stdout.includes('No implementation preference is saved'), clearedShown.stdout);

console.log('start, and re-answering, while an earlier run still needs finishing');
clearPreference();
s = newSession();
answer(s, 'Subagent-driven', 'No commits', A);
const blocked = run(['start', '--session', s], A);
expect('start exits 3 when an earlier run still needs finishing', blocked.status === 3 && blocked.stdout.includes('finish-implementation'), blocked.stdout);

const beforePref = run(['preference', 'show']).stdout;
const reAnswerNote = answer(s, 'Main session', 'Commit per task', A);
expect('answering again while a run needs finishing starts no run', !reAnswerNote.includes('Implementation run recorded'), reAnswerNote);
expect('the note says to finish first and start again', reAnswerNote.includes('finish-implementation') && reAnswerNote.toLowerCase().includes('start the implementation again'), reAnswerNote);
const afterPref = run(['preference', 'show']).stdout;
expect('the saved preference was not touched', afterPref === beforePref, `before: ${beforePref}\nafter: ${afterPref}`);

const cleanup = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish clears the pending run', cleanup.status === 0, cleanup.stdout);

clearPreference();
s = newSession();
answer(s, 'Main session', 'No commits', A);
const blockedMain = run(['start', '--session', s], A);
expect('start exits 3 for an earlier main session no-commits run', blockedMain.status === 3 && blockedMain.stdout.includes('finish-implementation'), blockedMain.stdout);
const cleanupMain = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish clears the pending main session run', cleanupMain.status === 0, cleanupMain.stdout);

const notGitRepo = run(['start', '--session', newSession()], sandbox);
expect('start outside a git repository exits 0 when a preference is saved',
       notGitRepo.status === 0 && notGitRepo.stdout.includes('Not in a git repository'), notGitRepo.stdout);
expect('start outside a git repository still prints the dev mode', notGitRepo.stdout.includes('Dev mode:'), notGitRepo.stdout);

console.log('Answering outside a git repository still saves the preference');
clearPreference();
s = newSession();
const outsideNote = answer(s, 'Main session', 'Commit per task', sandbox);
expect('the model is told no run was recorded outside a repository',
       outsideNote.includes('Not in a git repository'), outsideNote);
const savedOutside = run(['preference', 'show']).stdout;
expect('the preference was saved anyway', savedOutside.includes('main session, commit per task'), savedOutside);

console.log('Commit per task run');
s = newSession();
answer(s, 'Main session', 'Commit per task', A);
allowed('a commit is allowed', s, COMMIT, A);
allowed('push is not held back when commits stay', s, 'git push', A);
allowed('reset --hard is not held back when commits stay', s, 'git reset --hard HEAD', A);
{
  const f = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
  expect('finish closes a commit-per-task run', f.status === 0 && f.stdout.includes('Closed the implementation run'), f.stdout);
}

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
allowed('reset --hard is allowed once the run is finished', s, 'git reset --hard HEAD', A);
allowed('a commit is still allowed once the run is finished', s, COMMIT, A);
const again = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('a second finish does nothing', again.status === 0 && again.stdout.includes('No implementation run'), again.stdout);

console.log('Main session, no commits');
s = newSession();
const mainNote = answer(s, 'Main session', 'No commits', A);
expect('the model is told the run started', mainNote.includes('Implementation run recorded'), mainNote);
expect('the note tells the model to commit each task', mainNote.includes('Commit each task'), mainNote);
const mainBase = git(A, 'rev-parse', 'HEAD');
allowed('a commit is allowed during the run', s, COMMIT, A);
refused('push is held back until the undo', s, 'git push origin work-ABC-1', A, 'finish-implementation');
refused('reset --hard is held back', s, 'git reset --hard HEAD~1', A, 'finish-implementation');
allowed('reset --soft is not', s, 'git reset --soft HEAD~1', A);
writeFileSync(join(A, 'main1.txt'), 'one\n'); git(A, 'add', 'main1.txt'); git(A, 'commit', '-q', '-m', 'main task 1');
const mainDone = spawnSync('node', [RUN_SCRIPT, 'finish', '--session', s], { encoding: 'utf8', env });
expect('finish exits 0', mainDone.status === 0, mainDone.stdout + mainDone.stderr);
expect('the branch is back at the run start', git(A, 'rev-parse', 'HEAD') === mainBase);
expect('the task file is still there, unstaged', existsSync(join(A, 'main1.txt')) && git(A, 'diff', '--cached', '--name-only') === '');
allowed('push is allowed once the run is finished', s, 'git push origin work-ABC-1', A);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
