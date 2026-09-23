#!/usr/bin/env node
/**
 * Installs the status line — the line Claude Code prints at the bottom of the
 * terminal showing the folder, branch, Salesforce org and token usage.
 *
 * The script goes in a fixed folder in the home directory, and the setting
 * points at it by full path. The plugin's own folder moves when the plugin
 * updates, so a setting pointing there would break.
 *
 * The script runs on Node, so it needs nothing beyond what the sf CLI already
 * requires. Claude Code reads the setting at session start, so a change here
 * shows up in the next session rather than this one.
 */

import { existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { STATE_DIR, init } from './lib/manifest.mjs';
import { installFile, installJsonKey } from './lib/install.mjs';
import { shQuote } from './lib/shell.mjs';
import { claudeDir } from './lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const SOURCE = join(PLUGIN_ROOT, 'assets', 'statusline', 'statusline-command.mjs');
const DEST = join(STATE_DIR, 'statusline-command.mjs');
const SETTINGS = join(claudeDir(), 'settings.json');

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Cannot find the status line script that ships with this plugin: ${SOURCE}`);
    process.exit(1);
  }

  log(`Script         ${DEST}`);
  log(`Setting        statusLine in ${SETTINGS}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  installFile(SOURCE, DEST);
  chmodSync(DEST, 0o755);

  const r = installJsonKey(SETTINGS, 'statusLine', { type: 'command', command: `node ${shQuote(DEST)}` });
  log(r.hadKey
    ? 'Replaced the status line setting. Your previous one is recorded and comes back on uninstall.'
    : 'Set the status line.');

  log('');
  log('This shows up in your next session.');
}

main();
