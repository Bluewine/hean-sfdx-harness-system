#!/usr/bin/env node
/**
 * Removes what a previous install of this plugin put in place, before a new one
 * writes anything.
 *
 * Without this, a file the plugin used to ship and no longer does stays on the
 * machine forever. Setup only ever writes the files in the current version, so
 * a rule dropped between versions keeps loading in every session, and nothing
 * reports it — the reader sees a convention the plugin no longer has.
 *
 * What gets removed is exactly what the manifest recorded, and nothing else.
 * That distinction matters more than it looks:
 *
 *   ~/.claude/rules/                holds rules the person wrote themselves
 *   ~/.claude/CLAUDE.md             is their file; the plugin only adds a marked block
 *   the per-project memory folder   holds memories they and their sessions wrote
 *
 * Clearing those folders wholesale would destroy all of it. So this reverses the
 * recorded changes instead: files the plugin created are deleted, files it
 * replaced are restored from backup, a marked block is stripped while the rest of
 * the file stays, and a directory goes only when it is already empty.
 *
 * Runs first, before any installer records anything, so the revert sees only the
 * previous install and never part of this one.
 */

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { load, revert, MANIFEST } from './lib/manifest.mjs';
import { claudeDir } from './lib/paths.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
// kept for the install ahead, which replaces blocks and index lines in place and the hook only when asked
const keep = ['uninstall-only', 'blocks', 'choices', ...(argv.includes('--replace-githook') ? [] : ['githooks'])];
const log = (...a) => console.log(...a);

/** What each kind of recorded change is, in words, for the count lines. */
const KINDS = {
  'file-copy':    'file this plugin copied',
  'marker-block': 'marked block added to a file you also own',
  'index-lines':  'memory index whose lines for this plugin\'s memories it keeps',
  'json-key':     'setting this plugin changed',
  'dir-create':   'folder this plugin created',
  'repo-folder':  'repository .claude folder, kept until uninstall',
  'repo-file':    'repository .mcp.json, kept until uninstall',
  'external':     'command run outside these files'
};
const describe = type => KINDS[type] ?? type;

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const names = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')) : [];

/**
 * Files in a place this plugin installs to, whose names match files it ships.
 *
 * Used only when no manifest exists, which is the one case the revert cannot
 * cover. It reports and never deletes, because a name proves nothing about who
 * wrote the file: a person can keep a rule of their own under a name this plugin
 * once used, and deleting on a name match would take it.
 */
function unrecordedMatches() {
  const shipped = names(join(PLUGIN_ROOT, 'assets', 'rules', 'user'));
  const installed = names(join(claudeDir(), 'rules'));
  return installed.filter(f => shipped.includes(f));
}

function main() {
  if (!existsSync(MANIFEST)) {
    log('No previous install recorded, so there is nothing to clear.');
    const orphans = unrecordedMatches();
    if (orphans.length) {
      log('');
      log(`${orphans.length} file${orphans.length > 1 ? 's' : ''} in ${join(claudeDir(), 'rules')} share a name with a file this`);
      log('plugin ships, with no record of this plugin having put them there:');
      for (const f of orphans) log(`  ${f}`);
      log('');
      log('The install ahead overwrites each of them and backs up what was there first.');
      log('Nothing is deleted on a name alone — a name does not say who wrote the file.');
    }
    return;
  }

  const m = load();
  const changes = m.changes ?? [];
  if (!changes.length) {
    log('A previous install is recorded but wrote nothing, so there is nothing to clear.');
    return;
  }

  const counts = {};
  for (const c of changes) counts[c.type] = (counts[c.type] ?? 0) + 1;

  log(`Previous install   version ${m.version ?? 'unknown'}, ${changes.length} recorded change${changes.length > 1 ? 's' : ''}`);
  for (const [type, n] of Object.entries(counts)) {
    log(`                   ${String(n).padStart(4)}  ${describe(type)}`);
  }
  log('');
  log('Only these are removed. Files you wrote yourself are left alone, and a file');
  log('this plugin replaced is restored from its backup.');
  log('');
  log('Kept for the install ahead: marked blocks and memory index lines, which it');
  log('replaces where they sit; the auto-update setting, which is your answer and');
  log('is not asked again;');
  log(keep.includes('githooks')
    ? 'the git hook, which it replaces only with --replace-githook; and'
    : 'and');
  log('the repository .claude folder, .mcp.json and plugins, which only uninstall removes.');
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  const results = revert({ dryRun: false, keep });
  const failed = results.filter(r => !r.ok);
  const kept = results.filter(r => r.kept);
  const manual = results.filter(r => r.ok && r.action === 'manual');

  log(`Cleared ${results.length - failed.length - kept.length} of ${results.length}, kept ${kept.length}`);

  if (manual.length) {
    log('');
    log(`${manual.length} thing${manual.length > 1 ? 's were' : ' was'} run outside these files and ${manual.length > 1 ? 'are' : 'is'} left as ${manual.length > 1 ? 'they are' : 'it is'}:`);
    for (const r of manual) log(`  ${r.target}`);
    log('The install ahead checks each of these again and skips whatever is already there.');
  }

  if (failed.length) {
    log('');
    log(`${failed.length} could not be cleared:`);
    for (const r of failed) log(`  ${r.target}\n    ${r.note}`);
    // A file left holding the plugin's copy will be recorded on the way back in as
    // though it were the reader's own, so a later uninstall would restore the
    // plugin's content rather than theirs. Say so rather than leaving it silent.
    log('');
    log('Each of those still holds this plugin\'s copy rather than yours. Move or delete');
    log('it by hand before the install runs, or a later uninstall will treat this');
    log('plugin\'s content as the file to restore.');
    process.exit(1);
  }
}

main();
