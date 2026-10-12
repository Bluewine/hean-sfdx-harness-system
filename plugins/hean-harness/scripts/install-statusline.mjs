#!/usr/bin/env node
/**
 * Installs the status line — the three lines Claude Code prints at the bottom
 * of the terminal: location and turn, commit preference and orgs, model and
 * session meter.
 *
 * Nothing is copied. The setting holds a launcher that finds this plugin's
 * current version folder through installed_plugins.json on every run, so a
 * plugin update reaches the status line without running setup again, and the
 * script imports the plugin's own libraries. See lib/statusline-launcher.mjs.
 *
 * refreshInterval re-runs it every 5 seconds: Claude Code's own refreshes do
 * not fire for a change made in another session, such as a commit preference.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installJsonKey } from './lib/install.mjs';
import { claudeDir } from './lib/paths.mjs';
import { SCRIPT, pluginsRoot, pluginId, launcherCommand } from './lib/statusline-launcher.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const SOURCE = join(PLUGIN_ROOT, SCRIPT);
const SETTINGS = join(claudeDir(), 'settings.json');

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Cannot find the status line script that ships with this plugin: ${SOURCE}`);
    process.exit(1);
  }
  const id = pluginId(PLUGIN_ROOT);
  if (!id) {
    console.error(`Cannot tell which installed plugin this is from its folder: ${PLUGIN_ROOT}`);
    process.exit(1);
  }
  const root = pluginsRoot();

  log(`Script         ${SCRIPT}, in the folder ${join(root, 'installed_plugins.json')} names for ${id}`);
  log(`Setting        statusLine in ${SETTINGS}, refreshed every 5 seconds`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  const r = installJsonKey(SETTINGS, 'statusLine',
    { type: 'command', command: launcherCommand(root, id), refreshInterval: 5 });
  log(r.hadKey
    ? 'Replaced the status line setting. Your previous one is recorded and comes back on uninstall.'
    : 'Set the status line.');

  log('');
  log('This shows up in your next session.');
}

main();
