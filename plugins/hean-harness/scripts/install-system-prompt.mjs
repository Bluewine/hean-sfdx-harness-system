#!/usr/bin/env node
/**
 * Installs the rules file and the claude alias that loads it.
 *
 * The rules file is copied to a fixed folder in the user's home directory,
 * not left inside the plugin. The plugin's own folder changes path every time
 * the plugin updates, which would break the alias.
 *
 * Every change is written to the install manifest so uninstall can undo it.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { STATE_DIR, init } from './lib/manifest.mjs';
import { installFile, installBlock } from './lib/install.mjs';
import { detectShell, aliasLine, claudeCommand, MARKER, SUPPORTED } from './lib/shell.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const SOURCE = join(PLUGIN_ROOT, 'assets', 'system-prompt', 'global-system-prompt.txt');
const DEST = join(STATE_DIR, 'global-system-prompt.txt');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const skipPermissions = !argv.includes('--no-skip-permissions');

const log = (...a) => console.log(...a);

function unsupportedShell(sh) {
  log(`Your shell is "${sh.name || 'unknown'}", which this installer does not write to.`);
  log(`It only writes to ${SUPPORTED.join(' and ')}, because those are the two it can verify.`);
  log('');
  log(`The rules file ${existsSync(DEST) ? 'is at' : 'will be at'} ${DEST}`);
  log('Everything else this setup installs is unaffected. Two ways to load the rules:');
  log('');
  log('  Right now, without changing any file — start Claude Code with:');
  log('');
  log(`    ${claudeCommand(DEST, { skipPermissions })}`);
  log('');
  log('  Or once, so you can keep typing just "claude" — add this line to the file');
  log('  your shell reads when it starts, then open a new terminal:');
  log('');
  log(`    ${aliasLine(DEST, { skipPermissions })}`);
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Cannot find the rules file that ships with this plugin: ${SOURCE}`);
    process.exit(1);
  }

  const sh = detectShell();
  log(`Shell           ${sh.name}  (${sh.shellPath || 'SHELL is not set'})`);
  log(`Startup file    ${sh.profile ?? 'not applicable'}`);
  log(`Rules file      ${DEST}`);
  log(`Alias includes  ${skipPermissions ? '--dangerously-skip-permissions' : 'no permission bypass'}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();

  // 1. rules file
  mkdirSync(STATE_DIR, { recursive: true });
  installFile(SOURCE, DEST);
  log(`Copied the rules file  (${readFileSync(DEST, 'utf8').trimEnd().split('\n').length} lines)`);

  // 2. alias
  if (!sh.supported) { log(''); unsupportedShell(sh); process.exit(2); }

  installBlock(sh.profile, MARKER, aliasLine(DEST, { skipPermissions }));
  log(`Added the alias to     ${sh.profile}`);
  log('');
  log('One more step. Run this, or open a new terminal:');
  log('');
  log(`  ${sh.reloadCommand}`);
}

main();
