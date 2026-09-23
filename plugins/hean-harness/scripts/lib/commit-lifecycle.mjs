/**
 * Whether an agent may commit right now, decided from what the user did in
 * this session rather than from what the agent says.
 *
 * A commit is allowed only inside one of these:
 *
 *   the turn the user typed /hean-harness:commit       approval for that turn
 *   the turn a lifecycle skill ran (LIFECYCLE_SKILLS)  its commits are its job
 *   an implementation run whose answers allow it       see below
 *
 * An implementation run starts when the user answers the two questions the
 * implementation-commits rule asks, under the headers MODE_HEADER and
 * COMMITS_HEADER. The answers are read from the AskUserQuestion result, which
 * only the user's click produces.
 *
 *   commits yes, any mode         commits allowed, and kept
 *   commits no, main session      commits refused
 *   commits no, subagent-driven   commits allowed, because each task review
 *                                 reads them; push and reset --hard refused
 *                                 until finishRun() undoes them back to the
 *                                 run's first commit
 *
 * A turn is one user message. Task notifications and peer session messages
 * also arrive as prompts; they are not the user and start no new turn.
 *
 * State is one small file per session under STATE_DIR/sessions.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { STATE_DIR } from './manifest.mjs';

export const APPROVE_SKILL = 'hean-harness:commit';
export const LIFECYCLE_SKILLS = ['hean-harness:uat-hotfix', 'hean-harness:version-bump'];
export const FINISH_SKILL = 'hean-harness:finish-implementation';
export const RULE = '~/.claude/rules/implementation-commits.md';
export const MODE_HEADER = 'Dev mode';
export const COMMITS_HEADER = 'Commits';

const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (repo, ...args) => { try { return git(repo, ...args); } catch { return null; } };

const stateFile = session => join(STATE_DIR, 'sessions', `${session}.json`);
const validSession = session => typeof session === 'string' && /^[A-Za-z0-9_-]+$/.test(session);

export function readState(session) {
  const empty = { turn: { approved: false, skill: null }, run: null };
  if (!validSession(session)) return empty;
  try { return { ...empty, ...JSON.parse(readFileSync(stateFile(session), 'utf8')) }; } catch { return empty; }
}

export function writeState(session, state) {
  if (!validSession(session)) return;
  mkdirSync(join(STATE_DIR, 'sessions'), { recursive: true });
  writeFileSync(stateFile(session), JSON.stringify(state, null, 2) + '\n');
}

/** Does this prompt come from the user, rather than a task notification or another session? */
export const fromUser = prompt =>
  !/^\s*<task-notification>/.test(prompt) && !/<cross-session-message[\s>]/.test(prompt.slice(0, 300));

/** The skill a typed prompt starts, such as 'hean-harness:commit', or null. */
export const typedSkill = prompt => prompt.trim().match(/^\/([\w-]+:[\w-]+)(?:\s|$)/)?.[1] ?? null;

/** A new user message: the previous turn's approval ends, and this one may grant its own. */
export function onPrompt(state, prompt) {
  if (!fromUser(prompt)) return state;
  const skill = typedSkill(prompt);
  return {
    ...state,
    turn: {
      approved: skill === APPROVE_SKILL,
      skill: LIFECYCLE_SKILLS.includes(skill) ? skill : null
    }
  };
}

/** The model started a skill. Only a lifecycle skill changes anything; approval is never granted this way. */
export function onSkill(state, skill) {
  if (!LIFECYCLE_SKILLS.includes(skill)) return state;
  return { ...state, turn: { ...state.turn, skill } };
}

/**
 * The two implementation answers in an AskUserQuestion result, or null when
 * this question was not that one: { mode: 'subagent'|'main', commits: 'yes'|'no' }.
 */
export function implementationAnswers(response) {
  let r = response;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return null; } }
  const questions = r?.questions, answers = r?.answers;
  if (!Array.isArray(questions) || !answers || typeof answers !== 'object') return null;
  const answer = header => {
    const q = questions.find(q => q?.header === header);
    return q ? String(answers[q.question] ?? '').toLowerCase() : null;
  };
  const mode = answer(MODE_HEADER), commits = answer(COMMITS_HEADER);
  if (mode === null || commits === null) return null;
  const m = mode.includes('subagent') ? 'subagent' : mode.includes('main') ? 'main' : null;
  const c = commits.includes('per task') ? 'yes' : commits.startsWith('no') ? 'no' : null;
  return m && c ? { mode: m, commits: c } : null;
}

const pendingUndo = run => run?.mode === 'subagent' && run?.commits === 'no';

/**
 * The user answered the implementation questions: start a run in the
 * repository at cwd. Returns { state, note }, where note is text for the model.
 */
