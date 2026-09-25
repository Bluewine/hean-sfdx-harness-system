#!/usr/bin/env node
/**
 * Keeps the repository's .claude folder, the git hook setup installs, and the
 * MCP server file setup writes out of git.
 *
 * Setup writes the project rules, memories and agents into .claude on each
 * clone, and every skill writes its output under .claude/skills/<skill-name>/
 * output/. All of it comes from the plugin or from one run on one clone, so the
 * folder's contents are ignored rather than shared — except .claude/manifest/,
 * where each story's deploy manifest is committed for the team.
 *
 * `.claude/*` rather than `.claude/`: git never looks inside an ignored folder,
 * so after `.claude/` no negation can bring a subfolder back. `.claude/*`
 * ignores the folder's contents instead, and `!.claude/manifest/` below it
 * re-includes the manifests. The negation only applies to rules above it, so the
 * two are always written together and in that order. Ignoring does not untrack a
 * file the repository already committed there.
 *
 * The .githooks folder is installed by setup on each clone, so a branch that
 * deletes it from the repository cannot take the hook away again. A repository
 * that tracks its own hooks there owns the folder: its line is left out, because
 * ignoring a folder the repository commits stops a restored hook from being
 * added back, and a clean clone then has no folder for a script that expects one.
 * A `.githooks/` line an earlier setup wrote before the team started tracking
 * the folder does not go away on its own once that changes, so it is removed
 * from this plugin's own block the same way the old bare `.claude/` line is.
 *
 * .mcp.json holds the Linear server setup adds. Each person signs in to that
 * server on their own machine, so the file is written per clone, not shared.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const IGNORE_LINES = ['.claude/*', '!.claude/manifest/', '.githooks/', '.mcp.json'];

/** Written by earlier versions; it hides the whole folder and cancels the manifest exception. */
const OLD_CLAUDE_LINE = '.claude/';

/** Does git track anything at this path inside the repository? */
export function trackedUnder(repo, path) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-files', '--', path],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch { return false; }
}

/** The repository commits its own git hooks, so the hooks folder is its own. */
export const repoTracksHooks = repo => trackedUnder(repo, '.githooks');

/** The lines this repository gets. */
export function ignoreLines(repo) {
  return repoTracksHooks(repo) ? IGNORE_LINES.filter(l => l !== '.githooks/') : IGNORE_LINES;
}

export const COMMENT = '# hean-harness: installed or written on each clone, not shared';

export function repoRoot(start = process.cwd()) {
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return start; }
}

/**
 * Lines inside this plugin's own block — the comment line and the lines under
 * it, up to the next blank line — that equal `target`. A matching line anywhere
 * else in the file belongs to the owner and is left alone.
 */
function linesInBlock(existing, target) {
  const out = [];
  let inBlock = false;
  existing.split('\n').forEach((l, i) => {
    if (l.trim() === COMMENT) { inBlock = true; return; }
    if (!l.trim()) { inBlock = false; return; }
    if (inBlock && l.trim() === target) out.push(i);
  });
  return out;
}

/** The bare `.claude/` lines an earlier install wrote inside this plugin's own blocks. */
export const oldLines = existing => linesInBlock(existing, OLD_CLAUDE_LINE);

/** Which of our lines the repository's .gitignore is missing, and which old lines it still has. */
export function missingLines(repo) {
  const gi = join(repo, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const have = new Set(existing.split('\n').map(l => l.trim()));
  const lines = ignoreLines(repo);
  let missing = lines.filter(l => !have.has(l));
  // the negation only works below `.claude/*`, so a missing `.claude/*` brings its negation with it
  if (missing.includes('.claude/*') && !missing.includes('!.claude/manifest/')) {
    missing = ['.claude/*', '!.claude/manifest/', ...missing.filter(l => l !== '.claude/*')];
  }
  // a `.githooks/` line written before the repository tracked its own hooks is now stale
  const staleHooks = repoTracksHooks(repo) ? linesInBlock(existing, '.githooks/') : [];
  return { file: gi, existing, lines, missing, old: oldLines(existing), staleHooks };
}

/**
 * Drop the block's comment line once nothing of ours is left under it, and
 * collapse the blank line that removal would otherwise double up.
 */
function dropEmptyBlockComment(lines) {
  const ci = lines.findIndex(l => l.trim() === COMMENT);
  if (ci < 0) return lines;
  const after = lines[ci + 1];
  if (after !== undefined && after.trim() !== '') return lines;   // still has content
  const before = lines[ci - 1];
  const alsoDropAfter = before !== undefined && before.trim() === '' && after !== undefined && after.trim() === '';
  return lines.filter((_, i) => i !== ci && !(alsoDropAfter && i === ci + 1));
}

/**
 * Append the lines that are not there already, so running setup twice does not
 * stack them up. Also removes any stale lines this plugin's own block still
 * carries — the old bare `.claude/` line, and a `.githooks/` line left over
 * from before the repository tracked its own hooks.
 */
export function ensureIgnored(repo) {
  const { file, existing, missing, old, staleHooks } = missingLines(repo);
  const toDrop = [...old, ...staleHooks];
  let current = existing;
  if (toDrop.length) {
    let lines = existing.split('\n').filter((_, i) => !toDrop.includes(i));
    lines = dropEmptyBlockComment(lines);
    current = lines.join('\n');
    writeFileSync(file, current);
  }
  const removed = old.length ? [OLD_CLAUDE_LINE] : [];
  const removedHooksLine = staleHooks.length > 0;
  if (!missing.length) return { added: [], removed, removedHooksLine, file };
  // close an unterminated last line, then leave one blank line above our block —
  // but no leading blank line when we are creating the file
  const sep = !current ? '' : (current.endsWith('\n') ? '\n' : '\n\n');
  appendFileSync(file, `${sep}${COMMENT}\n${missing.join('\n')}\n`);
  return { added: missing, removed, removedHooksLine, file };
}

// ---- CLI -------------------------------------------------------------------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--repo');
  const repo = i >= 0 ? a[i + 1] : repoRoot();

  switch (a[0]) {
    case 'lines':
      console.log(`  in ${join(repo, '.gitignore')}:`);
      for (const l of ignoreLines(repo)) console.log(`    ${l}`);
      break;
    case 'status': {
      const { file, lines, missing } = missingLines(repo);
      console.log(missing.length
        ? `  ${missing.length} of ${lines.length} not in ${file}: ${missing.join(', ')}`
        : `  all ${lines.length} present in ${file}`);
      break;
    }
    case 'ensure': {
      const r = ensureIgnored(repo);
      console.log(r.added.length
        ? `  added ${r.added.length} line${r.added.length > 1 ? 's' : ''} to ${r.file}`
        : `  already ignored in ${r.file}`);
      break;
    }
    default:
      console.error(`hean-harness gitignore

Usage: gitignore.mjs <command> [--repo R]

  lines    the lines setup adds to the repository's .gitignore
  status   which of them are there and which are not
  ensure   add the missing ones`);
      process.exit(a[0] ? 1 : 0);
  }
}
