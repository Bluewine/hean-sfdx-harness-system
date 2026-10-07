/**
 * The git hooks this plugin installs in a repository's .githooks folder, and
 * how setup tells its own copy from someone else's.
 *
 * A hook is the plugin's when the install record holds an entry for it whose
 * hash matches the file: setup wrote it and nobody changed it since. Comparing
 * with the plugin's current copy instead made every plugin update look like
 * someone else's hook, so a changed hook never reached a repository without
 * --replace-githook.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, init } from './manifest.mjs';
import { installDir, installFile, installGitConfig, getGitConfig } from './install.mjs';
import { repoTracksHooks } from './gitignore.mjs';

export const HOOKS_DIR = '.githooks';

/**
 * A path with symlinks resolved, including for a file that no longer exists:
 * the nearest existing parent is resolved and the rest appended. The same
 * folder can be recorded as /var/... and reported by git as /private/var/...
 */
export function realPath(p) {
  const rest = [];
  let cur = resolve(p);
  while (!existsSync(cur) && dirname(cur) !== cur) { rest.unshift(basename(cur)); cur = dirname(cur); }
  try { return join(realpathSync(cur), ...rest); } catch { return resolve(p); }
}

/**
 * 'missing'; 'current', the plugin's copy as it ships now; 'older', what setup
 * wrote, unchanged since, from an earlier plugin version; 'edited', what setup
 * wrote, changed since; 'unhashed', a file setup wrote before it recorded
 * hashes, so whether it changed since cannot be told; or 'foreign', a file
 * setup did not write.
 */
export function hookState(hook, source) {
  if (!existsSync(hook)) return 'missing';
  const current = readFileSync(hook);
  if (current.equals(readFileSync(source))) return 'current';
  const entry = load().changes.find(c => c.type === 'file-copy' && realPath(c.target) === realPath(hook));
  if (!entry) return 'foreign';
  if (!entry.hash) return 'unhashed';
  return entry.hash === createHash('sha256').update(current).digest('hex') ? 'older' : 'edited';
}

/** git's own hooks folder, $GIT_DIR/hooks, as an absolute path. */
const gitHooksDir = repo => resolve(repo, execFileSync('git', ['-C', repo, 'rev-parse', '--git-path', 'hooks'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());

/**
 * The hooks git runs from its own folder ($GIT_DIR/hooks) while core.hooksPath
 * is unset: every file there except git's *.sample examples, by name. Setting
 * core.hooksPath makes git stop running them, so setup leaves it unset while
 * any exist (Git LFS installs its hooks there).
 */
export function liveGitHooks(repo) {
  try {
    const dir = gitHooksDir(repo);
    return readdirSync(dir).filter(n => !n.endsWith('.sample') && statSync(join(dir, n)).isFile()).sort();
  } catch { return []; }
}

/** The lines that must reach the user when core.hooksPath stays unset because of liveGitHooks. */
export function hooksPathKeptLines(repo, live, check) {
  return ['', `!! NOT SET — core.hooksPath: git runs these hooks in ${gitHooksDir(repo)}: ${live.join(', ')}.`,
    `!! Setting core.hooksPath would stop them, so it stays unset, and the ${check} for terminal commits is off`,
    `!! until those hooks are moved to ${HOOKS_DIR}/ or core.hooksPath is set by hand.`];
}

/** Whether setup writes a hook found in this state. */
export const writesHook = (state, replace) =>
  state === 'missing' || state === 'older' || (replace && state !== 'current');

/** The plan line for a hook found in this state. */
export function describeHook(state, replace) {
  if (state === 'missing') return 'to add';
  if (state === 'current') return 'the plugin\'s copy, already in place';
  if (state === 'older') return 'the plugin\'s copy from an earlier version, unchanged since setup, to update';
  if (state === 'unhashed') return replace
    ? 'installed by setup before it recorded hashes, to replace with the plugin\'s copy (a backup is kept)'
    : 'installed by setup before it recorded hashes, left as it is';
  const found = state === 'edited' ? 'the plugin\'s copy, edited since setup' : 'present';
  return replace ? `${found}, to replace with the plugin's copy (a backup is kept)` : `${found}, left as it is`;
}

/** The lines that must reach the user when a hook is kept. */
export function keptLines(hook, state) {
  return ['', `!! KEPT — NOT CHANGED: ${hook}`,
    state === 'edited'
      ? '!! This is the plugin\'s copy, edited since setup installed it, so setup leaves it as it is.'
      : state === 'unhashed'
        ? '!! Setup installed this hook before it recorded hashes, so it cannot tell whether it was changed since, and leaves it as it is.'
        : '!! The hook is already there, so setup leaves it as it is.',
    '!! To replace it with the plugin\'s copy, run setup again with --replace-githook.'];
}

/** The line reporting a hook setup wrote. */
export const wroteLine = (state, hook) =>
  `${state === 'missing' ? 'Added' : state === 'older' ? 'Updated' : 'Replaced'} ${hook}`;

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PRE_COMMIT_SOURCE = join(PLUGIN_ROOT, 'assets', 'githooks', 'pre-commit');

/**
 * Put the pre-commit hook that checks the per-story manifest in place, and
 * point git at it. Only in an SFDX repository whose .githooks/ folder git does
 * not track: a tracked folder is the repository's, and commits made there in
 * Claude Code are still checked by the plugin's hook. Independent of the
 * commit format choice. Returns the lines to print; lines starting "!! " must
 * reach the user.
 */
export function applyPreCommit(repo, { replace = false, dryRun = false } = {}) {
  if (!existsSync(join(repo, 'sfdx-project.json'))) return [];
  const hook = join(repo, HOOKS_DIR, 'pre-commit');
  if (repoTracksHooks(repo)) {
    return [`Manifest hook  ${HOOKS_DIR}/ is tracked by the repository, so no pre-commit hook is installed`,
            '               the per-story manifest is checked only for commits made in Claude Code'];
  }
  const state = hookState(hook, PRE_COMMIT_SOURCE);
  const write = writesHook(state, replace);
  const hooksPath = getGitConfig(repo, 'core.hooksPath');
  // a kept hook setup did not write stays as inactive as it was
  const setPath = hooksPath === undefined && (write || state !== 'foreign');
  const live = setPath ? liveGitHooks(repo) : [];
  const out = [`Manifest hook  ${hook}`, `               ${describeHook(state, replace)}`];
  if (!write && state !== 'current' && state !== 'missing') out.push(...keptLines(hook, state));
  if (live.length) out.push(...hooksPathKeptLines(repo, live, 'manifest check'));
  if (dryRun) return out;

  init();
  if (write) {
    installDir(join(repo, HOOKS_DIR));
    installFile(PRE_COMMIT_SOURCE, hook);
    chmodSync(hook, 0o755);
    out.push(wroteLine(state, hook));
  }
  if (setPath && !live.length) {
    installGitConfig(repo, 'core.hooksPath', HOOKS_DIR);
    out.push(`Set core.hooksPath to ${HOOKS_DIR}`);
  } else if (hooksPath !== undefined && hooksPath !== HOOKS_DIR) {
    out.push(`core.hooksPath is ${hooksPath}, so git runs the hooks there and not ${hook}.`);
  }
  return out;
}
