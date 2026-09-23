#!/usr/bin/env node
/**
 * Refuses a commit whose subject line does not carry a work item reference.
 *
 * A subject that names no work item cannot be traced back to what asked for the
 * change. Months later the diff is the only record, and a reviewer reading
 * release history has nothing to look the change up by. The check happens here,
 * before the commit runs, because a rejected commit costs a retyped message
 * while a landed one costs a rewrite of history.
 *
 * Required shape:
 *
 *   @ABC-123: Add the thing
 *   @ABC-123-UK: Add the thing        (a two-letter suffix, where a team uses one)
 *   @ABC-123: [Sonar] Remove the thing (a Sonar fix, which the PR skills list apart)
 *
 * The work item reference, one colon, one space, an optional `[Sonar] ` tag,
 * then a capital letter.
 *
 * assets/githooks/commit-msg repeats this pattern for commits typed outside
 * Claude Code. Change both together.
 *
 * Enforced only in a repository whose saved commit format choice is on. Setup
 * asks once per repository and /hean-harness:commit-format switches it later.
 * With no saved choice, which includes every repository setup never ran in, the
 * gate lets every subject through.
 *
 * The repository checked is the one each commit goes to, not the session's
 * working folder: a `cd` earlier in the same command, `git -C`, `--git-dir` and
 * `--work-tree` are followed. A folder the text cannot name — a variable, a
 * command substitution — falls back to the session's working folder.
 *
 * Only a message given on the command line can be checked. A commit that opens
 * an editor, reads a file with -F, or reuses a message with -C passes through
 * untouched, because there is nothing here to read.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

import { commandsIn, folder } from '../scripts/lib/command-line.mjs';

export const SUBJECT = /^@[A-Z]+-[0-9]+(-[A-Z]{2})?:\s(\[Sonar\]\s)?[A-Z](.*)$/;

/**
 * The message a `git commit` was given on the command line, or null.
 *
 * Only the first -m matters: git joins several into paragraphs, and the first
 * is the subject. A bundled short flag ending in m, such as -am, takes the next
 * word as its value, the same as a bare -m does.
 */
export function messageOf(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a === '-m' || a === '--message') return argv[i + 1] ?? null;
    if (a.startsWith('--message=')) return a.slice('--message='.length);
    if (/^-[A-Za-z]*m$/.test(a) && a !== '--') return argv[i + 1] ?? null;   // -m, -am, -sm
    if (/^-[A-Za-z]*m./.test(a) && !a.startsWith('--')) return a.slice(a.indexOf('m') + 1); // -m"text", -am"text"
  }
  return null;
}

// git's own options that come before the subcommand and take the next word as a value
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix']);

/**
 * Every command-line commit in this script, with where it commits.
 *
 * Each entry is { message, dir, gitDir, workTree }. dir is the folder the commit
 * runs in, or null when a `cd` earlier in the script names a folder the text
 * cannot resolve; the caller then falls back to the session's working folder.
 */
export function commits(cmd, cwd) {
  const found = [];
  for (const { words: w, env, dir } of commandsIn(cmd, cwd)) {
    if (w[0] !== 'git' && basename(w[0]) !== 'git') continue;

    let here = dir;
    let gitDir = env.GIT_DIR !== undefined ? folder(env.GIT_DIR, dir) : undefined;
    let workTree = env.GIT_WORK_TREE !== undefined ? folder(env.GIT_WORK_TREE, dir) : undefined;
    let j = 1;
    for (; j < w.length; j++) {
      const a = w[j];
      if (!a.startsWith('-')) break;
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      const value = eq > 0 ? a.slice(eq + 1) : (GIT_VALUE_OPTS.has(a) ? w[++j] : undefined);
      if (name === '-C') here = folder(value, here);
      else if (name === '--git-dir') gitDir = folder(value, here);
      else if (name === '--work-tree') workTree = folder(value, here);
    }
    if (w[j] !== 'commit') continue;
    const message = messageOf(w.slice(j + 1));
    if (message !== null) found.push({ message, dir: here, gitDir, workTree });
  }
  return found;
}

/** Every command-line commit message in this script, in the order they run. */
export function commitMessages(cmd) {
  return commits(cmd, process.cwd()).map(c => c.message);
}

/**
 * The top of the repository a commit goes to, or null when there is none.
 * --work-tree wins, then --git-dir, then the folder the commit runs in.
 */
function repoOf(c, sessionCwd) {
  const start = c.workTree ?? (c.gitDir && basename(c.gitDir) === '.git' ? dirname(c.gitDir) : null) ?? c.dir ?? sessionCwd;
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

const REASON = (subject, repo) =>
  `This commit subject does not carry a work item reference:\n\n` +
  `    ${subject}\n\n` +
  `The commit format is on in ${repo}.\n\n` +
  `Required shape:  @WORK-ID: Capitalised imperative summary\n` +
  `Pattern:         ${SUBJECT.source}\n\n` +
  `    @ABC-123: Add the work type dedupe check\n` +
  `    @ABC-123-UK: Add the work type dedupe check      (with a team suffix)\n` +
  `    @ABC-123: [Sonar] Remove the unused variable     (a Sonar fix)\n\n` +
  `Take the work item reference from the current branch name, prefix it with @, ` +
  `follow it with one colon and one space, and start the summary with a capital letter.`;

const isMain = process.argv[1] && process.argv[1].endsWith('commit-message-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const sessionCwd = input?.cwd || process.cwd();

  // Each commit is checked against its own repository's answer. The answer is
  // read only once a subject has already failed, so a passing commit pays nothing.
  for (const c of commits(input?.tool_input?.command ?? '', sessionCwd)) {
    const subject = c.message.split('\n')[0];
    if (SUBJECT.test(subject)) continue;
    const repo = repoOf(c, sessionCwd);
    if (!repo) continue;
    const { readChoice } = await import('../scripts/lib/commit-format.mjs');
    if (readChoice(repo) !== 'on') continue;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: REASON(subject, repo)
      }
    }));
    break;
  }
  process.exit(0);
}
