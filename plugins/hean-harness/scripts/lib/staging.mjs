/**
 * What a `git add` or `git commit` stages as it runs, read from the command
 * text before the command does.
 *
 * Shared by the hooks that check a commit before git makes it: the Flow
 * description gate, the runbook compile check, and, through commit-index.mjs,
 * the per-story manifest check and the runbook stage gate. All need the same
 * answer to "what does this call stage", and copies of a parser drift.
 */

import { isLiteral } from './command-line.mjs';

// options that take the next word as their value, so it is not a path
const ADD_VALUE_OPTS = new Set(['--chmod', '--pathspec-from-file']);
const COMMIT_VALUE_OPTS = new Set(['-m', '--message', '-F', '--file', '-c', '--reedit-message',
  '-C', '--reuse-message', '-t', '--template', '--author', '--date', '--cleanup', '--fixup',
  '--squash', '--trailer']);
const COMMIT_VALUE_SHORT = 'mFcCt';

/**
 * What a `git add` or `git commit` stages as it runs, or null when it stages
 * nothing: { scope: 'paths'|'tracked'|'all', paths }. 'all' also stands for
 * anything the text cannot say, such as a pathspec file or a variable; that
 * result carries unknown: true, for a check that must not guess.
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
  if (unknown || paths.some(p => !isLiteral(p))) return { scope: 'all', paths: [], unknown: true };
  if (paths.length) return { scope: 'paths', paths };
  if (scope) return { scope, paths: [] };
  return null;
}

/**
 * Whether a `git add` or `git commit` picks hunks interactively (-p, --patch,
 * -i, --interactive). The staged content then differs from the working tree in
 * a way the text cannot say, so it counts as unknown staging.
 */
export function stagesInteractively(sub, args) {
  if (sub !== 'add' && sub !== 'stage' && sub !== 'commit') return false;
  for (const a of args) {
    if (a === '--') break;
    if (a === '--patch' || a === '--interactive') return true;
    if (/^-[A-Za-z]+$/.test(a)) {
      // a commit's -m/-F/-c/-C/-t take a value: letters after one of them are that value
      const flags = sub === 'commit' ? a.slice(1).split(/[mFcCt]/)[0] : a.slice(1);
      if (/[pi]/.test(flags)) return true;
    }
  }
  return false;
}
