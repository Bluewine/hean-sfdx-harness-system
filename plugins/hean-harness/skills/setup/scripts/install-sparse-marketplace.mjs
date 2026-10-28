#!/usr/bin/env node
/**
 * Keeps the clone of the marketplace this plugin was installed from to
 * .claude-plugin and plugins, so the repository's docs/ folder is never
 * downloaded to the machine.
 *
 * Deleting docs/ by hand does not last: `claude plugin marketplace update` and
 * background auto-update replace the whole clone with a fresh one whenever the
 * remote has moved. A `sparsePaths` list on the marketplace source does last,
 * because every re-clone checks out only the listed folders again. Cone mode
 * still keeps the root files (README.md, LICENSE, .gitignore), and the docs/
 * file names stay in the git tree objects, with no file content.
 *
 * Two edits, in this order, because each one alone breaks the marketplace:
 * `sparsePaths` goes into the settings.json entry first, then
 * `claude plugin marketplace add <same source> --sparse .claude-plugin plugins`
 * re-clones to match. An add whose source differs from the entry is refused,
 * and an entry changed without the add leaves the marketplace "added but
 * ignored". The add replaces the whole entry and drops `autoUpdate`, so the
 * entry's other keys are written back afterwards.
 *
 * The change is recorded as one `sparse-marketplace` entry. Uninstall only reports
 * it and leaves the clone sparse, so docs/ never comes back to the machine; a setup
 * rerun leaves it alone too.
 * A failed add puts settings.json back as it was and leaves no entry.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { init, load, record, forget, marketplaceAddArg, restoreEntryKeys } from '../../../scripts/lib/manifest.mjs';
import { claudeDir } from '../../../scripts/lib/paths.mjs';

const INSTALLED = join(claudeDir(), 'plugins', 'installed_plugins.json');
const KNOWN = join(claudeDir(), 'plugins', 'known_marketplaces.json');
const SETTINGS = join(claudeDir(), 'settings.json');
const PLUGIN_PREFIX = 'hean-harness@';
const SPARSE = ['.claude-plugin', 'plugins'];
// source keys `claude plugin marketplace add` can repeat; a ref or path has no flag there
const REPEATABLE = ['source', 'url', 'repo', 'sparsePaths'];

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function readJson(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** The marketplace this plugin was installed from, or null when it cannot be told. */
function findMarketplace() {
  const data = readJson(INSTALLED);
  if (!data) return null;
  const registry = data.plugins ?? data;
  const key = Object.keys(registry).find(k => k.startsWith(PLUGIN_PREFIX));
  return key ? key.slice(PLUGIN_PREFIX.length) : null;
}

const isSparse = paths => Array.isArray(paths) && paths.length === SPARSE.length &&
  SPARSE.every(p => paths.includes(p));

function main() {
  const marketplace = findMarketplace();
  if (!marketplace) {
    log(`Sparse clone was not changed: the plugin's install record was not found (${INSTALLED}).`);
    return;
  }

  const settings = readJson(SETTINGS) ?? {};
  const entry = settings.extraKnownMarketplaces?.[marketplace];
  if (!entry?.source) {
    log(`Sparse clone was not changed: ${marketplace} has no entry in settings.json, so an add with ` +
        `--sparse would not match the marketplace Claude Code has.`);
    return;
  }
  const { source } = entry;
  if (!['git', 'github'].includes(source.source)) {
    log(`Sparse clone was not changed: ${marketplace} is a ${source.source} source, which has no git clone to limit.`);
    return;
  }
  const extra = Object.keys(source).filter(k => !REPEATABLE.includes(k));
  const arg = marketplaceAddArg(source);
  if (extra.length || !arg) {
    log(`Sparse clone was not changed: the ${marketplace} source ${extra.length ? `has ${extra.join(', ')}, which` : 'names no URL or repository, which'} ` +
        `claude plugin marketplace add cannot repeat.`);
    return;
  }

  // Both records must list the paths: Claude Code's own record without them means
  // an earlier add never ran, and the marketplace is ignored until it does.
  const known = readJson(KNOWN)?.[marketplace];
  if (isSparse(source.sparsePaths) && (!known || isSparse(known.source?.sparsePaths))) {
    log(`Sparse clone   ${marketplace} already checks out only ${SPARSE.join(' and ')}. Nothing changed.`);
    if (dryRun) { log(''); log('Dry run. Nothing was changed.'); }
    return;
  }

  const cmd = ['claude', 'plugin', 'marketplace', 'add', arg, '--sparse', ...SPARSE];
  if (dryRun) {
    log(`Sparse clone   would add sparsePaths to ${marketplace} in ${SETTINGS}, then run: ${cmd.join(' ')}`);
    log('');
    log('Dry run. Nothing was changed.');
    return;
  }

  init();
  const before = readFileSync(SETTINGS, 'utf8');
  const hadRecord = load().changes.some(c => c.type === 'sparse-marketplace' && c.target === SETTINGS);
  // Recorded before the write, as every installer does. Uninstall only reports it:
  // nothing is stored to restore, because the clone stays sparse.
  record({ type: 'sparse-marketplace', target: SETTINGS, name: marketplace });

  const { source: _, ...rest } = entry;
  source.sparsePaths = SPARSE;
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');

  const p = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
  if (p.status !== 0) {
    writeFileSync(SETTINGS, before);
    if (!hadRecord) forget('sparse-marketplace', SETTINGS);
    const output = `${p.stdout ?? ''}${p.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
    log(`!! Sparse clone was not set up: ${cmd.join(' ')} failed (${output || p.error?.message || `exit ${p.status}`}). ` +
        `settings.json is as it was.`);
    process.exit(1);
  }
  restoreEntryKeys(SETTINGS, marketplace, rest);
  log(`Limited the ${marketplace} clone to ${SPARSE.join(' and ')}, so docs/ is not downloaded; ` +
      `the entry's other keys, autoUpdate among them, were kept.`);
}

main();
