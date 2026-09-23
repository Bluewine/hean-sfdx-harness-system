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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
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
  run('setup.mjs', ['--repo', repo, '--commit-format', 'on']);
  const report = join(repo, '.claude', 'skills', 'create-pr', 'output', 'body.md');
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, 'a rendered body\n');
  // no flag this time: the answer saved by the first run is used
  run('setup.mjs', ['--repo', repo]);
  check('a second setup keeps skill output in the repository .claude folder', existsSync(report));

  const manifest = JSON.parse(readFileSync(join(home, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'));
  const shipped = JSON.parse(readFileSync(join(dirname(SCRIPTS), '.claude-plugin', 'plugin.json'), 'utf8')).version;
  check('the manifest records the version that ran setup', manifest.version === shipped,
        `${manifest.version} vs ${shipped}`);
  const jsonKey = manifest.changes.find(c => c.type === 'json-key');
  check('the manifest still holds the user\'s own status line after two runs',
        JSON.stringify(jsonKey?.previousValue) === JSON.stringify(MY_STATUSLINE),
        JSON.stringify(jsonKey?.previousValue));

  const hook = join(repo, '.githooks', 'commit-msg');
  const hooksPath = () => {
    try { return execFileSync('git', ['-C', repo, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return undefined; }
  };
  check('the commit-msg hook is installed and executable',
        existsSync(hook) && (statSync(hook).mode & 0o111) !== 0);
  check('core.hooksPath points at the hook folder', hooksPath() === '.githooks', String(hooksPath()));
  check('the hook folder is ignored',
        readFileSync(join(repo, '.gitignore'), 'utf8').split('\n').includes('.githooks/'));
  const giLines = readFileSync(join(repo, '.gitignore'), 'utf8').split('\n');
  check('the .claude folder\'s contents are ignored, then its manifests brought back',
        giLines.indexOf('.claude/*') >= 0 && giLines.indexOf('!.claude/manifest/') > giLines.indexOf('.claude/*'));
  const ignored = f => { try { execFileSync('git', ['-C', repo, 'check-ignore', '-q', f]); return true; } catch { return false; } };
  check('git ignores the rules but not a story manifest',
        ignored('.claude/rules/x.md') && !ignored('.claude/manifest/ABC-1.xml'));
  check('the MCP server file is ignored',
        readFileSync(join(repo, '.gitignore'), 'utf8').split('\n').includes('.mcp.json'));
  check('no npm install without a package.json', !existsSync(join(repo, 'node_modules')));
  check('the commit format answer is saved and reused',
        JSON.parse(readFileSync(join(repo, '.claude', 'hean-harness.json'), 'utf8')).commitFormat === 'on');

  run('commit-format.mjs', ['off', '--repo', repo]);
  check('switching off removes the hook and unsets core.hooksPath',
        !existsSync(hook) && hooksPath() === undefined, String(hooksPath()));
  run('commit-format.mjs', ['on', '--repo', repo]);
  check('switching on again puts both back',
        existsSync(hook) && hooksPath() === '.githooks', String(hooksPath()));

  // the user moved the alias block between their own lines
  const zshrc = join(home, '.zshrc');
  const blockText = readFileSync(zshrc, 'utf8').slice(MY_ZSHRC.length + 1);
  writeFileSync(zshrc, 'export MY_OWN=1\n\n' + blockText + 'alias ll="ls -la"\n');
  writeFileSync(join(repo, '.mcp.json'), '{ "mcpServers": {} }\n');
  const storyManifest = join(repo, '.claude', 'manifest', 'ABC-1.xml');
  mkdirSync(dirname(storyManifest), { recursive: true });
  writeFileSync(storyManifest, '<Package/>\n');

  const revert = JSON.parse(run('lib/manifest.mjs', ['revert']));
  check('every recorded change reverses', revert.every(c => c.ok),
        `${revert.filter(c => c.ok).length}/${revert.length}`);

  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  check('the user\'s status line comes back',
        JSON.stringify(settings.statusLine) === JSON.stringify(MY_STATUSLINE),
        JSON.stringify(settings.statusLine));
  check('their other settings are untouched', settings.theme === 'dark');
  check('the alias block is removed from the middle of the shell profile, and nothing else',
        readFileSync(join(home, '.zshrc'), 'utf8') === MY_ZSHRC);
  check('the hook folder is removed', !existsSync(join(repo, '.githooks')));
  check('core.hooksPath is unset again', hooksPath() === undefined, String(hooksPath()));
  check('uninstall empties the repository .claude folder', !existsSync(join(repo, '.claude', 'rules')));
  check('uninstall keeps the story manifests', existsSync(storyManifest));
  check('the repository .mcp.json is deleted', !existsSync(join(repo, '.mcp.json')));
  check('no folder setup created is left in the home directory',
        !existsSync(join(home, '.claude', 'projects')) && !existsSync(join(home, '.claude', 'rules')));
  check('nothing of the plugin is left in the home directory',
        !existsSync(join(home, '.claude', 'hean-harness', 'install-manifest.json')));

  // A repository that commits its own hook owns the hooks folder.
  const home2 = join(root, 'home2');
  const own = join(root, 'own-hooks');
  mkdirSync(join(home2, '.claude'), { recursive: true });
  mkdirSync(join(own, '.githooks'), { recursive: true });
  execFileSync('git', ['-C', own, 'init', '-q', '-b', 'main']);
  const TEAM_HOOK = '#!/bin/sh\n# the team\'s own hook\nexit 0\n';
  writeFileSync(join(own, '.githooks', 'commit-msg'), TEAM_HOOK);
  execFileSync('git', ['-C', own, 'add', '.githooks/commit-msg']);
  // an earlier version wrote a bare `.claude/`, which hides the manifests
  writeFileSync(join(own, '.gitignore'),
    'node_modules/\n\n# hean-harness: installed or written on each clone, not shared\n.claude/\n.mcp.json\n');
  const env2 = { ...env, HOME: home2 };
  execFileSync('node', [join(SCRIPTS, 'setup.mjs'), '--repo', own, '--commit-format', 'on', '--replace-githook'],
               { env: env2, encoding: 'utf8', stdio: 'pipe' });
  const ownHooksPath = () => {
    try { return execFileSync('git', ['-C', own, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return undefined; }
  };
  const ownGi = readFileSync(join(own, '.gitignore'), 'utf8').split('\n');
  check('a tracked hooks folder is not added to .gitignore', !ownGi.includes('.githooks/'));
  check('the old .claude/ line is replaced by the pair',
        !ownGi.includes('.claude/') && ownGi.includes('.claude/*') && ownGi.includes('!.claude/manifest/'));
  check('the owner\'s own lines stay', ownGi[0] === 'node_modules/');
  check('the tracked hook is left as it is, even with --replace-githook',
        readFileSync(join(own, '.githooks', 'commit-msg'), 'utf8') === TEAM_HOOK);
  check('core.hooksPath is left to the repository', ownHooksPath() === undefined, String(ownHooksPath()));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env2, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall leaves the tracked hook in place',
        readFileSync(join(own, '.githooks', 'commit-msg'), 'utf8') === TEAM_HOOK);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
