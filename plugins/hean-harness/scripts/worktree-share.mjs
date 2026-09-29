#!/usr/bin/env node
/**
 * Shows, links and resolves the files a linked worktree shares with the main
 * checkout (see lib/worktree-share.mjs). Acts on the current folder.
 *
 *   status                                   list each shared file and what sync would do
 *   sync                                     link what can be linked, list what differs
 *   resolve --file <rel> --keep worktree|main|merged [--merged-from <file>]
 */

import { linkedWorktree, sharedPaths, inspect, syncWorktree, resolveConflict } from './lib/worktree-share.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const log = (...a) => console.log(...a);
const cwd = process.cwd();

function main() {
  if (cmd === 'status') {
    const pair = linkedWorktree(cwd);
    if (!pair) { log('This folder is not a linked worktree, so nothing is shared.'); return 0; }
    log(`Worktree       ${pair.worktree}`);
    log(`Main checkout  ${pair.main}`);
    for (const rel of sharedPaths(pair)) {
      try { log(`  ${inspect(pair, rel).padEnd(9)} ${rel}`); }
      catch (e) { log(`  ${'failed'.padEnd(9)} ${rel}  ${e.message}`); }
    }
    return 0;
  }
  if (cmd === 'sync') {
    const r = syncWorktree(cwd);
    if (!r) { log('This folder is not a linked worktree, so nothing is shared.'); return 0; }
    if (!r.applied.length && !r.conflicts.length && !r.failures.length) log('Shared files: nothing to change.');
    for (const a of r.applied) log(`  ${a.action.padEnd(8)} ${a.rel}`);
    for (const f of r.failures) log(`  failed   ${f.rel}  ${f.error}`);
    for (const c of r.conflicts) log(`  differs  ${c}`);
    return 0;
  }
  if (cmd === 'resolve') {
    const file = opt('file'), keep = opt('keep');
    if (!file || !keep) { console.error('resolve needs --file <rel> and --keep worktree|main|merged.'); return 1; }
    try {
      const r = resolveConflict(cwd, file, keep, opt('merged-from'));
      log(`Resolved ${file}: kept the ${keep} copy; the worktree entry is now a link to the main checkout.`);
      for (const b of r.backups) log(`  backup  ${b}`);
      return 0;
    } catch (e) { console.error(e.message); return 1; }
  }
  console.error('Usage: worktree-share.mjs status | sync | resolve --file <rel> --keep worktree|main|merged [--merged-from <file>]');
  return 1;
}

process.exit(main());