export function startRun(state, answers, cwd) {
  const repo = tryGit(cwd, 'rev-parse', '--show-toplevel');
  if (!repo) return { state, note: 'Not in a git repository, so no implementation run was recorded.' };
  if (pendingUndo(state.run) && state.run.repo === repo) {
    return { state, note: `An earlier subagent-driven run in ${repo} still has commits to undo. ` +
                          `Run ${FINISH_SKILL} before starting another run.` };
  }
  const run = {
    ...answers,
    repo,
    branch: tryGit(repo, 'symbolic-ref', '--short', 'HEAD'),
    base: tryGit(repo, 'rev-parse', 'HEAD'),
    dirtyAtStart: !!tryGit(repo, 'status', '--porcelain')
  };
  const how = run.commits === 'yes' ? 'Commit each task; the commits stay.'
    : run.mode === 'main' ? 'Do not commit. The gate refuses commits during this run.'
    : 'Commit each task so its review can read the diff. The commits are undone when the run finishes.';
  return { state: { ...state, run },
           note: `Implementation run recorded: ${run.mode === 'subagent' ? 'subagent-driven' : 'main session'}, ` +
                 `${run.commits === 'yes' ? 'commit per task' : 'no commits'}, starting at ${run.base?.slice(0, 7) ?? 'an empty branch'} ` +
                 `on ${run.branch ?? 'a detached HEAD'}. ${how} Finish with ${FINISH_SKILL}.` };
}

/**
 * Why this git command may not run now, or null when it may.
 * c is { sub, args }; repo is the repository it acts on.
 */
export function refusal(state, c, repo) {
  const run = state.run && state.run.repo === repo ? state.run : null;

  if (c.sub === 'commit') {
    if (state.turn.approved || state.turn.skill) return null;
    if (run && (run.commits === 'yes' || run.mode === 'subagent')) return null;
    return `Commits wait for the user's approval in this session.\n\n` +
           (run ? `The implementation run in ${repo} was started with "no commits".\n\n` : '') +
           `List every file created, changed or deleted, with one line on why, leave the changes ` +
           `uncommitted, and stop. The user reviews them and types /${APPROVE_SKILL} to approve ` +
           `a commit. Rules: ${RULE}`;
  }

  if (pendingUndo(run) && (c.sub === 'push' || (c.sub === 'reset' && c.args.includes('--hard')))) {
    return `The subagent-driven run in ${repo} was started with "no commits", so its per-task commits ` +
           `are undone when it finishes and must not leave this machine or be discarded.\n\n` +
           `Run ${FINISH_SKILL} first. It moves the branch back to ${run.base?.slice(0, 7)} and ` +
           `leaves every change in the working tree for the user to review.`;
  }
  return null;
}

/**
 * End the session's run. For a subagent-driven run with no commits, undo its
 * commits: move the branch back to the run's first commit and unstage, which
 * leaves every file as the run left it. Returns the lines to print.
 */
export function finishRun(session) {
  const state = readState(session);
  const run = state.run;
  if (!run) return { ok: true, lines: ['No implementation run is open in this session. Nothing to do.'] };

  const out = [];
  if (pendingUndo(run)) {
    const head = tryGit(run.repo, 'rev-parse', 'HEAD');
    const branch = tryGit(run.repo, 'symbolic-ref', '--short', 'HEAD');
    if (branch !== run.branch) {
      return { ok: false, lines: [`The run started on ${run.branch}, but ${run.repo} is on ${branch ?? 'a detached HEAD'}.`,
                                  `Switch back to ${run.branch} and run this again. Nothing was changed.`] };
    }
    if (!run.base) {
      return { ok: false, lines: ['The run started on a branch with no commits, so there is no commit to go back to.',
                                  'Nothing was changed. Tell the user.'] };
    }
    if (tryGit(run.repo, 'merge-base', '--is-ancestor', run.base, 'HEAD') === null) {
      return { ok: false, lines: [`${run.base.slice(0, 7)}, where the run started, is no longer in this branch's history.`,
                                  'Nothing was changed. Tell the user.'] };
    }
    const undone = tryGit(run.repo, 'log', '--format=%h %s', `${run.base}..HEAD`) ?? '';
    if (head !== run.base) {
      git(run.repo, 'reset', '--soft', run.base);
      git(run.repo, 'reset', '-q');
      out.push(`Undid the run's commits. The branch is back at ${run.base.slice(0, 7)}; every change is in the working tree, unstaged.`);
      out.push(`The commits stay recoverable from the reflog: git reset --soft ${head}`);
      out.push('');
      out.push('Commits undone:');
      for (const l of undone.split('\n').filter(Boolean)) out.push(`  ${l}`);
    } else {
      out.push('The run made no commits. Nothing to undo.');
    }
    if (run.dirtyAtStart) {
      out.push('');
      out.push('!! The working tree already had uncommitted changes when the run started. They are mixed in with the run\'s changes.');
    }
  } else {
    out.push(`Closed the implementation run (${run.mode === 'subagent' ? 'subagent-driven' : 'main session'}, ` +
             `${run.commits === 'yes' ? 'commit per task' : 'no commits'}).`);
  }
  writeState(session, { ...state, run: null });
  out.push('');
  out.push('Changes now in the working tree:');
  out.push(tryGit(run.repo, 'status', '--short') || '  (none)');
  return { ok: true, lines: out };
}
