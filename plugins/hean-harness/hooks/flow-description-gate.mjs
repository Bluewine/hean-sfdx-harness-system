#!/usr/bin/env node
/**
 * Stops a commit of Salesforce Flow files until they have been checked for a
 * dated change-log entry.
 *
 * It remembers the hash of the staged Flow changes it last saw verified. When
 * the staged changes still hash the same, the commit goes through; when they
 * differ, it denies and points at the skill that adds the entries.
 *
 * Only Flow files this branch actually changes count: runbook copies under
 * runbooks/pre-deploy/ and runbooks/post-deploy/, deleted Flow files, and,
 * during a merge, Flows taken unchanged from MERGE_HEAD are left out. The
 * commit check, --mark-verified and --list-flows share one list (flowsToCheck).
 *
 * The record lives under the home directory, keyed by repository, rather than
 * beside the skill. A plugin's own folder moves on every update, so state
 * written there is lost.
 *
 * The gate runs before the command does, so it sees only what is already
 * staged. A command that stages Flow files and commits in the same call —
 * `git add f && git commit`, `git commit -a`, `git commit <paths>` — would pass
 * with nothing staged yet. Such a command is refused and asked to stage in its
 * own call first, after which the staged check above applies.
 *
 * The repository checked is the one each commit goes to: a `cd` earlier in the
 * command, `git -C`, `--git-dir` and `--work-tree` are followed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { claudeDir } from '../scripts/lib/paths.mjs';
import { gitCommands, repoOf } from '../scripts/lib/command-line.mjs';
import { stagingOf } from '../scripts/lib/staging.mjs';

const ok = () => { process.stdout.write('{}'); process.exit(0); };

/** Where this repository's marker lives. One definition, used by both modes. */
export const stateDirFor = repo =>
  join(claudeDir(), 'hean-harness', 'flow-gate',
       createHash('sha1').update(repo).digest('hex').slice(0, 12));

const gitIn = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const lines = out => out.split('\n').map(l => l.trim()).filter(Boolean);
const gitOut = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const nulSplit = out => out.split('\0').filter(Boolean);

/** Runbook copies are temporary deployment staging, not this branch's Flow work. */
const RUNBOOK = /^runbooks\/(pre|post)-deploy\//;

/**
 * The staged Flow files, repository-relative, that need a description check.
 * Left out: runbook copies, files the index deletes, and — while a merge is in
 * progress — files whose staged blob is the one MERGE_HEAD holds, because they
 * were taken unchanged from the other branch. A Flow edited by hand to resolve
 * a conflict has a different blob and stays in.
 */
export function flowsToCheck(root) {
  let files = nulSplit(gitOut(root, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=d',
    '-z', '--', '*.flow-meta.xml'])).filter(f => !RUNBOOK.test(f));
  if (files.length && gitOut(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).trim()) {
    // ls-files -s: "<mode> <blob> <stage>\t<path>"; ls-tree: "<mode> <type> <blob>\t<path>"
    const entries = out => nulSplit(out).map(e => { const t = e.indexOf('\t'); return [e.slice(t + 1), e.slice(0, t).split(' ')]; });
    const staged = new Map(entries(gitOut(root, ['--literal-pathspecs', 'ls-files', '-s', '-z', '--', ...files]))
      .filter(([, m]) => m[2] === '0').map(([p, m]) => [p, m[1]]));
    const theirs = new Map(entries(gitOut(root, ['--literal-pathspecs', 'ls-tree', '-z', 'MERGE_HEAD', '--', ...files]))
      .map(([p, m]) => [p, m[2]]));
    files = files.filter(f => !staged.has(f) || staged.get(f) !== theirs.get(f));
  }
  return files.sort();
}

/** The staged diff of the files that need a check: the one input both hashes are taken from. */
const checkedDiff = (root, files) =>
  files.length ? gitOut(root, ['--literal-pathspecs', 'diff', '--cached', '--', ...files]) : '';

/**
 * Print the staged Flow files that need a check, one per line, so the skill
 * works on exactly the list the gate hashes.
 *
 * Runs before anything reads standard input, because this mode has none.
 */
