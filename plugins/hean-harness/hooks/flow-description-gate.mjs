#!/usr/bin/env node
/**
 * Stops a commit of Salesforce Flow files until they have been checked for a
 * dated change-log entry.
 *
 * It remembers the hash of the staged Flow changes it last saw verified. When
 * the staged changes still hash the same, the commit goes through; when they
 * differ, it denies and points at the skill that adds the entries.
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
import { gitCommands, repoOf, isLiteral } from '../scripts/lib/command-line.mjs';

const ok = () => { process.stdout.write('{}'); process.exit(0); };

/** Where this repository's marker lives. One definition, used by both modes. */
export const stateDirFor = repo =>
  join(claudeDir(), 'hean-harness', 'flow-gate',
       createHash('sha1').update(repo).digest('hex').slice(0, 12));

const gitIn = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

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
    const diff = gitIn(['-C', root, 'diff', '--cached', '--', '*.flow-meta.xml']);
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

// options that take the next word as their value, so it is not a path
const ADD_VALUE_OPTS = new Set(['--chmod', '--pathspec-from-file']);
const COMMIT_VALUE_OPTS = new Set(['-m', '--message', '-F', '--file', '-c', '--reedit-message',
  '-C', '--reuse-message', '-t', '--template', '--author', '--date', '--cleanup', '--fixup',
  '--squash', '--trailer']);
const COMMIT_VALUE_SHORT = 'mFcCt';

/**
 * What a `git add` or `git commit` stages as it runs, or null when it stages
 * nothing: { scope: 'paths'|'tracked'|'all', paths }. 'all' also stands for
 * anything the text cannot say, such as a pathspec file or a variable.
 */
export function stagingOf(sub, args) {
  if (sub !== 'add' && sub !== 'stage' && sub !== 'commit') return null;
  const isAdd = sub !== 'commit';
  const paths = [];
  let scope = null, unknown = false, dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { paths.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      if (name === '--dry-run') dryRun = true;
      else if (name === '--pathspec-from-file') unknown = true;
      else if (isAdd && name === '--all') scope = 'all';
      else if (isAdd && (name === '--update' || name === '--renormalize')) scope ??= 'tracked';
      else if (!isAdd && name === '--all') scope = 'tracked';
      if (!a.includes('=') && (isAdd ? ADD_VALUE_OPTS : COMMIT_VALUE_OPTS).has(name)) i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (isAdd && ch === 'A') scope = 'all';
        else if (isAdd && ch === 'u') scope ??= 'tracked';
        else if (isAdd && ch === 'n') dryRun = true;
        else if (!isAdd && ch === 'a') scope = 'tracked';
        else if (!isAdd && COMMIT_VALUE_SHORT.includes(ch)) { if (k === a.length - 1) i++; break; }
      }
      continue;
    }
    paths.push(a);
  }
  if (dryRun) return null;
  if (unknown || paths.some(p => !isLiteral(p))) return { scope: 'all', paths: [] };
  if (paths.length) return { scope: 'paths', paths };
  if (scope) return { scope, paths: [] };
  return null;
}

const lines = out => out.split('\n').map(l => l.trim()).filter(Boolean);
const gitOut = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

/** The changed Flow files, repository-relative, that this staging would add to the index. */
export function flowsStagedBy(staging, dir) {
  const spec = staging.scope === 'paths' ? ['--', ...staging.paths] : [];
  const found = new Set(lines(gitOut(dir, ['diff', '--name-only', ...spec])));
  if (staging.scope !== 'tracked') {
    for (const f of lines(gitOut(dir, ['ls-files', '--others', '--exclude-standard', '--full-name', ...spec]))) found.add(f);
  }
  return [...found].filter(f => FLOW.test(f)).sort();
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

    // nothing staged that is a Flow? then this gate has no opinion on this commit
    const staged = gitOut(root, ['diff', '--cached', '--', '*.flow-meta.xml']);
    if (!staged.trim()) continue;
    const stateFile = join(stateDirFor(root), 'last-verified-diff-hash');
    const current = createHash('sha1').update(staged).digest('hex');
    const last = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : '';
    if (current !== last) deny(UNCHECKED);
  }
  ok();
}
