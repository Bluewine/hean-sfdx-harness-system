/**
 * Whether a repository enforces the @WORK-ID commit subject format.
 *
 * The answer is asked once, by setup, and kept in the repository's .claude
 * folder. That folder is ignored by git and deleted on uninstall, so the answer
 * belongs to one clone and goes away with the install. The commit gate reads it
 * on every commit: no file means setup never ran here, and nothing is enforced.
 *
 * The switch has two effects, kept together here so setup and the
 * commit-format skill cannot disagree:
 *
 *   on   the gate refuses a subject without a work item reference, and the
 *        commit-msg hook is installed for commits typed outside Claude Code
 *   off  the gate lets every subject through, and the hook is removed when
 *        this plugin put it there
 *
 * A hook the repository had before is never removed or overwritten without
 * --replace-githook, because the repository may rely on it. A repository that
 * tracks its own hooks in git owns them outright: the plugin installs no hook
 * there, leaves core.hooksPath to the repository, and ignores --replace-githook.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, revert, category, init } from './manifest.mjs';
import { installDir, installFile, installGitConfig, getGitConfig } from './install.mjs';
import { repoTracksHooks } from './gitignore.mjs';

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const HOOK_SOURCE = join(PLUGIN_ROOT, 'assets', 'githooks', 'commit-msg');
export const HOOKS_DIR = '.githooks';

export const settingsFile = repo => join(repo, '.claude', 'hean-harness.json');

/** 'on', 'off', or null when setup has not asked in this repository. */
export function readChoice(repo) {
  try {
    const v = JSON.parse(readFileSync(settingsFile(repo), 'utf8')).commitFormat;
    return v === 'on' || v === 'off' ? v : null;
  } catch { return null; }
}

export function writeChoice(repo, value) {
  const file = settingsFile(repo);
  let json = {};
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { /* new file */ }
  json.commitFormat = value;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

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

/** Is the hook at this path the plugin's own copy? */
const isOurs = hook =>
  existsSync(hook) && readFileSync(hook, 'utf8') === readFileSync(HOOK_SOURCE, 'utf8');

/**
 * Describe what applying a choice would do, and do it unless dryRun.
 * Returns the lines to print. Lines starting "!! " must reach the user.
 */
export function applyChoice(repo, choice, { replace = false, dryRun = false } = {}) {
  const out = [];
  const hook = join(repo, HOOKS_DIR, 'commit-msg');
  const hookExists = existsSync(hook);
  const ours = isOurs(hook);
  const hooksPath = getGitConfig(repo, 'core.hooksPath');

  out.push(`Commit format  ${choice}  (${settingsFile(repo)})`);

  if (choice === 'on' && repoTracksHooks(repo)) {
    out.push(`Hook           ${HOOKS_DIR}/ is tracked by the repository, so its own hooks apply`);
    out.push('               no plugin hook installed, core.hooksPath left to the repository');
    if (replace) out.push('               --replace-githook ignored: a tracked hook belongs to the repository');
    out.push('');
    out.push(`!! KEPT — NOT CHANGED: ${join(repo, HOOKS_DIR)}`);
    out.push('!! The repository commits its own hooks there. The plugin gate still checks commits');
    out.push('!! made in Claude Code; commits typed in a terminal follow the repository\'s hook.');
    if (dryRun) return out;
    init();
    writeChoice(repo, 'on');
    return out;
  }

  if (choice === 'on') {
    const write = !hookExists || (replace && !ours);
    out.push(`Hook           ${hook}`);
    out.push(`               ${!hookExists ? 'to add'
      : ours ? 'the plugin\'s copy, already in place'
      : replace ? 'present, to replace with the plugin\'s copy (a backup is kept)'
      : 'present, left as it is'}`);
    out.push(`core.hooksPath ${hooksPath ?? 'unset'}`);
    const setPath = hooksPath === undefined;
    const otherPath = !setPath && hooksPath !== HOOKS_DIR;
    out.push(`               ${setPath ? `to set to ${HOOKS_DIR}` : otherPath ? 'points elsewhere, left as it is' : 'already correct'}`);
    if (hookExists && !ours && !replace) {
      out.push('');
      out.push(`!! KEPT — NOT CHANGED: ${hook}`);
      out.push('!! The hook is already there, so setup leaves it as it is.');
      out.push('!! To replace it with the plugin\'s copy, run setup again with --replace-githook.');
    }
    if (dryRun) return out;

    init();
    writeChoice(repo, 'on');
    if (write) {
      installDir(join(repo, HOOKS_DIR));
      installFile(HOOK_SOURCE, hook);
      chmodSync(hook, 0o755);
      out.push(`${hookExists ? 'Replaced' : 'Added'} ${hook}`);
    }
    if (setPath) {
      installGitConfig(repo, 'core.hooksPath', HOOKS_DIR);
      out.push(`Set core.hooksPath to ${HOOKS_DIR}`);
    }
    if (otherPath) {
      out.push(`core.hooksPath is ${hooksPath}, so git runs the hooks there and not ${hook}.`);
      out.push(`Run "git config core.hooksPath ${HOOKS_DIR}" if this hook should run instead.`);
    }
    return out;
  }

  // off: undo only what this plugin recorded for this repository's hook
  const top = realPath(repo);
  const mine = c => category(c) === 'githooks' &&
    (realPath(c.target) === top || realPath(c.target).startsWith(join(top, HOOKS_DIR)));
  const recorded = load().changes.filter(mine);
  const hookRecorded = recorded.some(c => c.type === 'file-copy');
  const pathRecorded = recorded.find(c => c.type === 'git-config');

  out.push(`Hook           ${hook}`);
  out.push(`               ${!hookExists ? 'not there'
    : hookRecorded ? 'put there by this plugin, to remove (a hook it replaced is restored)'
    : 'present, left as it is'}`);
  if (pathRecorded) {
    out.push(`core.hooksPath to go back to ${pathRecorded.existedBefore ? pathRecorded.previousValue : 'unset'}`);
  }
  if (hookExists && !hookRecorded) {
    out.push('');
    out.push(`!! KEPT — NOT CHANGED: ${hook}`);
    out.push('!! This hook was not put there by this plugin, so it stays.');
    if (pathRecorded) {
      out.push(`!! Git runs it only while core.hooksPath points at ${HOOKS_DIR}, and that setting`);
      out.push('!! goes back to what it was before setup.');
    }
  }
  if (dryRun) return out;

  init();
  writeChoice(repo, 'off');
  if (recorded.length) {
    const results = revert({ only: mine });
    for (const r of results.filter(r => !r.kept)) {
      out.push(`${r.ok ? 'Undid' : 'Could not undo'}  ${r.action}  ${r.target}${r.note ? `  (${r.note})` : ''}`);
    }
  }
  return out;
}
