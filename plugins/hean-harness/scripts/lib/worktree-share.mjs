/**
 * Files a linked git worktree shares with the main checkout.
 *
 * `git worktree add` checks out committed files only, so a new worktree has
 * none of the git-ignored files setup and the agents keep in the main
 * checkout. Each shared file in the worktree becomes a symlink to the main
 * checkout's file, so a write in either place is one file. Claude Code does
 * the same for settings.local.json and auto memory; .claude/hean-harness.json
 * needs no link, because settingsFile() already resolves to the main checkout.
 *
 * Only files are linked, never folders, and only files git ignores in the main
 * checkout: a tracked file is the team's. When the two copies differ, nothing
 * changes until the user chooses (resolve), and every copy replaced is saved
 * to the backups folder first.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, statSync, readlinkSync, readFileSync, readdirSync,
         mkdirSync, symlinkSync, copyFileSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { backup } from './manifest.mjs';

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };

/** realpath of p, resolving symlinks in the nearest existing ancestor when p itself is missing. */
function realish(p) {
  const rest = [];
  let cur = resolve(p);
  for (;;) {
    try { return join(realpathSync(cur), ...rest.reverse()); }
    catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      rest.push(basename(cur));
      cur = up;
    }
  }
}

/** { worktree, main } when dir is inside a linked worktree, otherwise null. */
export function linkedWorktree(dir) {
  let top, common;
  try {
    top = git(dir, 'rev-parse', '--show-toplevel');
    common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  } catch { return null; }
  // A submodule's or bare repository's git folder is not named .git.
  if (!isAbsolute(common) || basename(common) !== '.git') return null;
  const main = dirname(common);
  if (real(top) === real(main)) return null;
  return { worktree: real(top), main: real(main) };
}

const filesIn = dir => {
  try { return readdirSync(dir).filter(n => { const s = lstatSync(join(dir, n)); return s.isFile() || s.isSymbolicLink(); }); }
  catch { return []; }
};
const dirsIn = dir => {
  try { return readdirSync(dir).filter(n => lstatSync(join(dir, n)).isDirectory()); }
  catch { return []; }
};

/** The candidates git ignores in the main checkout (one call; check-ignore prints only ignored paths). */
function ignoredIn(main, rels) {
  if (!rels.length) return new Set();
  const run = list => spawnSync('git', ['-C', main, 'check-ignore', '--stdin', '-z'],
    { input: list.join('\0') + '\0', encoding: 'utf8' });
  const r = run(rels);
  if (r.status === 0 || r.status === 1) return new Set((r.stdout || '').split('\0').filter(Boolean));
  // Any other status (128: a path goes through a symlinked folder) says nothing about the other paths,
  // so check each on its own; a path whose own check fails is not shared.
  const out = new Set();
  for (const rel of rels) {
    const one = run([rel]);
    if (one.status === 0) out.add(rel);
  }
  return out;
}

/** The candidates the worktree's branch tracks: a link there would show as a type change. */
function trackedIn(worktree, rels) {
  if (!rels.length) return new Set();
  const r = spawnSync('git', ['--literal-pathspecs', '-C', worktree, 'ls-files', '-z', '--', ...rels], { encoding: 'utf8' });
  return new Set((r.stdout || '').split('\0').filter(Boolean));
}

/** Every shared path, relative to the checkout root, found in either checkout. */
export function sharedPaths({ worktree, main }) {
  const found = new Set(['.mcp.json']);
  for (const root of [main, worktree]) {
    for (const f of filesIn(join(root, '.claude', 'rules'))) if (f.endsWith('.md')) found.add(`.claude/rules/${f}`);
    const mem = join(root, '.claude', 'agent-memory');
    for (const agent of dirsIn(mem)) for (const f of filesIn(join(mem, agent))) found.add(`.claude/agent-memory/${agent}/${f}`);
  }
  const candidates = [...found].sort();
  const ignored = ignoredIn(main, candidates);
  const inIgnored = candidates.filter(rel => ignored.has(rel));
  const tracked = trackedIn(worktree, inIgnored);
  return inIgnored.filter(rel => !tracked.has(rel));
}

