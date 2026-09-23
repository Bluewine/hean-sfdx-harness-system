#!/usr/bin/env node
/**
 * Keeps the repository's .claude folder, the git hook setup installs, and the
 * MCP server file setup writes out of git.
 *
 * Setup writes the project rules, memories and agents into .claude on each
 * clone, and every skill writes its output under .claude/skills/<skill-name>/
 * output/. All of it comes from the plugin or from one run on one clone, so the
 * whole folder is ignored rather than shared. Ignoring does not untrack a file
 * the repository already committed there.
 *
 * The .githooks folder is installed by setup on each clone, so a branch that
 * deletes it from the repository cannot take the hook away again.
 *
 * .mcp.json holds the Linear server setup adds. Each person signs in to that
 * server on their own machine, so the file is written per clone, not shared.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const IGNORE_LINES = ['.claude/', '.githooks/', '.mcp.json'];

export const COMMENT = '# hean-harness: installed or written on each clone, not shared';

export function repoRoot(start = process.cwd()) {
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return start; }
}

/** Which of our lines the repository's .gitignore is missing. */
export function missingLines(repo) {
  const gi = join(repo, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const have = new Set(existing.split('\n').map(l => l.trim()));
  return { file: gi, existing, missing: IGNORE_LINES.filter(l => !have.has(l)) };
}

/**
 * Append the lines that are not there already, so running setup twice does not
 * stack them up.
 */
export function ensureIgnored(repo) {
  const { file, existing, missing } = missingLines(repo);
  if (!missing.length) return { added: [], file };
  // close an unterminated last line, then leave one blank line above our block —
  // but no leading blank line when we are creating the file
  const sep = !existing ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
  appendFileSync(file, `${sep}${COMMENT}\n${missing.join('\n')}\n`);
  return { added: missing, file };
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
      for (const l of IGNORE_LINES) console.log(`    ${l}`);
      break;
    case 'status': {
      const { file, missing } = missingLines(repo);
      console.log(missing.length
        ? `  ${missing.length} of ${IGNORE_LINES.length} not in ${file}: ${missing.join(', ')}`
        : `  all ${IGNORE_LINES.length} present in ${file}`);
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
