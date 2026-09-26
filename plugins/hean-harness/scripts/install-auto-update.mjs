#!/usr/bin/env node
/**
 * Turns on Claude Code's auto-update for a marketplace, so a plugin's later
 * releases download on their own instead of sitting in the marketplace until
 * someone runs `/plugin update` by hand.
 *
 * Claude Code checks `autoUpdate`, first match wins: (1) the marketplace's
 * `extraKnownMarketplaces` entry in settings.json, (2) the marketplace's own
 * entry in `~/.claude/plugins/known_marketplaces.json` (Claude Code's own
 * state — never edited here), (3) off. `marketplace.json` has no such field.
 *
 * `--auto-update hean` turns it on for the marketplace this plugin was
 * installed from, `--auto-update all` turns it on for every marketplace
 * `extraKnownMarketplaces` already lists — even when the plugin's own
 * marketplace has no entry there, in which case that one is named separately
 * as not changed — and `--auto-update off` turns it off for this plugin's
 * marketplace, which also records the choice, so setup does not ask again.
 * With no flag, a real run changes nothing; a dry run asks by printing a
 * `!! ASK` line, unless the choice was already recorded.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installJsonKey } from './lib/install.mjs';
import { claudeDir } from './lib/paths.mjs';

const INSTALLED = join(claudeDir(), 'plugins', 'installed_plugins.json');
const KNOWN = join(claudeDir(), 'plugins', 'known_marketplaces.json');
const SETTINGS = join(claudeDir(), 'settings.json');
const PLUGIN_PREFIX = 'hean-harness@';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const choiceArg = argv.indexOf('--auto-update');
const choice = choiceArg >= 0 ? argv[choiceArg + 1] : null;
const log = (...a) => console.log(...a);

function readJson(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * The marketplace this plugin was installed from, or null when it cannot be
 * told. `installed_plugins.json` keys its plugins as "<plugin>@<marketplace>"
 * under a top-level "plugins" object.
 */
function findMarketplace() {
  const data = readJson(INSTALLED);
  if (!data) return null;
  const registry = data.plugins ?? data;
  const key = Object.keys(registry).find(k => k.startsWith(PLUGIN_PREFIX));
  return key ? key.slice(PLUGIN_PREFIX.length) : null;
}

/**
 * Build the dotted key installJsonKey needs for one marketplace's autoUpdate
 * flag, or null when the name cannot be represented that way.
 *
 * setJsonKey/getJsonKey (lib/manifest.mjs) split a key on every ".", with no
 * escaping, so a marketplace name that itself contains a dot cannot be
 * addressed safely: the split would reach into the wrong nested object
 * instead of this one entry. That name is refused rather than risking a wrong
 * write — installJsonKey has no other way to take this key.
 */
function autoUpdateKey(name) {
  return name.includes('.') ? null : `extraKnownMarketplaces.${name}.autoUpdate`;
}

function setAutoUpdate(name, value) {
  const key = autoUpdateKey(name);
  if (!key) {
    return { ok: false,
      note: `"${name}" contains a "." and installJsonKey addresses settings.json by a dotted ` +
            `path with no escaping, so this name cannot be set safely. Turn it on in /plugin → ` +
            `Marketplaces → ${name} → Enable auto-update.` };
  }
  const r = installJsonKey(SETTINGS, key, value);
  return { ok: true, hadKey: r.hadKey };
}

function main() {
  if (choice !== null && !['all', 'hean', 'off'].includes(choice)) {
    console.error(`--auto-update takes all, hean or off, not "${choice}".`);
    process.exit(1);
  }

  const marketplace = findMarketplace();
  if (!marketplace) {
    log(`Auto-update was not changed: the plugin's install record was not found (${INSTALLED}).`);
    return;
  }

  const settings = readJson(SETTINGS) ?? {};
  const extra = settings.extraKnownMarketplaces ?? {};
  const heanEntry = extra[marketplace];

  // "all" still runs when the plugin's own marketplace has no entry — it acts
  // on every entry that does exist and names this one separately below. Every
  // other choice, including no choice at all, needs this one entry to exist.
  if (heanEntry === undefined && choice !== 'all') {
    log(`Auto-update was not turned on: ${marketplace} has no entry in settings.json. ` +
        `Turn it on in /plugin → Marketplaces → ${marketplace} → Enable auto-update.`);
    return;
  }

  if (choice === null) {
    if (!dryRun) {
      log('Auto-update was not chosen. Run setup with --auto-update all, --auto-update hean, or --auto-update off.');
      return;
    }
    if (heanEntry.autoUpdate === undefined) {
      const names = Object.keys(extra);
      log('!! ASK — AUTO-UPDATE NOT CHOSEN');
      log('!! Should Claude Code download new plugin versions automatically? Run setup with');
      log(`!! --auto-update hean (${marketplace} only), --auto-update all (${names.join(', ')}), or`);
      log('!! --auto-update off (neither — updates stay manual, and setup stops asking).');
      log('');
      log('Dry run. Nothing was changed.');
      return;
    }
    log(`Auto-update    ${marketplace} is already ${heanEntry.autoUpdate} in settings.json. Not asking again.`);
    log('');
    log('Dry run. Nothing was changed.');
    return;
  }

  if (choice === 'hean' || choice === 'off') {
    const value = choice === 'hean';
    const key = autoUpdateKey(marketplace);
    if (!key) {
      // setAutoUpdate returns its refusal note without writing anything when
      // the key is unusable, so the wording lives in one place only.
      log(`Auto-update was not changed: ${setAutoUpdate(marketplace, value).note}`);
      return;
    }
    log(`Setting        ${key} to ${value} in ${SETTINGS}`);
    log('');
    if (dryRun) { log('Dry run. Nothing was changed.'); return; }

    init();
    const r = setAutoUpdate(marketplace, value);
    log(r.hadKey
      ? 'Replaced the auto-update setting. Your previous one is recorded and comes back on uninstall.'
      : `Turned ${value ? 'on' : 'off'} auto-update for ${marketplace}.`);
    log('');
    log('This shows up in your next session.');
    return;
  }

  // choice === 'all': every marketplace extraKnownMarketplaces already lists.
  const names = Object.keys(extra);
  log(`Setting        autoUpdate to true for every marketplace in ${SETTINGS}`);
  log('');
  if (!dryRun && names.length) init();
  for (const name of names) {
    if (dryRun) {
      log(`  ${name}  ${extra[name]?.autoUpdate === true ? 'already true' : 'to true'}`);
      continue;
    }
    const r = setAutoUpdate(name, true);
    log(r.ok ? `  ${name}  ${r.hadKey ? 'replaced (previous value recorded)' : 'turned on'}` : `  ${name}  not changed — ${r.note}`);
  }
  if (heanEntry === undefined) {
    log(`  ${marketplace}  not changed — no entry in settings.json; turn it on in /plugin → Marketplaces → ${marketplace} → Enable auto-update.`);
  }
  const knownNames = Object.keys(readJson(KNOWN) ?? {});
  for (const name of knownNames.filter(n => !names.includes(n) && n !== marketplace)) {
    log(`  ${name}  not changed — no entry in settings.json; turn it on in /plugin → Marketplaces → ${name} → Enable auto-update.`);
  }
  log('');
  log(dryRun ? 'Dry run. Nothing was changed.' : 'This shows up in your next session.');
}

main();
