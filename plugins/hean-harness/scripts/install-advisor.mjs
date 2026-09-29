#!/usr/bin/env node
/**
 * Turns on Claude Code's advisor with Opus as the advisor model, by setting two
 * keys in the user's settings.json (the file the status line and task tools
 * steps also write to):
 *
 *   env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL = "1"
 *     Makes the advisor available without waiting for Anthropic's server-side
 *     feature flag. It does not choose a model. The variable is not in the
 *     published documentation, so a later Claude Code version can rename or
 *     drop it; advisorModel alone still works wherever the flag is on.
 *   advisorModel = "opus"
 *     Chooses the advisor. Claude Code refuses an advisor less capable than the
 *     main model, so a session whose main model is Fable runs without one.
 *
 * Both keys sit in settings.json rather than in the alias, so they apply however
 * claude is started. A plugin's own settings.json cannot carry them, because
 * Claude Code keeps only `agent` and `subagentStatusLine` from it.
 * Claude Code reads the settings at session start, so a change here shows up in
 * the next session rather than this one.
 */

import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installJsonKey } from './lib/install.mjs';
import { claudeDir } from './lib/paths.mjs';

const SETTINGS = join(claudeDir(), 'settings.json');
const KEYS = [
  ['env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL', '1'],
  ['advisorModel', 'opus']
];

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  for (const [key, value] of KEYS) log(`Setting        ${key} = ${value} in ${SETTINGS}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  for (const [key, value] of KEYS) {
    const r = installJsonKey(SETTINGS, key, value);
    log(r.hadKey
      ? `Replaced ${key} (was ${JSON.stringify(r.previous)}). Your previous value is recorded and comes back on uninstall.`
      : `Set ${key}.`);
  }

  log('');
  log('The advisor uses Opus from your next session. Turn it off in a session with /advisor off.');
}

main();
