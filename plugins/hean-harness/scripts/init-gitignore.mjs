#!/usr/bin/env node
/**
 * Adds the skill-output pattern to the repository's .gitignore.
 *
 * It asks nothing and records what it wrote, so uninstall takes out our lines
 * and leaves the rest of the file alone.
 */

import { execFileSync } from 'node:child_process';

import { repoRoot, ensureIgnored, missingLines, IGNORE_LINES } from './lib/gitignore.mjs';
import { init } from './lib/manifest.mjs';
import { recordExternal } from './lib/install.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

function main() {
  let repo = repoArg >= 0 ? argv[repoArg + 1] : null;
  if (!repo) {
    try { repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
    catch { repo = repoRoot(); }
  }

  const { file, missing } = missingLines(repo);
  log(`.gitignore      ${file}`);
  for (const l of IGNORE_LINES) {
    log(`                ${missing.includes(l) ? 'to add ' : 'present'}  ${l}`);
  }
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');
  const r = ensureIgnored(repo);
  if (r.added.length) {
    log(`Added ${r.added.length} line${r.added.length > 1 ? 's' : ''} so skill output is never committed`);
    // ours to undo, and only the lines we actually wrote
    recordExternal(`gitignore:${r.file}`,
      `remove these lines from ${r.file}: ${r.added.join(', ')} (and the comment above them)`);
  } else {
    log(`Already ignored in ${r.file} — left as it is`);
  }
}

main();
