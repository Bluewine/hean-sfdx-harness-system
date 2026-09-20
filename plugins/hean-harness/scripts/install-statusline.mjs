#!/usr/bin/env node
/**
 * Installs the status line — the line Claude Code prints at the bottom of the
 * terminal showing the folder, branch, Salesforce org and token usage.
 *
 * The script goes in a fixed folder in the home directory, and the setting
 * points at it by full path. The plugin's own folder moves when the plugin
 * updates, so a setting pointing there would break.
 *
 * The script calls jq. If jq is missing the status line prints nothing, so
 * this warns rather than failing.
 */

import { existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { STATE_DIR, init } from './lib/manifest.mjs';
import { installFile, installJsonKey } from './lib/install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const SOURCE = join(PLUGIN_ROOT, 'assets', 'statusline', 'statusline-command.sh');
const DEST = join(STATE_DIR, 'statusline-command.sh');
const SETTINGS = join(homedir(), '.claude', 'settings.json');

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function hasJq() {
  try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Cannot find the status line script that ships with this plugin: ${SOURCE}`);
    process.exit(1);
  }

  const jq = hasJq();
  log(`Script         ${DEST}`);
  log(`Setting        statusLine in ${SETTINGS}`);
  log(`jq installed   ${jq ? 'yes' : 'NO — the status line will print nothing until you install it'}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');
  installFile(SOURCE, DEST);
  chmodSync(DEST, 0o755);

  const r = installJsonKey(SETTINGS, 'statusLine', { type: 'command', command: `bash ${DEST}` });
  log(r.hadKey
    ? 'Replaced the status line setting. Your previous one is recorded and comes back on uninstall.'
    : 'Set the status line.');

  if (!jq) {
    log('');
    log('jq is not installed, and the status line needs it. Install it with:');
    log('  brew install jq        (macOS)');
    log('  sudo apt install jq    (Debian or Ubuntu)');
  }
  log('');
  log('This shows up in your next session.');
}

main();
