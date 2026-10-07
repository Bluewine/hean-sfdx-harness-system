/**
 * Whether a repository enforces the @WORK-ID commit subject format.
 *
 * The answer is asked once, by setup, and kept in the repository's
 * .claude/hean-harness.json. The folder is ignored by git, and uninstall deletes
 * this file as one of the plugin's own files, so the answer belongs to one clone
 * and goes away with the install. The commit gate reads it
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
 * A hook setup did not write, or the plugin's copy edited since setup wrote
 * it, is never removed or overwritten without --replace-githook, because the
 * repository may rely on it. The plugin's copy unchanged since setup is updated
 * when the plugin ships a new one (scripts/lib/githooks.mjs). A repository that
 * tracks its own hooks in git owns them outright: the plugin installs no hook
 * there, leaves core.hooksPath to the repository, and ignores --replace-githook.
 */

import { existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, revert, category, init } from './manifest.mjs';
import { installDir, installFile, installGitConfig, getGitConfig } from './install.mjs';
import { repoTracksHooks } from './gitignore.mjs';
import { settingsFile, readSettings, writeSetting } from './settings.mjs';
import { HOOKS_DIR, realPath, hookState, writesHook, describeHook, keptLines, wroteLine,
         liveGitHooks, hooksPathKeptLines } from './githooks.mjs';

export { settingsFile, realPath, HOOKS_DIR };

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const HOOK_SOURCE = join(PLUGIN_ROOT, 'assets', 'githooks', 'commit-msg');

/** 'on', 'off', or null when setup has not asked in this repository. */
export function readChoice(repo) {
  const v = readSettings(repo).commitFormat;
  return v === 'on' || v === 'off' ? v : null;
}

export const writeChoice = (repo, value) => writeSetting(repo, 'commitFormat', value);

/**
 * Describe what applying a choice would do, and do it unless dryRun.
 * Returns the lines to print. Lines starting "!! " must reach the user.
 */
export function applyChoice(repo, choice, { replace = false, dryRun = false } = {}) {
  const out = [];
  const hook = join(repo, HOOKS_DIR, 'commit-msg');
  const hookExists = existsSync(hook);
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
    const state = hookState(hook, HOOK_SOURCE);
    const write = writesHook(state, replace);
    out.push(`Hook           ${hook}`);
    out.push(`               ${describeHook(state, replace)}`);
    out.push(`core.hooksPath ${hooksPath ?? 'unset'}`);
    const unset = hooksPath === undefined;
    // core.hooksPath replaces $GIT_DIR/hooks, so it stays unset while git runs hooks there
    const live = unset ? liveGitHooks(repo) : [];
    const setPath = unset && !live.length;
    const otherPath = !unset && hooksPath !== HOOKS_DIR;
    out.push(`               ${setPath ? `to set to ${HOOKS_DIR}` : live.length ? 'left unset: git runs hooks in its own folder'
      : otherPath ? 'points elsewhere, left as it is' : 'already correct'}`);
    if (!write && state !== 'current' && state !== 'missing') out.push(...keptLines(hook, state));
    if (live.length) out.push(...hooksPathKeptLines(repo, live, 'commit format check'));
    if (dryRun) return out;

    init();
    writeChoice(repo, 'on');
    if (write) {
      installDir(join(repo, HOOKS_DIR));
      installFile(HOOK_SOURCE, hook);
      chmodSync(hook, 0o755);
      out.push(wroteLine(state, hook));
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

  // off: undo only what this plugin recorded for this repository's commit-msg hook. While its
  // pre-commit hook is recorded there, core.hooksPath and the folder stay, because that hook needs them.
  const top = realPath(repo);
  const preCommit = realPath(join(repo, HOOKS_DIR, 'pre-commit'));
  const preCommitRecorded = load().changes.some(c => c.type === 'file-copy' && realPath(c.target) === preCommit);
  const mine = c => category(c) === 'githooks' && (
    (c.type === 'file-copy' && realPath(c.target) === realPath(hook)) ||
    (!preCommitRecorded && (realPath(c.target) === top || realPath(c.target).startsWith(join(top, HOOKS_DIR)))));
  const recorded = load().changes.filter(mine);
  const hookRecorded = recorded.some(c => c.type === 'file-copy');
  const pathRecorded = recorded.find(c => c.type === 'git-config');

  out.push(`Hook           ${hook}`);
  out.push(`               ${!hookExists ? 'not there'
    : hookRecorded ? 'put there by this plugin, to remove (a hook it replaced is restored)'
    : 'present, left as it is'}`);
  if (pathRecorded) {
    out.push(`core.hooksPath to go back to ${pathRecorded.existedBefore ? pathRecorded.previousValue : 'unset'}`);
  } else if (preCommitRecorded) {
    out.push(`core.hooksPath stays ${HOOKS_DIR}: the plugin's pre-commit hook there still needs it`);
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
