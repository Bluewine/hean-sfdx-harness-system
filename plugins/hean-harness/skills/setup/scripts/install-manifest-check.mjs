#!/usr/bin/env node
/**
 * Copies the per-story manifest check, the Collection Filter check, the
 * feature toggle check and the Apex class header check to a fixed folder, <config>/hean-harness/hooks/, where the git pre-commit hook
 * setup installs runs them from.
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

import { STATE_DIR, init } from '../../../scripts/lib/manifest.mjs';
import { installDir, installFile } from '../../../scripts/lib/install.mjs';

const PLUGIN_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const DEST = join(STATE_DIR, 'hooks');
// In copy order: every file after the files it loads, so a copy stopped part way never pairs a new file
// with an old one it loads. The libraries, then branch-manifest.mjs, then manifest-check.mjs, which loads
// it, then flow-collection-filter.mjs, flow-feature-toggle.mjs and apex-class-header.mjs, which load
// manifest-check.mjs, and last pre-commit-checks.mjs, which runs the four in one node process.
const FILES = [
  'scripts/lib/command-line.mjs',
  'scripts/lib/merge-base.mjs',
  'scripts/lib/paths.mjs',
  'scripts/lib/settings.mjs',
  'scripts/lib/shell.mjs',
  'scripts/lib/org-roles.mjs',
  'skills/branch-manifest/scripts/branch-manifest.mjs',
  'scripts/lib/manifest-check.mjs',
  'scripts/lib/flow-collection-filter.mjs',
  'scripts/lib/flow-feature-toggle.mjs',
  'scripts/lib/apex-class-header.mjs',
  'scripts/lib/pre-commit-checks.mjs'
];
// The two files the "Checks" lines name: the manifest check and the last of the four checks
const SHOWN = ['scripts/lib/manifest-check.mjs', 'scripts/lib/apex-class-header.mjs'];
const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  const missing = FILES.filter(f => !existsSync(join(PLUGIN_ROOT, f)));
  if (missing.length) {
    console.error(`Cannot find the check files that ship with this plugin: ${missing.join(', ')}`);
    process.exit(1);
  }
  log(`Checks         ${join(DEST, SHOWN[0])}`);
  log(`               ${join(DEST, SHOWN[1])}`);
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
