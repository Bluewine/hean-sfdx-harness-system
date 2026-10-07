#!/usr/bin/env node
/**
 * Copies the per-story manifest check to a fixed folder,
 * <config>/hean-harness/hooks/, where the git pre-commit hook setup installs
 * runs it from.
 *
 * The plugin's own folder moves when the plugin updates, so a git hook
 * pointing there breaks after the next update. The files keep the plugin's
 * layout under the fixed folder, because the check finds branch-manifest.mjs,
 * and branch-manifest.mjs finds its library, by relative path. Setup clears
 * and copies them again on every run, so the copy matches the installed plugin.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATE_DIR, init } from './lib/manifest.mjs';
import { installDir, installFile } from './lib/install.mjs';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEST = join(STATE_DIR, 'hooks');
// manifest-check.mjs and everything it loads, directly or through branch-manifest.mjs
const FILES = [
  'scripts/lib/manifest-check.mjs',
  'scripts/lib/command-line.mjs',
  'scripts/lib/merge-base.mjs',
  'scripts/lib/paths.mjs',
  'scripts/lib/settings.mjs',
  'scripts/lib/shell.mjs',
  'skills/branch-manifest/scripts/branch-manifest.mjs'
];
const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  const missing = FILES.filter(f => !existsSync(join(PLUGIN_ROOT, f)));
  if (missing.length) {
    console.error(`Cannot find the manifest check files that ship with this plugin: ${missing.join(', ')}`);
    process.exit(1);
  }
  log(`Check          ${join(DEST, FILES[0])}`);
  log('               run by the .githooks/pre-commit hook setup installs in SFDX repositories');
  log('');
  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  for (const f of FILES) {
    installDir(dirname(join(DEST, f)));
    installFile(join(PLUGIN_ROOT, f), join(DEST, f));
  }
  log(`Copied ${FILES.length} files to ${DEST}`);
}

main();
