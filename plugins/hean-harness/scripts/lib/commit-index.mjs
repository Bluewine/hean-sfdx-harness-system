/**
 * What each `git commit` in a Bash call will record, worked out before the
 * call runs.
 *
 * Shared by the per-story manifest check and the runbook stage gate. Both
 * judge the commit's content, not the index as it stands, so both need the
 * same answer for `git add f && git commit`, `git commit -a` and `git commit
 * <paths>`, and copies of that logic drift. The git pre-commit hook does not
 * use this file: git has already built the index there.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitCommands, repoOf, git } from './command-line.mjs';
import { stagingOf, stagesInteractively } from './staging.mjs';

/** The `git add` arguments that replay one staging. */
const ADD_ARGS = { paths: s => ['--', ...s.paths], tracked: () => ['-u'], all: () => ['-A'] };

/**
 * The files a commit by path records, as paths from the repository's top: the
 * files its paths match in the index (env names it) or in HEAD, as git lists
 * them. An untracked file inside a named folder is not among them, because git
 * commits only files it knows.
 */
function pathFiles(s, env) {
  const names = out => out.split('\0').filter(Boolean);
  return new Set([
    ...names(git(s.dir, 'ls-files', '-z', '--full-name', '--', ...s.paths, { env })),
    ...names(git(s.dir, 'ls-tree', '-r', '-z', '--name-only', '--full-name', 'HEAD', '--', ...s.paths))
  ]);
}

/**
 * A temporary index holding what the commit will record, { file, cleanup }:
 * the current index plus the stagings earlier in the command and the commit's
 * own (-a). A commit by path (own holds its paths) records instead HEAD plus
 * the working-tree state of the files its paths match in that index or in
 * HEAD. Throws when git cannot build it.
 */
export function commitIndex(root, earlier, own, byPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'commit-index-'));
  const file = join(scratch, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: file };
  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  try {
    const real = resolve(root, git(root, 'rev-parse', '--git-path', 'index'));
    if (!existsSync(real)) git(root, 'read-tree', 'HEAD', { env });
    else copyFileSync(real, file);
    for (const s of byPath ? earlier : [...earlier, ...own]) git(s.dir, 'add', ...ADD_ARGS[s.scope](s), { env });
    if (byPath) {
      const files = [...pathFiles(own[0], env)];
      git(root, 'read-tree', 'HEAD', { env });
      // update-index adds a file the working tree has and removes one it lacks, as the commit does
      if (files.length) git(root, 'update-index', '--add', '--remove', '-z', '--stdin', { env, input: files.join('\0') + '\0' });
    }
    return { file, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * Every `git commit` in the command, in order, with what it stages: yields
 * { c, root, dir, earlier, own, byPath, unknown }. earlier is the stagings the
 * same command ran before it in that repository, each with its folder and git
 * command; own is the commit's own staging (-a or paths); unknown is true when
 * any of them stages files the text cannot name. A --dry-run commit is left out.
 */
export function* commitsIn(command, sessionCwd) {
  const staged = new Map();   // root -> stagings earlier in this command, each with the folder it runs in
  for (const c of gitCommands(command, sessionCwd)) {
    if (c.sub !== 'add' && c.sub !== 'stage' && c.sub !== 'commit') continue;
    const root = repoOf(c, sessionCwd);
    if (!root) continue;
    const dir = c.dir ?? sessionCwd;
    const staging = stagesInteractively(c.sub, c.args) ? { scope: 'all', paths: [], unknown: true } : stagingOf(c.sub, c.args);
    if (c.sub !== 'commit') {
      if (staging) staged.set(root, [...(staged.get(root) ?? []), { ...staging, dir, c }]);
      continue;
    }
    const earlier = staged.get(root) ?? [];
    staged.delete(root);
    if (c.args.includes('--dry-run')) continue;
    const own = staging ? [{ ...staging, dir }] : [];
    yield { c, root, dir, earlier, own, byPath: staging?.scope === 'paths', unknown: [...earlier, ...own].some(s => s.unknown) };
  }
}
