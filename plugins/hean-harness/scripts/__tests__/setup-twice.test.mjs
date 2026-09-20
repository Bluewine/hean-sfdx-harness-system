#!/usr/bin/env node
/**
 * Setup run twice must still restore what the user had before the first run.
 *
 * On a second run the machine no longer holds the user's own settings — it
 * holds ours. Reading the file at that moment and recording what it says as
 * "what was there before" replaces the user's status line with the plugin's
 * on uninstall. This test fails if that regresses.
 *
 * Runs against a throwaway home directory. Touches nothing of yours.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

const root = mkdtempSync(join(tmpdir(), 'hean-twice-'));
const home = join(root, 'home');
const repo = join(root, 'repo');
mkdirSync(join(home, '.claude'), { recursive: true });
mkdirSync(repo, { recursive: true });

const MY_STATUSLINE = { type: 'command', command: 'bash ~/my-own-statusline.sh' };
const MY_SETTINGS = { statusLine: MY_STATUSLINE, theme: 'dark' };
const MY_ZSHRC = 'export MY_OWN=1\nalias ll="ls -la"\n';

writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(MY_SETTINGS, null, 2) + '\n');
writeFileSync(join(home, '.zshrc'), MY_ZSHRC);
execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);

const env = { ...process.env, HOME: home, SHELL: '/bin/zsh' };
const run = (script, args = []) =>
  execFileSync('node', [join(SCRIPTS, script), ...args], { env, encoding: 'utf8', stdio: 'pipe' });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  run('setup.mjs', ['--repo', repo]);
  run('setup.mjs', ['--repo', repo]);

  const manifest = JSON.parse(readFileSync(join(home, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'));
  const jsonKey = manifest.changes.find(c => c.type === 'json-key');
  check('the manifest still holds the user\'s own status line after two runs',
        JSON.stringify(jsonKey?.previousValue) === JSON.stringify(MY_STATUSLINE),
        JSON.stringify(jsonKey?.previousValue));

  const revert = JSON.parse(run('lib/manifest.mjs', ['revert']));
  check('every recorded change reverses', revert.every(c => c.ok),
        `${revert.filter(c => c.ok).length}/${revert.length}`);

  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  check('the user\'s status line comes back',
        JSON.stringify(settings.statusLine) === JSON.stringify(MY_STATUSLINE),
        JSON.stringify(settings.statusLine));
  check('their other settings are untouched', settings.theme === 'dark');
  check('the shell profile comes back byte for byte',
        readFileSync(join(home, '.zshrc'), 'utf8') === MY_ZSHRC);
  check('nothing of the plugin is left in the home directory',
        !existsSync(join(home, '.claude', 'hean-harness', 'install-manifest.json')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
