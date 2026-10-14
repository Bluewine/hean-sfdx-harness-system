/**
 * The saved implementation preference, and what an open implementation run
 * allows or refuses, decided from saved state rather than from what the agent
 * says.
 *
 * The preference is one file per machine (PREFERENCE_FILE): { mode, commits }.
 * It applies in every repository and folder, with no per-repository override,
 * so the two implementation questions are asked once per machine rather than
 * once per session. The implementation-commits rule forbids the model from
 * writing this file itself; the two intended writers are the PostToolUse
 * AskUserQuestion hook (the user's click) and the typed-only
 * implementation-defaults skill (a command the user typed). Nothing here
 * stops a model that ignores the rule from writing the file directly — the
 * constraint is instructional, not enforced by this module.
 *
 * A commit is never refused. The gate guards only what would make a "no
 * commits" run's undo unsafe: while an open run in a repository has commits
 * "no" (either dev mode), `git push` and `git reset --hard` there are refused,
 * because finishing the run moves the branch back to its first commit. Outside
 * an open run nothing is refused.
 *
 * Session state (the current run) is one small file per session under
 * STATE_DIR/sessions.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { STATE_DIR, PREFERENCE_FILE } from './manifest.mjs';
import { git, tryGit } from './command-line.mjs';

export { PREFERENCE_FILE };
export const FINISH_SKILL = 'hean-harness:finish-implementation';
export const MODE_HEADER = 'Dev mode';
export const COMMITS_HEADER = 'Commits';
export const NO_PREFERENCE = 'No implementation preference is saved on this machine.';

const stateFile = session => join(STATE_DIR, 'sessions', `${session}.json`);
const validSession = session => typeof session === 'string' && /^[A-Za-z0-9_-]+$/.test(session);

export function readState(session) {
  const empty = { run: null };
  if (!validSession(session)) return empty;
  try { return { ...empty, ...JSON.parse(readFileSync(stateFile(session), 'utf8')) }; } catch { return empty; }
}

export function writeState(session, state) {
  if (!validSession(session)) return;
  mkdirSync(join(STATE_DIR, 'sessions'), { recursive: true });
  writeFileSync(stateFile(session), JSON.stringify(state, null, 2) + '\n');
}

/** The saved machine-wide preference, or null when none is saved or the file is invalid. */
export function readPreference() {
  try {
    const p = JSON.parse(readFileSync(PREFERENCE_FILE, 'utf8'));
    if ((p.mode === 'subagent' || p.mode === 'main') && (p.commits === 'yes' || p.commits === 'no')) {
      return { mode: p.mode, commits: p.commits };
    }
    return null;
  } catch { return null; }
}

/** Save the machine-wide preference. Only the AskUserQuestion hook and the typed-only defaults skill call this. */
export function savePreference(preference) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PREFERENCE_FILE, JSON.stringify(preference, null, 2) + '\n');
}

/**
 * Whichever of the two implementation answers are present in an
 * AskUserQuestion result: { mode?: 'subagent'|'main', commits?: 'yes'|'no' }.
 * null when neither header is present, or a present answer is unrecognised.
 */
export function implementationAnswers(response) {
  let r = response;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return null; } }
  const questions = r?.questions, answers = r?.answers;
  if (!Array.isArray(questions) || !answers || typeof answers !== 'object') return null;
  const raw = header => {
    const q = questions.find(q => q?.header === header);
    return q ? String(answers[q.question] ?? '').toLowerCase() : undefined;
  };
  const modeRaw = raw(MODE_HEADER), commitsRaw = raw(COMMITS_HEADER);
  if (modeRaw === undefined && commitsRaw === undefined) return null;

  const result = {};
  if (modeRaw !== undefined) {
    const m = modeRaw.includes('subagent') ? 'subagent' : modeRaw.includes('main') ? 'main' : null;
    if (!m) return null;
    result.mode = m;
  }
  if (commitsRaw !== undefined) {
    const c = commitsRaw.includes('per task') ? 'yes' : commitsRaw.startsWith('no') ? 'no' : null;
    if (!c) return null;
    result.commits = c;
  }
  return result;
}

const pendingUndo = run => run?.commits === 'no';

/** A preference or a run's own {mode, commits} as the two phrases a reader sees, e.g. { mode: 'subagent-driven', commits: 'commit per task' }. */
export function preferenceText(preference) {
  return {
    mode: preference.mode === 'subagent' ? 'subagent-driven' : 'main session',
    commits: preference.commits === 'yes' ? 'commit per task' : 'no commits'
  };
}

/** Human-readable description of a preference or a run's own {mode, commits}, e.g. "subagent-driven, commit per task". */
export function describePreference(preference) {
  const { mode, commits } = preferenceText(preference);
  return `${mode}, ${commits}`;
}

/**
 * Start an implementation run in the repository at cwd, fed from the saved
 * preference. Returns { state, started, reason, note }: started is false when
 * no run was recorded, and note is text for the model either way. reason is
 * set only when started is false: 'not-git' (no repository here, so there is
 * nothing for the commit gate to apply to) or 'pending-undo' (an earlier run
 * in this repository still needs finishing).
 */
export function startRun(state, preference, cwd) {
  const repo = tryGit(cwd, 'rev-parse', '--show-toplevel');
  if (!repo) return { state, started: false, reason: 'not-git',
                       note: 'Not in a git repository, so no implementation run was recorded. There is nothing here for the commit gate to apply to.' };
  if (pendingUndo(state.run) && state.run.repo === repo) {
    return { state, started: false, reason: 'pending-undo',
             note: `An earlier run with no commits in ${repo} still has commits to undo. ` +
                   `Run ${FINISH_SKILL} first, then start the implementation again.` };
  }
  const run = {
    ...preference,
    repo,
    branch: tryGit(repo, 'symbolic-ref', '--short', 'HEAD'),
    base: tryGit(repo, 'rev-parse', 'HEAD'),
    dirtyAtStart: !!tryGit(repo, 'status', '--porcelain')
  };
  const how = run.commits === 'yes' ? 'Commit each task; the commits stay.'
    : 'Commit each task. The commits are undone when the run finishes.';
  return { state: { ...state, run }, started: true,
           note: `Implementation run recorded: ${describePreference(run)}, ` +
                 `starting at ${run.base?.slice(0, 7) ?? 'an empty branch'} on ${run.branch ?? 'a detached HEAD'}. ` +
                 `${how} Finish with ${FINISH_SKILL}.` };
}

/**
 * Why this git command may not run now, or null when it may.
 * c is { sub, args }; repo is the repository it acts on. A commit is never
 * refused.
 */
export function refusal(state, c, repo) {
  const run = state.run && state.run.repo === repo ? state.run : null;

  if (pendingUndo(run) && (c.sub === 'push' || (c.sub === 'reset' && c.args.includes('--hard')))) {
    return `The ${run.mode === 'subagent' ? 'subagent-driven' : 'main-session'} run in ${repo} was started with "no commits", so its per-task commits ` +
           `are undone when it finishes and must not leave this machine or be discarded.\n\n` +
           `Run ${FINISH_SKILL} first. It moves the branch back to ${run.base?.slice(0, 7)} and ` +
           `leaves every change in the working tree for the user to review.`;
  }
  return null;
}

/**
 * End the session's run. For a run with no commits (either dev mode), undo its
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
    out.push(`Closed the implementation run (${describePreference(run)}).`);
  }
  writeState(session, { ...state, run: null });
  out.push('');
  out.push('Changes now in the working tree:');
  out.push(tryGit(run.repo, 'status', '--short') || '  (none)');
  return { ok: true, lines: out };
}
