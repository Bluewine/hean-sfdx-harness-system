#!/usr/bin/env node
/**
 * The sparse marketplace step keeps the plugin's marketplace clone to
 * .claude-plugin and plugins, and uninstall leaves the clone sparse.
 *
 * `claude` is a stand-in on PATH that logs its arguments and, for
 * `plugin marketplace add`, rewrites the settings entry the way the real
 * command does: the whole entry is replaced, so `autoUpdate` is dropped. It
 * fails when STANDIN_FAIL is set. The real claude is never run.
 *
 * Runs against throwaway CLAUDE_CONFIG_DIR folders under the temp folder.
 * Touches nothing of yours.
 *
 * Run: node scripts/__tests__/sparse-marketplace.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SETUP = join(dirname(SCRIPTS), 'skills', 'setup', 'scripts');
const STEP = join(SETUP, 'install-sparse-marketplace.mjs');
const MANIFEST_CLI = join(SCRIPTS, 'lib', 'manifest.mjs');

const root = mkdtempSync(join(tmpdir(), 'hean-sparse-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const MARKET = 'test-market';
const URL = 'https://example.com/test-market.git';
const SPARSE = ['.claude-plugin', 'plugins'];

// One stand-in for every home. It finds the settings file through CLAUDE_CONFIG_DIR, as the real one does.
const bin = join(root, 'bin');
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STANDIN_LOG, JSON.stringify(args) + '\\n');
if (process.env.STANDIN_FAIL) { console.error('Failed to add marketplace: network unreachable'); process.exit(1); }
if (args.slice(0, 3).join(' ') !== 'plugin marketplace add') process.exit(0);
const arg = args[3];
const i = args.indexOf('--sparse');
const sparse = i >= 0 ? args.slice(i + 1) : null;
const file = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const name = process.env.STANDIN_NAME;
const old = j.extraKnownMarketplaces[name].source;
// the real add refuses a source that differs from the settings entry, sparsePaths included
if (JSON.stringify(old.sparsePaths) !== JSON.stringify(sparse ?? undefined)) {
  console.error("Cannot add marketplace: its source doesn't match its extraKnownMarketplaces entry in user or managed settings");
  process.exit(1);
}
const source = old.source === 'github' ? { source: 'github', repo: arg } : { source: 'git', url: arg };
if (sparse) source.sparsePaths = sparse;
j.extraKnownMarketplaces[name] = { source };
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\\n');
const knownFile = path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'known_marketplaces.json');
const known = fs.existsSync(knownFile) ? JSON.parse(fs.readFileSync(knownFile, 'utf8')) : {};
known[name] = { source, installLocation: path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'marketplaces', name) };
fs.writeFileSync(knownFile, JSON.stringify(known, null, 2) + '\\n');
console.log('Successfully added marketplace: ' + name);
`);
chmodSync(join(bin, 'claude'), 0o755);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A throwaway Claude folder with the plugin installed from MARKET and the given settings entry. */
function home(name, entry, { extraSettings = { theme: 'dark' } } = {}) {
  const dir = join(root, name);
  const cfg = join(dir, 'cfg');
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { [`hean-harness@${MARKET}`]: [{ scope: 'user' }] } }, null, 2) + '\n');
  const settings = join(cfg, 'settings.json');
  writeFileSync(settings, JSON.stringify({ ...extraSettings, extraKnownMarketplaces: { [MARKET]: entry } }, null, 2) + '\n');
  const log = join(dir, 'claude.log');
  writeFileSync(log, '');
  const env = { ...process.env, HOME: dir, CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}`,
                STANDIN_LOG: log, STANDIN_NAME: MARKET };
  delete env.STANDIN_FAIL;
  return {
    cfg, settings, env,
    manifest: join(cfg, 'hean-harness', 'install-manifest.json'),
    read: () => JSON.parse(readFileSync(settings, 'utf8')),
    text: () => readFileSync(settings, 'utf8'),
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)),
    step: (args = [], extraEnv = {}) => spawnSync('node', [STEP, ...args],
      { env: { ...env, ...extraEnv }, encoding: 'utf8' }),
    revert: (args = []) => JSON.parse(execFileSync('node', [MANIFEST_CLI, 'revert', ...args], { env, encoding: 'utf8' }))
  };
}

const gitEntry = (extra = {}) => ({ source: { source: 'git', url: URL }, ...extra });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- First run, rerun, uninstall ----------------------------------------------
{
  const h = home('first', gitEntry({ autoUpdate: true }));
  const r = h.step();
  check('the first run exits 0', r.status === 0, r.stderr);
  const calls = h.calls();
  check('the first run adds the marketplace again with --sparse .claude-plugin plugins',
        calls.length === 1 && same(calls[0], ['plugin', 'marketplace', 'add', URL, '--sparse', ...SPARSE]),
        JSON.stringify(calls));
  const s = h.read();
  check('the settings entry lists .claude-plugin and plugins as sparsePaths',
        same(s.extraKnownMarketplaces[MARKET].source.sparsePaths, SPARSE), JSON.stringify(s.extraKnownMarketplaces));
  check('autoUpdate survives the add that dropped it', s.extraKnownMarketplaces[MARKET].autoUpdate === true,
        JSON.stringify(s.extraKnownMarketplaces[MARKET]));
  check('the other settings are untouched', s.theme === 'dark');
  const out = r.stdout.trim().split('\n');
  check('the first run prints one line saying what it did',
        out.length === 1 && out[0].includes(MARKET) && out[0].includes('.claude-plugin'), r.stdout);
  const recorded = JSON.parse(readFileSync(h.manifest, 'utf8')).changes.filter(c => c.type === 'sparse-marketplace');
  check('the install record holds one sparse marketplace entry', recorded.length === 1, JSON.stringify(recorded));

  const before = h.text();
  const again = h.step();
  check('a rerun exits 0', again.status === 0, again.stderr);
  check('a rerun runs no claude command', h.calls().length === 1, JSON.stringify(h.calls()));
  check('a rerun changes nothing in settings.json', h.text() === before);
  check('a rerun says the clone is already sparse', /already/.test(again.stdout) && again.stdout.trim().split('\n').length === 1,
        again.stdout);

  // the revert setup runs before a reinstall keeps the sparse clone, so a reinstall never re-clones twice
  const clear = spawnSync('node', [join(SETUP, 'clear-previous-install.mjs')], { env: h.env, encoding: 'utf8' });
  check('the revert before a reinstall exits 0', clear.status === 0, clear.status === 0 ? '' : clear.stdout + clear.stderr);
  check('the revert before a reinstall runs no claude command', h.calls().length === 1, JSON.stringify(h.calls()));
  check('the revert before a reinstall keeps sparsePaths',
        same(h.read().extraKnownMarketplaces[MARKET].source.sparsePaths, SPARSE));

  const sparseText = h.text();
  const dry = h.revert(['--dry-run', 'true']).find(x => x.type === 'sparse-marketplace');
  check('the uninstall dry run says the final remove step deletes the clone and names the command',
        dry && dry.action.includes('clone is deleted by the final') &&
        dry.action.includes(`claude plugin marketplace remove ${MARKET}`), JSON.stringify(dry));
  check('the uninstall dry run runs no claude command', h.calls().length === 1);

  const results = h.revert();
  check('every recorded change reverses', results.every(x => x.ok), JSON.stringify(results));
  check('uninstall runs no claude command', h.calls().length === 1, JSON.stringify(h.calls()));
  check('uninstall leaves sparsePaths in the settings entry',
        same(h.read().extraKnownMarketplaces[MARKET].source.sparsePaths, SPARSE), JSON.stringify(h.read().extraKnownMarketplaces));
  check('uninstall leaves settings.json byte for byte as setup left it', h.text() === sparseText);
  check('uninstall removes the install record', !existsSync(h.manifest));
}

// --- Dry run --------------------------------------------------------------------
{
  const h = home('dry', gitEntry({ autoUpdate: false }));
  const before = h.text();
  const r = h.step(['--dry-run']);
  check('a dry run exits 0', r.status === 0, r.stderr);
  check('a dry run runs no claude command', h.calls().length === 0, JSON.stringify(h.calls()));
  check('a dry run changes nothing in settings.json', h.text() === before);
  check('a dry run writes no install record', !existsSync(h.manifest));
  check('a dry run names the command it would run and says nothing changed',
        r.stdout.includes(`claude plugin marketplace add ${URL} --sparse .claude-plugin plugins`) && r.stdout.includes('Dry run'),
        r.stdout);
}

// --- A failing claude command ----------------------------------------------------
{
  const h = home('fail', gitEntry({ autoUpdate: true }));
  const before = h.text();
  const r = h.step([], { STANDIN_FAIL: '1' });
  check('a failing add exits non-zero', r.status !== 0, String(r.status));
  check('a failing add prints a !! line with the reason',
        r.stdout.split('\n').some(l => l.startsWith('!!') && l.includes('network unreachable')), r.stdout);
  check('a failing add leaves settings.json as it was', h.text() === before);
  const changes = existsSync(h.manifest) ? JSON.parse(readFileSync(h.manifest, 'utf8')).changes : [];
  check('a failing add leaves no sparse marketplace entry in the install record',
        !changes.some(c => c.type === 'sparse-marketplace'), JSON.stringify(changes));
  const backups = join(h.cfg, 'hean-harness', 'backups');
  const left = existsSync(backups) ? readdirSync(backups).filter(f => f.startsWith('settings.json.')) : [];
  check('a failing add leaves no settings.json backup behind', left.length === 0, JSON.stringify(left));
}

// --- An empty sparsePaths list before setup ------------------------------------------
{
  const h = home('empty-list', { source: { source: 'git', url: URL, sparsePaths: [] }, autoUpdate: true });
  const r = h.step();
  check('an empty sparsePaths list is replaced with .claude-plugin and plugins',
        r.status === 0 && same(h.read().extraKnownMarketplaces[MARKET].source.sparsePaths, SPARSE), r.stdout + r.stderr);
  const n = h.calls().length;
  const results = h.revert();
  check('uninstall after an empty list reverses', results.every(x => x.ok), JSON.stringify(results));
  check('uninstall after an empty list runs no claude command and keeps sparsePaths',
        h.calls().length === n && same(h.read().extraKnownMarketplaces[MARKET].source.sparsePaths, SPARSE), JSON.stringify(h.calls()));
}

// --- Source types -----------------------------------------------------------------
{
  const h = home('github', { source: { source: 'github', repo: 'example/test-market' }, autoUpdate: true });
  const r = h.step();
  check('a github source exits 0', r.status === 0, r.stderr);
  check('a github source is added again by its owner/repo',
        same(h.calls()[0], ['plugin', 'marketplace', 'add', 'example/test-market', '--sparse', ...SPARSE]),
        JSON.stringify(h.calls()));
  check('a github source keeps autoUpdate', h.read().extraKnownMarketplaces[MARKET].autoUpdate === true);
}
{
  const h = home('directory', { source: { source: 'directory', path: '/somewhere' } });
  const before = h.text();
  const r = h.step();
  check('a directory source exits 0', r.status === 0, r.stderr);
  check('a directory source runs no claude command and changes nothing',
        h.calls().length === 0 && h.text() === before, JSON.stringify(h.calls()));
  check('a directory source says it was not changed', /not changed/.test(r.stdout), r.stdout);
}
{
  // no entry for the plugin's marketplace in settings.json: add --sparse would not match what Claude Code has
  const h = home('no-entry', gitEntry());
  writeFileSync(h.settings, JSON.stringify({ theme: 'dark' }, null, 2) + '\n');
  const before = h.text();
  const r = h.step();
  check('a marketplace with no settings entry exits 0', r.status === 0, r.stderr);
  check('a marketplace with no settings entry is not touched',
        h.calls().length === 0 && h.text() === before && /not changed/.test(r.stdout), r.stdout);
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