const isRegularFile = p => { try { return lstatSync(p).isFile(); } catch { return false; } };
const same = (a, b) => readFileSync(a).equals(readFileSync(b));

/**
 * What to do with one shared path:
 * 'ok' (already linked), 'link', 'move', 'replace', 'conflict',
 * 'none' (neither side has it), 'skip' (the worktree entry is something else,
 * such as the user's own symlink or a folder).
 */
export function inspect({ worktree, main }, rel) {
  const w = join(worktree, rel), m = join(main, rel);
  // A symlinked parent folder makes w or m a different file from the one named: never touch either side.
  if (realish(dirname(w)) !== join(worktree, dirname(rel))) return 'skip';
  if (realish(dirname(m)) !== join(main, dirname(rel))) return 'skip';
  let ms = null;
  try { ms = lstatSync(m); } catch { /* missing */ }
  if (ms && !ms.isFile()) return 'skip';   // the main entry is a symlink or folder: never write through it
  const mainFile = Boolean(ms);
  let ws = null;
  try { ws = lstatSync(w); } catch { /* missing */ }
  if (!ws) return mainFile ? 'link' : 'none';
  if (ws.isSymbolicLink()) return resolve(dirname(w), readlinkSync(w)) === m ? 'ok' : 'skip';
  if (!ws.isFile()) return 'skip';
  if (real(w) === real(m)) return 'skip';
  if (!mainFile) return 'move';
  return same(w, m) ? 'replace' : 'conflict';
}

/** Point w at m. The link is made under a temporary name and renamed over w, so a failure leaves w as it was. */
function link(w, m) {
  mkdirSync(dirname(w), { recursive: true });
  const tmp = `${w}.hean-link-${process.pid}`;
  try {
    symlinkSync(m, tmp);
    renameSync(tmp, w);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Carry out 'link', 'move' or 'replace' for one path. */
function apply({ worktree, main }, rel, action) {
  const w = join(worktree, rel), m = join(main, rel);
  if (action === 'move') {
    mkdirSync(dirname(m), { recursive: true });
    copyFileSync(w, m);
  }
  if (action === 'replace') backup(w);
  link(w, m);
}

/** Link every shared path that can be linked; report the ones that differ. */
export function syncWorktree(dir) {
  const pair = linkedWorktree(dir);
  if (!pair) return null;
  const out = { ...pair, applied: [], conflicts: [], failures: [] };
  for (const rel of sharedPaths(pair)) {
    try {
      const action = inspect(pair, rel);
      if (action === 'conflict') { out.conflicts.push(rel); continue; }
      if (!['link', 'move', 'replace'].includes(action)) continue;
      apply(pair, rel, action);
      out.applied.push({ rel, action });
    } catch (e) { out.failures.push({ rel, error: e.message }); }
  }
  return out;
}

/**
 * Apply the user's choice for one differing file.
 * keep: 'worktree' | 'main' | 'merged' (mergedFrom: a file holding the merged content).
 * Returns { backups: [paths] }; throws with a plain message when the choice cannot apply.
 */
export function resolveConflict(dir, rel, keep, mergedFrom) {
  const pair = linkedWorktree(dir);
  if (!pair) throw new Error('This folder is not in a linked worktree.');
  if (!sharedPaths(pair).includes(rel)) throw new Error(`${rel} is not a shared file.`);
  if (inspect(pair, rel) !== 'conflict') throw new Error(`${rel} is not in conflict; nothing to resolve.`);
  if (!['worktree', 'main', 'merged'].includes(keep)) throw new Error('--keep takes worktree, main or merged.');
  if (keep === 'merged' && !(mergedFrom && existsSync(mergedFrom) && statSync(mergedFrom).isFile())) {
    throw new Error('--keep merged needs --merged-from <file holding the merged content>.');
  }
  const w = join(pair.worktree, rel), m = join(pair.main, rel);
  const saved = [];
  if (keep !== 'main') saved.push(backup(m));
  if (keep !== 'worktree') saved.push(backup(w));
  if (keep === 'worktree') copyFileSync(w, m);
  if (keep === 'merged') copyFileSync(mergedFrom, m);
  link(w, m);
  return { backups: saved.filter(Boolean) };
}
