#!/usr/bin/env node
/**
 * Prepares the project's local settings file and reports what is not yet set.
 *
 * It asks nothing. The questions belong to the configure skill, where a person
 * can answer them. This only makes sure the file is ignored by git and tells
 * the reader what is still open.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { repoRoot, settingsPath, load, ensureIgnored, KEYS } from './lib/settings.mjs';
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

  const s = load(repo);
  const unset = Object.keys(KEYS).filter(k => s[k] === undefined || s[k] === null);

  log(`Settings file   ${settingsPath(repo)}${existsSync(settingsPath(repo)) ? '' : '  (not created yet)'}`);
  log(`Recorded        ${Object.keys(KEYS).length - unset.length} of ${Object.keys(KEYS).length}`);
  for (const [k, why] of Object.entries(KEYS)) {
    log(`                ${unset.includes(k) ? 'not set ' : 'set     '} ${k.padEnd(16)} ${why}`);
  }
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');
  const r = ensureIgnored(repo);
  if (r.added.length) {
    log(`Added ${r.added.length} line${r.added.length > 1 ? 's' : ''} to ${r.file} so the settings are never committed`);
    // ours to undo, and only the lines we actually wrote
    recordExternal(`gitignore:${r.file}`,
      `remove these lines from ${r.file}: ${r.added.join(', ')} (and the comment above them)`);
  } else {
    log(`Already ignored in ${r.file} — left as it is`);
  }

  if (unset.length) {
    log('');
    log(`${unset.length} setting${unset.length > 1 ? 's are' : ' is'} not recorded, so nothing is enforced for`);
    log(`${unset.map(k => k).join(', ')}.`);
    log('Run the configure skill to record them, or leave them and nothing will ask again.');
  }
}

main();