if (process.argv.includes('--list-flows')) {
  try {
    const root = gitIn(['rev-parse', '--show-toplevel']).trim();
    for (const f of flowsToCheck(root)) console.log(f);
  } catch (e) {
    console.error(`Could not list the staged Flow files: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Record the staged Flow changes as checked, so the retried commit goes
 * through. The skill that adds the dated entries calls this rather than
 * writing a marker itself — one place decides where the marker lives and how
 * it is hashed, so the gate and the skill cannot drift apart.
 *
 * Runs before anything reads standard input, because this mode has none.
 */
if (process.argv.includes('--mark-verified')) {
  try {
    const root = gitIn(['rev-parse', '--show-toplevel']).trim();
    // checkedDiff swallows git errors; this call throws, so a broken repository is not recorded as checked
    gitIn(['-C', root, 'diff', '--cached', '--name-only']);
    const diff = checkedDiff(root, flowsToCheck(root));
    const dir = stateDirFor(root);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'last-verified-diff-hash');
    writeFileSync(file, createHash('sha1').update(diff).digest('hex'));
    console.log(`Recorded the staged Flow changes as checked.\n  ${file}`);
  } catch (e) {
    console.error(`Could not record the Flow check: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const FLOW = /\.flow-meta\.xml$/;

/**
 * The changed Flow files, repository-relative, that this staging would add to
 * the index. Deletions and runbook copies are left out, as in flowsToCheck.
 */
export function flowsStagedBy(staging, dir) {
  const spec = staging.scope === 'paths' ? ['--', ...staging.paths] : [];
  const found = new Set(lines(gitOut(dir, ['diff', '--name-only', '--diff-filter=d', ...spec])));
  if (staging.scope !== 'tracked') {
    for (const f of lines(gitOut(dir, ['ls-files', '--others', '--exclude-standard', '--full-name', ...spec]))) found.add(f);
  }
  return [...found].filter(f => FLOW.test(f) && !RUNBOOK.test(f)).sort();
}

const deny = reason => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
  }));
  process.exit(0);
};

const SAME_CALL = files =>
  'This command stages Flow files and commits in the same call:\n\n' +
  files.map(f => `    ${f}`).join('\n') + '\n\n' +
  'The Flow check runs before the command, so it cannot see files the command itself stages. ' +
  'Stage them in their own Bash call, then run the commit as a separate call.';

const UNCHECKED =
  'Staged Flow changes have not been checked for a dated description entry yet. ' +
  'Invoke the flow-description-comment skill now — it finds the changed Flow files, ' +
  'adds a dated entry to any that need one, re-stages them, then retries this commit.';

const isMain = process.argv[1] && process.argv[1].endsWith('flow-description-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { ok(); }
  const sessionCwd = input?.cwd || process.cwd();

  // files each repository has staged earlier in this same command
  const stagedInCall = new Map();
  for (const c of gitCommands(input?.tool_input?.command ?? '', sessionCwd)) {
    const staging = stagingOf(c.sub, c.args);
    if (!staging && c.sub !== 'commit') continue;
    const root = repoOf(c, sessionCwd);
    if (!root) continue;
    const dir = c.dir ?? sessionCwd;

    if (c.sub !== 'commit') {
      stagedInCall.set(root, [...(stagedInCall.get(root) ?? []), ...flowsStagedBy(staging, dir)]);
      continue;
    }

    const pending = [...new Set([...(stagedInCall.get(root) ?? []), ...(staging ? flowsStagedBy(staging, dir) : [])])].sort();
    if (pending.length) deny(SAME_CALL(pending));

    // no staged Flow that needs a check? then this gate has no opinion on this commit
    const staged = checkedDiff(root, flowsToCheck(root));
    if (!staged.trim()) continue;
    const stateFile = join(stateDirFor(root), 'last-verified-diff-hash');
    const current = createHash('sha1').update(staged).digest('hex');
    const last = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : '';
    if (current !== last) deny(UNCHECKED);
  }
  ok();
}
