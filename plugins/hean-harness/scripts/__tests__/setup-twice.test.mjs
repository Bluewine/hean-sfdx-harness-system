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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync } from 'node:fs';
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
const MY_SETTINGS = { statusLine: MY_STATUSLINE, theme: 'dark', env: { MY_OWN_ENV: 'keep-me' } };
const MY_ZSHRC = 'export MY_OWN=1\nalias ll="ls -la"\n';
const readSettings = () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

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
  const afterFirst = readSettings();
  check('the task tools key is set after setup', afterFirst.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1',
        String(afterFirst.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS));
  check('an unrelated env key survives setup', afterFirst.env?.MY_OWN_ENV === 'keep-me',
        String(afterFirst.env?.MY_OWN_ENV));
  const report = join(repo, '.claude', 'skills', 'create-pr', 'output', 'body.md');
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, 'a rendered body\n');
  // no flag this time: the answer saved by the first run is used
  run('setup.mjs', ['--repo', repo]);
  check('a second setup keeps skill output in the repository .claude folder', existsSync(report));
  const afterTwice = readSettings();
  check('running setup twice leaves one correct task tools value',
        afterTwice.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', String(afterTwice.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS));

  const manifest = JSON.parse(readFileSync(join(home, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'));
  const shipped = JSON.parse(readFileSync(join(dirname(SCRIPTS), '.claude-plugin', 'plugin.json'), 'utf8')).version;
  check('the manifest records the version that ran setup', manifest.version === shipped,
        `${manifest.version} vs ${shipped}`);
  check('a completed setup records when it ran', Boolean(manifest.lastSetupAt), String(manifest.lastSetupAt));
  const doctor = () => { try { return run('doctor.mjs'); } catch (e) { return String(e.stdout ?? ''); } };
  check('doctor does not flag setup as out of date after a run', !doctor().includes('SETUP IS OUT OF DATE'));

  // An ego lite app without taskSpace cannot run the ego-browser skill.
  // A stand-in ego-browser on PATH answers the same probe doctor sends.
  if (process.platform === 'darwin') {
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeEgo = typeofTaskSpace => {
      const file = join(fakeBin, 'ego-browser');
      writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ego-browser 0.4.7.4" >&2; else echo "${typeofTaskSpace}" >&2; fi\n`);
      chmodSync(file, 0o755);
    };
    const doctorWithEgo = () => {
      try {
        return execFileSync('node', [join(SCRIPTS, 'doctor.mjs')],
          { env: { ...env, PATH: `${fakeBin}:${process.env.PATH}` }, encoding: 'utf8', stdio: 'pipe' });
      } catch (e) { return String(e.stdout ?? ''); }
    };
    fakeEgo('undefined');
    const oldEgo = doctorWithEgo();
    check('doctor flags an ego lite app that has no taskSpace',
          oldEgo.includes('0.4.7.4 is older than the ego-browser skill') && oldEgo.includes('fix: ego-browser upgrade'), oldEgo);
    fakeEgo('function');
    check('doctor does not flag an ego lite app that has taskSpace',
          !doctorWithEgo().includes('older than the ego-browser skill'));
    fakeEgo('');
    check('doctor does not flag an ego lite app whose probe prints nothing',
          !doctorWithEgo().includes('older than the ego-browser skill'));
  }

  const jsonKey = manifest.changes.find(c => c.type === 'json-key' && c.key === 'statusLine');
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
  const manifestPath = join(home, '.claude', 'hean-harness', 'install-manifest.json');
  const afterSwitch = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check('the commit format switch is not recorded as a setup run',
        afterSwitch.lastSetupAt === manifest.lastSetupAt && afterSwitch.version === manifest.version);
  writeFileSync(manifestPath, JSON.stringify({ ...afterSwitch, version: '0.0.1' }, null, 2) + '\n');
  check('doctor flags setup run by an older version', doctor().includes('SETUP IS OUT OF DATE'));
  writeFileSync(manifestPath, JSON.stringify(afterSwitch, null, 2) + '\n');

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

  const settings = readSettings();
  check('the user\'s status line comes back',
        JSON.stringify(settings.statusLine) === JSON.stringify(MY_STATUSLINE),
        JSON.stringify(settings.statusLine));
  check('their other settings are untouched', settings.theme === 'dark');
  check('the task tools key is removed on uninstall', settings.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === undefined,
        String(settings.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS));
  check('the unrelated env key survives uninstall', settings.env?.MY_OWN_ENV === 'keep-me',
        String(settings.env?.MY_OWN_ENV));
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

  // A settings.json this plugin created from nothing must not survive uninstall
  // as an empty shell of the parent objects (env: {}) it created along the way.
  const home3 = join(root, 'home3');
  mkdirSync(join(home3, '.claude'), { recursive: true });
  const env3 = { ...process.env, HOME: home3 };
  const settings3 = join(home3, '.claude', 'settings.json');
  execFileSync('node', [join(SCRIPTS, 'install-statusline.mjs')], { env: env3, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'install-task-tools.mjs')], { env: env3, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env3, encoding: 'utf8', stdio: 'pipe' });
  check('a settings.json this plugin created from nothing is gone after uninstall', !existsSync(settings3));

  // A settings.json that already existed but had no env block keeps that shape:
  // no leftover empty env object once the task tools key is removed.
  const home4 = join(root, 'home4');
  mkdirSync(join(home4, '.claude'), { recursive: true });
  const settings4 = join(home4, '.claude', 'settings.json');
  writeFileSync(settings4, JSON.stringify({ theme: 'light' }, null, 2) + '\n');
  const env4 = { ...process.env, HOME: home4 };
  execFileSync('node', [join(SCRIPTS, 'install-statusline.mjs')], { env: env4, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'install-task-tools.mjs')], { env: env4, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env4, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstall4 = JSON.parse(readFileSync(settings4, 'utf8'));
  check('a settings.json with no env block has no env block after uninstall',
        afterUninstall4.theme === 'light' && !('env' in afterUninstall4), JSON.stringify(afterUninstall4));

  // A user who already set the task tools key to their own value gets that
  // value back on uninstall, not a deleted key.
  const home5 = join(root, 'home5');
  mkdirSync(join(home5, '.claude'), { recursive: true });
  const settings5 = join(home5, '.claude', 'settings.json');
  writeFileSync(settings5, JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' } }, null, 2) + '\n');
  const env5 = { ...process.env, HOME: home5 };
  execFileSync('node', [join(SCRIPTS, 'install-task-tools.mjs')], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterSetup5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('setup replaces the user\'s own task tools value with 1',
        afterSetup5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', JSON.stringify(afterSetup5));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstall5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('uninstall puts back the user\'s own task tools value',
        afterUninstall5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '0', JSON.stringify(afterUninstall5));

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
