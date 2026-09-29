#!/usr/bin/env node
/**
 * At session start and end inside a linked git worktree, links the worktree's
 * shared git-ignored files to the main checkout's (lib/worktree-share.mjs).
 *
 * Session start: files whose two copies differ are listed for Claude, who asks
 * the user about each one; nothing changes until the user chooses. Session end:
 * links and moves only, silently, since the session is closing; the next
 * session start in that worktree reports anything still differing.
 *
 * Never fails a session: any error is swallowed and it exits 0.
 */

import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(PLUGIN, 'scripts', 'worktree-share.mjs');

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const { syncWorktree } = await import('../scripts/lib/worktree-share.mjs');
  const r = syncWorktree(input.cwd ?? process.cwd());
  const ownSettings = r && input.hook_event_name === 'SessionStart' && (() => {
    try {
      const own = join(r.worktree, '.claude', 'hean-harness.json');
      // a symlinked worktree .claude folder leads to the main checkout's own file, which is not a leftover
      const mainOwn = join(r.main, '.claude', 'hean-harness.json');
      let mainReal = mainOwn;
      try { mainReal = realpathSync(mainOwn); } catch { /* no main file yet: the worktree file is the only copy */ }
      return lstatSync(own).isFile() && realpathSync(own) !== mainReal;
    } catch { return false; }
  })();
  if (r && input.hook_event_name === 'SessionStart' && (r.conflicts.length || r.failures.length || ownSettings)) {
    const lines = [];
    if (r.conflicts.length) {
      lines.push(`!! Shared files differ between this worktree and the main checkout (${r.main}):`);
      for (const rel of r.conflicts) {
        lines.push(`  ${rel}`);
        lines.push(`    worktree:      ${join(r.worktree, rel)}`);
        lines.push(`    main checkout: ${join(r.main, rel)}`);
      }
      lines.push('');
      lines.push('Before other work, show the user the difference for each file and ask about it in its own');
      lines.push('AskUserQuestion (header "Shared file") with the options "Merge", "Keep worktree copy" and');
      lines.push('"Keep main copy". Apply each answer with:');
      lines.push(`  node "${CLI}" resolve --file <file> --keep worktree|main`);
      lines.push('For "Merge", write the merged content to a temporary file, show it to the user, then run the');
      lines.push('same command with --keep merged --merged-from <temporary file>.');
    }
    for (const f of r.failures) lines.push(`!! Could not link ${f.rel} to the main checkout: ${f.error}`);
    if (ownSettings) {
      lines.push(`!! ${join(r.worktree, '.claude', 'hean-harness.json')} is no longer read; answers are saved in ${join(r.main, '.claude', 'hean-harness.json')}. Compare them and save any missing role with /hean-harness:org-roles, then delete the worktree copy.`);
    }
    console.log(lines.join('\n'));
  }
} catch {
  // never let this stop a session
}
process.exit(0);
