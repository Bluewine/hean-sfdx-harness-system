#!/usr/bin/env node
/**
 * Refuses a `git commit` whose per-story manifest, .claude/manifest/<WORK-ID>.xml,
 * does not list what the commit records, and names the one command that puts
 * the rebuilt file in place.
 *
 * The check is scripts/lib/manifest-check.mjs, shared with the git pre-commit
 * hook. This hook runs before the command does, so it first builds the index
 * the commit will record in a temporary file: the current index, plus what the
 * same command stages earlier (`git add f && git commit`), plus `-a`; or, for
 * `git commit <paths>`, HEAD plus the files git knows under those paths.
 * Staging the text cannot name — a variable, a glob, a pathspec file, picked
 * hunks — is not guessed: the commit goes through with a "!!" line.
 *
 * Claude Code runs every PreToolUse hook at once, so this hook cannot see
 * whether another check refuses the same call. It therefore writes nothing
 * into the repository and runs no other hook: the rebuilt manifest goes
 * outside the repository, and the refusal's command copies and stages it. That
 * command and the retried commit are two Bash calls: one call that copies and
 * commits is checked before the copy runs, and is refused again.
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { GIT_VALUE_OPTS, gitCommands, repoOf, git } from '../scripts/lib/command-line.mjs';
import { stagingOf, stagesInteractively } from '../scripts/lib/staging.mjs';
import { shQuote } from '../scripts/lib/shell.mjs';
import {
  DEADLINE_MS, manifestTarget, checkManifest, writeManifest, stageCommand, refusalText, notChecked
} from '../scripts/lib/manifest-check.mjs';

const SELF = 'manifest-commit-check.mjs';

/** A word as it would be typed: quoted only when the shell would read it otherwise. */
const word = w => /^[\w@%+=:,./-]+$/.test(w) ? w : shQuote(w);

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
function commitIndex(root, earlier, own, byPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'manifest-index-'));
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
 * git's options before the subcommand, for a retry run from the folder the
 * commit ran in: -C is dropped (the retry starts with that `cd`), --git-dir and
 * --work-tree are written as the absolute folders they named, the rest is kept.
 */
function retryGlobals(c) {
  const out = [];
  const g = c.globals ?? [];
  for (let i = 0; i < g.length; i++) {
    const option = g[i];
    const name = option.split('=')[0];
    const words = GIT_VALUE_OPTS.has(option) ? [option, g[++i]] : [option];
    if (name !== '-C' && name !== '--git-dir' && name !== '--work-tree') out.push(...words);
  }
  if (c.gitDir) out.push(`--git-dir=${c.gitDir}`);
  if (c.workTree) out.push(`--work-tree=${c.workTree}`);
  return out;
}

/**
 * The commands to run, written to work from the session's folder: { next,
 * retry }. next copies and stages the rebuilt file, or removes an empty one;
 * retry is the commit by path again with the manifest named, after the git add
 * commands the refused call ran before it (earlier), else null.
 */
function nextCommands(c, root, target, kind, scratchFile, sessionCwd, byPath, earlier) {
  const file = join(root, target.rel);
  const stage = stageCommand(root, target, kind, scratchFile);
  if (!byPath) return { next: stage, retry: null };
  let at = sessionCwd;
  const typed = (cmd, extra = '') => {
    const where = cmd.dir ?? sessionCwd;
    const cd = where === at ? '' : `cd ${shQuote(where)} && `;
    at = where;
    return `${cd}git ${[...retryGlobals(cmd), cmd.sub, ...cmd.args].map(word).join(' ')}${extra}`;
  };
  const adds = earlier.map(e => typed(e.c));
  return { next: stage, retry: [...adds, typed(c, ` ${shQuote(file)}`)].join(' && ') };
}

/**
 * Check every commit in the command, in order: { warnings, refusal? }. The
 * first stale or empty manifest stops the walk; nothing is written into the
 * repository.
 */
export function commitCheck(command, sessionCwd, deadline = Date.now() + DEADLINE_MS) {
  const staged = new Map();   // root -> stagings earlier in this command, each with the folder it runs in
  const warnings = [];
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
    const target = manifestTarget(root);
    if (!target) continue;
    const own = staging ? [{ ...staging, dir }] : [];
    if ([...earlier, ...own].some(s => s.unknown)) {
      warnings.push(notChecked('the command stages files its text does not name (a variable, a glob, a pathspec file or picked hunks)'));
      continue;
    }
    const byPath = staging?.scope === 'paths';
    let index;
    try {
      index = commitIndex(root, earlier, own, byPath);
    } catch (e) {
      warnings.push(notChecked(`the index this commit records could not be built (${e.message.split('\n')[0]})`));
      continue;
    }
    let result;
    try { result = checkManifest({ root, target, indexFile: index.file, deadline }); }
    finally { index.cleanup(); }
    if (result.kind === 'unchecked') { warnings.push(notChecked(result.reason)); continue; }
    if (result.kind !== 'stale' && result.kind !== 'empty') continue;
    const scratchFile = result.kind === 'stale' ? writeManifest(root, target, result.xml) : null;
    const { next, retry } = nextCommands(c, root, target, result.kind, scratchFile, sessionCwd, byPath, earlier);
    const text = refusalText(target, result, next, retry, { restaged: earlier.length > 0 });
    return { warnings, refusal: { root, target, result, text } };
  }
  return { warnings };
}

const isMain = process.argv[1] && process.argv[1].endsWith(SELF);
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (input.tool_name !== 'Bash') process.exit(0);
  const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
  let r;
  try { r = commitCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd()); }
  catch (e) { r = { warnings: [notChecked(e.message)] }; }
  if (r.refusal) {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.refusal.text } });
  }
  if (r.warnings.length) {
    const text = r.warnings.join('\n');
    emit({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
  }
  process.exit(0);
}
