#!/usr/bin/env node
/**
 * Turns on Claude Code's task tools — TaskCreate, TaskUpdate, TaskList and
 * TaskGet — by setting CLAUDE_CODE_ENABLE_TODO_TOOLS in the env block of the
 * user's settings.json (the file the status line step also writes to).
 *
 * Claude Code 2.1.233 and later turns these tools off by default on newer
 * models (Opus 4.8, Sonnet 5, Fable 5 and later) unless this variable is set.
 * Claude Code reads the setting at session start, so a change here shows up in
 * the next session rather than this one.
 */

import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installJsonKey } from './lib/install.mjs';
import { claudeDir } from './lib/paths.mjs';

const SETTINGS = join(claudeDir(), 'settings.json');
const KEY = 'env.CLAUDE_CODE_ENABLE_TODO_TOOLS';

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  log(`Setting        ${KEY} in ${SETTINGS}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  const r = installJsonKey(SETTINGS, KEY, '1');
  log(r.hadKey
    ? 'Replaced the task tools setting. Your previous one is recorded and comes back on uninstall.'
    : 'Turned on the task tools (TaskCreate, TaskUpdate, TaskList, TaskGet).');

  log('');
  log('This shows up in your next session.');
}

main();
