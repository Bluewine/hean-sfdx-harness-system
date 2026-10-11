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
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync,
         readdirSync, appendFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { run as runLimited } from '../lib/environment.mjs';

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

// A stand-in ego-browser first on PATH keeps every script run here off the machine's real one.
// Its folder differs from the doctor checks' fake-bin, which rewrite their own stand-in.
const egoBin = join(root, 'ego-bin');
mkdirSync(egoBin, { recursive: true });
writeFileSync(join(egoBin, 'ego-browser'),
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ego-browser 0.4.7.4" >&2; else echo "function" >&2; fi\n');
chmodSync(join(egoBin, 'ego-browser'), 0o755);
const BASE_ENV = { ...process.env, PATH: `${egoBin}:${process.env.PATH}` };

const env = { ...BASE_ENV, HOME: home, SHELL: '/bin/zsh' };
const run = (script, args = []) =>
  execFileSync('node', [join(SCRIPTS, script), ...args], { env, encoding: 'utf8', stdio: 'pipe' });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  // spawnSync sends SIGTERM at the timeout and then waits for the child without limit.
  const hang = join(root, 'ignores-sigterm');
  const hangPid = join(root, 'ignores-sigterm.pid');
  writeFileSync(hang, `#!/bin/sh\n[ "$1" = warm ] && exit 0\ntrap "" TERM\necho $$ > '${hangPid}'\nexec sleep 30\n`);
  chmodSync(hang, 0o755);
  // A first run of a new script can take longer than the timeout, so the SIGTERM would land before the trap is set.
  runLimited(hang, ['warm']);
  const hangStart = Date.now();
  runLimited(hang, [], {}, { timeout: 500 });
  const hangMs = Date.now() - hangStart;
  check('run() returns at its timeout when the child ignores SIGTERM', hangMs < 5000, `${hangMs} ms`);
  let stubGone = false;
  try { process.kill(Number(readFileSync(hangPid, 'utf8')), 0); } catch (e) { stubGone = e.code === 'ESRCH'; }
  check('the timed-out child is gone', stubGone);

  run('setup.mjs', ['--repo', repo, '--commit-format', 'on']);
  const afterFirst = readSettings();
  check('the task tools key is set after setup', afterFirst.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1',
        String(afterFirst.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS));
  check('an unrelated env key survives setup', afterFirst.env?.MY_OWN_ENV === 'keep-me',
        String(afterFirst.env?.MY_OWN_ENV));
  check('the advisor keys are set after setup',
        afterFirst.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL === '1' && afterFirst.advisorModel === 'opus',
        JSON.stringify([afterFirst.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL, afterFirst.advisorModel]));
  const report = join(repo, '.claude', 'skills', 'create-pr', 'output', 'body.md');
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, 'a rendered body\n');
  const apexInput = join(repo, '.claude', 'inputs', 'apex-classes.txt');
  const ownInput = join(repo, '.claude', 'inputs', 'my-own-input.txt');
  mkdirSync(dirname(apexInput), { recursive: true });
  writeFileSync(apexInput, '[test]\nFooTest\n');
  writeFileSync(ownInput, 'mine\n');
  // no flag this time: the answer saved by the first run is used
  run('setup.mjs', ['--repo', repo]);
  check('a second setup keeps skill output in the repository .claude folder', existsSync(report));
  check('a second setup keeps the Apex class list in .claude/inputs', existsSync(apexInput));
  const afterTwice = readSettings();
  check('running setup twice leaves one correct task tools value',
        afterTwice.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', String(afterTwice.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS));
  check('running setup twice leaves one correct value for each advisor key',
        afterTwice.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL === '1' && afterTwice.advisorModel === 'opus',
        JSON.stringify([afterTwice.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL, afterTwice.advisorModel]));

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

    // The probe's answer can arrive wrapped in a terminal colour code; that must
    // not hide a real "undefined" behind characters the exact-match misses.
    const colouredFile = join(fakeBin, 'ego-browser');
    writeFileSync(colouredFile,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ego-browser 0.4.7.4" >&2; else printf '\\033[32mundefined\\033[0m\\n' >&2; fi\n`);
    chmodSync(colouredFile, 0o755);
    const colouredEgo = doctorWithEgo();
    check('doctor flags an ego lite app whose undefined answer is wrapped in a colour code',
          colouredEgo.includes('0.4.7.4 is older than the ego-browser skill') && colouredEgo.includes('fix: ego-browser upgrade'),
          colouredEgo);
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

  // the user's own files in the repository .claude folder, which uninstall must keep
  const repoClaude = join(repo, '.claude');
  const agentMemory = join(repoClaude, 'agent-memory');
  const memoryFolder = readdirSync(agentMemory).find(d => statSync(join(agentMemory, d)).isDirectory());
  const userFiles = {
    [join(repoClaude, 'rules', 'my-own-rule.md')]: '# my own rule\n',
    [join(agentMemory, memoryFolder, 'my-own-memory.md')]: '# my own memory\n',
    [join(repoClaude, 'settings.local.json')]: '{ "mine": true }\n',
    [join(repoClaude, 'worktrees', 'wt1', 'notes.txt')]: 'my worktree notes\n'
  };
  for (const [file, text] of Object.entries(userFiles)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  // one installed project rule and one installed user rule, edited after setup
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8')).changes.filter(c => c.type === 'file-copy');
  const editedProjectRule = installed.find(c => dirname(c.target) === join(repoClaude, 'rules')).target;
  const editedUserRule = installed.find(c => dirname(c.target) === join(home, '.claude', 'rules')).target;
  const PROJECT_EDIT = 'a line the user added to a project rule';
  const USER_EDIT = 'a line the user added to a user rule';
  appendFileSync(editedProjectRule, `\n${PROJECT_EDIT}\n`);
  appendFileSync(editedUserRule, `\n${USER_EDIT}\n`);

  const dryRun = JSON.parse(run('lib/manifest.mjs', ['revert', '--dry-run', 'true']));
  const dryEntry = dryRun.find(c => c.type === 'file-copy' && c.target === editedProjectRule);
  check('a dry run names an installed rule edited after setup, and leaves it in place',
        String(dryEntry?.note).includes('edited after setup') &&
          readFileSync(editedProjectRule, 'utf8').includes(PROJECT_EDIT),
        String(dryEntry?.note));

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
  check('the advisor keys are removed on uninstall',
        settings.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL === undefined && !('advisorModel' in settings),
        JSON.stringify([settings.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL, settings.advisorModel]));
  check('the unrelated env key survives uninstall', settings.env?.MY_OWN_ENV === 'keep-me',
        String(settings.env?.MY_OWN_ENV));
  check('the alias block is removed from the middle of the shell profile, and nothing else',
        readFileSync(join(home, '.zshrc'), 'utf8') === MY_ZSHRC);
  check('the hook folder is removed', !existsSync(join(repo, '.githooks')));
  check('core.hooksPath is unset again', hooksPath() === undefined, String(hooksPath()));
  check('uninstall keeps the user\'s own files in the repository .claude folder',
        Object.entries(userFiles).every(([f, text]) => existsSync(f) && readFileSync(f, 'utf8') === text));
  const backupsDir = join(home, '.claude', 'hean-harness', 'backups');
  const backedUp = line => existsSync(backupsDir) &&
    readdirSync(backupsDir).some(f => readFileSync(join(backupsDir, f), 'utf8').includes(line));
  check('an edited project rule is removed after a copy is saved to the backups folder',
        !existsSync(editedProjectRule) && backedUp(PROJECT_EDIT));
  check('an edited user rule is removed after a copy is saved to the backups folder',
        !existsSync(editedUserRule) && backedUp(USER_EDIT));
  check('uninstall deletes the saved answers file', !existsSync(join(repoClaude, 'hean-harness.json')));
  check('uninstall deletes the skill output', !existsSync(report));
  check('uninstall deletes the Apex class list', !existsSync(apexInput));
  check('uninstall keeps a user file in .claude/inputs', existsSync(ownInput));
  const rulesLeft = existsSync(join(repoClaude, 'rules')) ? readdirSync(join(repoClaude, 'rules')) : [];
  check('no plugin rule is left in the repository .claude/rules folder',
        JSON.stringify(rulesLeft) === JSON.stringify(['my-own-rule.md']), JSON.stringify(rulesLeft));
  check('uninstall keeps the story manifests', existsSync(storyManifest));
  check('the repository .mcp.json is deleted', !existsSync(join(repo, '.mcp.json')));
  check('no folder setup created is left in the home directory',
        !existsSync(join(home, '.claude', 'projects')) && !existsSync(join(home, '.claude', 'rules')));
  check('nothing of the plugin is left in the home directory',
        !existsSync(join(home, '.claude', 'hean-harness', 'install-manifest.json')));

  // A .claude/inputs that is a symlink is never followed: the file in its target stays.
  const homeLink = join(root, 'homeLink');
  const repoLink = join(root, 'repoLink');
  const linkTarget = join(root, 'linkTarget');
  mkdirSync(join(homeLink, '.claude'), { recursive: true });
  mkdirSync(repoLink, { recursive: true });
  mkdirSync(linkTarget, { recursive: true });
  execFileSync('git', ['-C', repoLink, 'init', '-q', '-b', 'main']);
  const envLink = { ...BASE_ENV, HOME: homeLink, SHELL: '/bin/zsh' };
  execFileSync('node', [join(SCRIPTS, 'setup.mjs'), '--repo', repoLink, '--commit-format', 'on'],
    { env: envLink, encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(join(linkTarget, 'apex-classes.txt'), '[test]\nFooTest\n');
  symlinkSync(linkTarget, join(repoLink, '.claude', 'inputs'));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envLink, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall leaves a file behind a symlinked .claude/inputs in place',
        existsSync(join(linkTarget, 'apex-classes.txt')));

  // A settings.json this plugin created from nothing must not survive uninstall
  // as an empty shell of the parent objects (env: {}) it created along the way.
  const home3 = join(root, 'home3');
  mkdirSync(join(home3, '.claude'), { recursive: true });
  const env3 = { ...BASE_ENV, HOME: home3 };
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
  const env4 = { ...BASE_ENV, HOME: home4 };
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
  const env5 = { ...BASE_ENV, HOME: home5 };
  execFileSync('node', [join(SCRIPTS, 'install-task-tools.mjs')], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterSetup5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('setup replaces the user\'s own task tools value with 1',
        afterSetup5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', JSON.stringify(afterSetup5));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstall5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('uninstall puts back the user\'s own task tools value',
        afterUninstall5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '0', JSON.stringify(afterUninstall5));

  // A user who already chose their own advisor gets that choice back on uninstall.
  const homeAdvisor = join(root, 'homeAdvisor');
  mkdirSync(join(homeAdvisor, '.claude'), { recursive: true });
  const settingsAdvisor = join(homeAdvisor, '.claude', 'settings.json');
  writeFileSync(settingsAdvisor, JSON.stringify({ advisorModel: 'fable' }, null, 2) + '\n');
  const envAdvisor = { ...BASE_ENV, HOME: homeAdvisor };
  execFileSync('node', [join(SCRIPTS, 'install-advisor.mjs')], { env: envAdvisor, encoding: 'utf8', stdio: 'pipe' });
  const afterSetupAdvisor = JSON.parse(readFileSync(settingsAdvisor, 'utf8'));
  check('setup replaces the user\'s own advisor with opus',
        afterSetupAdvisor.advisorModel === 'opus', JSON.stringify(afterSetupAdvisor));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envAdvisor, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstallAdvisor = JSON.parse(readFileSync(settingsAdvisor, 'utf8'));
  check('uninstall puts back the user\'s own advisor and leaves no env block',
        afterUninstallAdvisor.advisorModel === 'fable' && !('env' in afterUninstallAdvisor), JSON.stringify(afterUninstallAdvisor));

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

  // --- Git hooks recognised by the hash setup recorded ----------------------

  const shippedHook = name => readFileSync(join(dirname(SCRIPTS), 'assets', 'githooks', name), 'utf8');
  /** Make an installed hook look like an earlier plugin version's copy that setup wrote and nobody changed. */
  const olderCopy = (homeDir, repoName, hookName, text) => {
    const file = join(homeDir, '.claude', 'hean-harness', 'install-manifest.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    const entry = m.changes.find(c => c.type === 'file-copy' && c.target.endsWith(`/${repoName}/.githooks/${hookName}`));
    writeFileSync(entry.target, text);
    entry.hash = createHash('sha256').update(text).digest('hex');
    writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  };
  const backedUpIn = (homeDir, line) => {
    const dir = join(homeDir, '.claude', 'hean-harness', 'backups');
    return existsSync(dir) && readdirSync(dir).some(f => readFileSync(join(dir, f), 'utf8').includes(line));
  };
  const OLD_HOOK = '#!/bin/sh\n# an earlier version of the plugin hook\nexit 0\n';
  const USER_LINE = '# a line the user added\n';

  const homeH = join(root, 'homeH');
  const repoH = join(root, 'repoH');
  mkdirSync(join(homeH, '.claude'), { recursive: true });
  mkdirSync(repoH, { recursive: true });
  execFileSync('git', ['-C', repoH, 'init', '-q', '-b', 'main']);
  const envH = { ...BASE_ENV, HOME: homeH };
  const runHooks = (repoDir, args) => execFileSync('node', [join(SCRIPTS, 'install-githooks.mjs'), '--repo', repoDir, ...args],
    { env: envH, encoding: 'utf8', stdio: 'pipe' });
  const msgH = join(repoH, '.githooks', 'commit-msg');
  runHooks(repoH, ['--commit-format', 'on']);
  olderCopy(homeH, 'repoH', 'commit-msg', OLD_HOOK);
  let outH = runHooks(repoH, []);
  check('an unchanged commit-msg copy from an earlier version is updated',
        readFileSync(msgH, 'utf8') === shippedHook('commit-msg') && outH.includes('Updated ') && !outH.includes('!! KEPT'), outH);
  const recordOf = () => JSON.parse(readFileSync(join(homeH, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'))
    .changes.find(c => c.type === 'file-copy' && c.target.endsWith('/repoH/.githooks/commit-msg'));
  check('after an update the record holds the hash of the shipped hook',
        recordOf().hash === createHash('sha256').update(shippedHook('commit-msg')).digest('hex'));
  appendFileSync(msgH, USER_LINE);
  outH = runHooks(repoH, []);
  check('an edited plugin copy of commit-msg is kept, and says so',
        readFileSync(msgH, 'utf8').includes(USER_LINE) &&
          outH.includes('!! This is the plugin\'s copy, edited since setup installed it'), outH);
  runHooks(repoH, ['--replace-githook']);
  check('--replace-githook replaces an edited plugin copy and keeps a backup',
        readFileSync(msgH, 'utf8') === shippedHook('commit-msg') && backedUpIn(homeH, USER_LINE));
  const repoK = join(root, 'repoK');
  mkdirSync(join(repoK, '.githooks'), { recursive: true });
  execFileSync('git', ['-C', repoK, 'init', '-q', '-b', 'main']);
  const THEIR_HOOK = '#!/bin/sh\n# someone else\'s hook\nexit 0\n';
  writeFileSync(join(repoK, '.githooks', 'commit-msg'), THEIR_HOOK);
  const outK = runHooks(repoK, ['--commit-format', 'on']);
  check('someone else\'s untracked commit-msg is still kept',
        readFileSync(join(repoK, '.githooks', 'commit-msg'), 'utf8') === THEIR_HOOK &&
          outK.includes('!! The hook is already there, so setup leaves it as it is.'), outK);
  const dropHash = () => {
    const file = join(homeH, '.claude', 'hean-harness', 'install-manifest.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    delete m.changes.find(c => c.type === 'file-copy' && c.target.endsWith('/repoH/.githooks/commit-msg')).hash;
    writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  };
  dropHash();
  outH = runHooks(repoH, []);
  check('a record without a hash and a hook equal to the plugin\'s copy is current, nothing kept',
        !outH.includes('!! KEPT') && outH.includes('already in place'), outH);
  writeFileSync(msgH, OLD_HOOK);
  outH = runHooks(repoH, []);
  check('a record without a hash and a different hook is kept with an honest line',
        readFileSync(msgH, 'utf8') === OLD_HOOK && outH.includes('before it recorded hashes') &&
          !outH.includes('edited since setup installed it') && outH.includes('--replace-githook'), outH);
  runHooks(repoH, ['--replace-githook']);
  check('--replace-githook replaces it, keeps a backup and records the hash',
        readFileSync(msgH, 'utf8') === shippedHook('commit-msg') && backedUpIn(homeH, 'an earlier version of the plugin hook') &&
          recordOf().hash === createHash('sha256').update(shippedHook('commit-msg')).digest('hex'));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envH, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall deletes the updated commit-msg', !existsSync(msgH));

  // --- The pre-commit hook that checks the per-story manifest ----------------

  const homeP = join(root, 'homeP');
  mkdirSync(join(homeP, '.claude'), { recursive: true });
  const envP = { ...BASE_ENV, HOME: homeP, CLAUDE_CONFIG_DIR: join(homeP, '.claude') };
  const sfdxRepo = name => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}\n');
    return dir;
  };
  const runP = (repoDir, args) => execFileSync('node', [join(SCRIPTS, 'install-githooks.mjs'), '--repo', repoDir, ...args],
    { env: envP, encoding: 'utf8', stdio: 'pipe' });
  const hooksPathOf = repoDir => {
    try { return execFileSync('git', ['-C', repoDir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return undefined; }
  };

  const repoP = sfdxRepo('repoP');
  const preP = join(repoP, '.githooks', 'pre-commit');
  let outP = runP(repoP, ['--commit-format', 'on']);
  check('the pre-commit hook is installed, executable, in an SFDX repository',
        existsSync(preP) && (statSync(preP).mode & 0o111) !== 0 && readFileSync(preP, 'utf8') === shippedHook('pre-commit'), outP);
  check('a repository without sfdx-project.json gets no pre-commit hook', !existsSync(join(repoH, '.githooks', 'pre-commit')));
  runP(repoP, ['--commit-format', 'off']);
  check('switching the commit format off keeps pre-commit and core.hooksPath',
        !existsSync(join(repoP, '.githooks', 'commit-msg')) && existsSync(preP) && hooksPathOf(repoP) === '.githooks',
        String(hooksPathOf(repoP)));
  runP(repoP, ['--commit-format', 'on']);
  olderCopy(homeP, 'repoP', 'pre-commit', OLD_HOOK);
  outP = runP(repoP, []);
  check('an unchanged pre-commit copy from an earlier version is updated',
        readFileSync(preP, 'utf8') === shippedHook('pre-commit') && outP.includes('Updated '), outP);
  appendFileSync(preP, USER_LINE);
  outP = runP(repoP, []);
  check('an edited plugin copy of pre-commit is kept, and says so',
        readFileSync(preP, 'utf8').includes(USER_LINE) && outP.includes('edited since setup installed it'), outP);

  const repoT = sfdxRepo('repoT');
  mkdirSync(join(repoT, '.githooks'), { recursive: true });
  writeFileSync(join(repoT, '.githooks', 'commit-msg'), '#!/bin/sh\nexit 0\n');
  execFileSync('git', ['-C', repoT, 'add', '.githooks/commit-msg']);
  runP(repoT, ['--commit-format', 'on']);
  check('a tracked .githooks/ folder gets no pre-commit hook', !existsSync(join(repoT, '.githooks', 'pre-commit')));

  const repoF = sfdxRepo('repoF');
  mkdirSync(join(repoF, '.githooks'), { recursive: true });
  const THEIR_PRE = '#!/bin/sh\n# the team\'s own pre-commit\nexit 0\n';
  writeFileSync(join(repoF, '.githooks', 'pre-commit'), THEIR_PRE);
  const outF = runP(repoF, ['--commit-format', 'on']);
  check('someone else\'s untracked pre-commit is kept, with a !! line',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === THEIR_PRE && outF.includes('!! KEPT — NOT CHANGED'), outF);
  runP(repoF, ['--replace-githook']);
  check('--replace-githook replaces someone else\'s pre-commit',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === shippedHook('pre-commit'));

  const repoO = sfdxRepo('repoO');
  mkdirSync(join(repoO, '.githooks'), { recursive: true });
  writeFileSync(join(repoO, '.githooks', 'pre-commit'), THEIR_PRE);
  const outO = runP(repoO, ['--commit-format', 'off']);
  check('someone else\'s pre-commit with core.hooksPath unset is kept, and the path stays unset',
        readFileSync(join(repoO, '.githooks', 'pre-commit'), 'utf8') === THEIR_PRE && hooksPathOf(repoO) === undefined &&
          outO.includes('!! KEPT — NOT CHANGED') && !outO.includes('core.hooksPath is undefined'), outO);

  const repoU = sfdxRepo('repoU');
  runP(repoU, ['--commit-format', 'off']);
  check('the pre-commit hook does not depend on the commit format',
        existsSync(join(repoU, '.githooks', 'pre-commit')) && hooksPathOf(repoU) === '.githooks');

  // core.hooksPath replaces .git/hooks, so setting it would switch off a hook already working there (Git LFS)
  const repoL = sfdxRepo('repoL');
  const lfsHook = join(repoL, '.git', 'hooks', 'post-checkout');
  writeFileSync(lfsHook, '#!/bin/sh\ngit lfs post-checkout "$@"\n');
  chmodSync(lfsHook, 0o755);
  const outL = runP(repoL, ['--commit-format', 'on']);
  check('a working hook in .git/hooks keeps core.hooksPath unset', hooksPathOf(repoL) === undefined, String(hooksPathOf(repoL)));
  check('the hooks left working are named on a !! line, with the manifest check for terminal commits off',
        outL.split('\n').some(l => l.startsWith('!! ') && l.includes('post-checkout')) &&
          outL.includes('manifest check for terminal commits is off'), outL);
  check('the commit-msg hook says the commit format check for terminal commits is off too',
        outL.includes('commit format check for terminal commits is off') && !outL.includes('Set core.hooksPath'), outL);

  execFileSync('node', [join(SCRIPTS, 'install-manifest-check.mjs')], { env: envP, encoding: 'utf8', stdio: 'pipe' });
  const checkDir = join(homeP, '.claude', 'hean-harness', 'hooks');
  check('the manifest check and branch-manifest are copied to the fixed folder',
        existsSync(join(checkDir, 'scripts', 'lib', 'manifest-check.mjs')) &&
          existsSync(join(checkDir, 'skills', 'branch-manifest', 'scripts', 'branch-manifest.mjs')));
  // outside a repository both scripts stop early; an import the copy lacks would fail instead
  const copied = execFileSync('node', [join(checkDir, 'scripts', 'lib', 'manifest-check.mjs'), '--git-hook'],
    { env: envP, encoding: 'utf8', stdio: 'pipe', cwd: root }) +
    execFileSync('node', [join(checkDir, 'skills', 'branch-manifest', 'scripts', 'branch-manifest.mjs')],
      { env: envP, encoding: 'utf8', stdio: 'pipe', cwd: root });
  check('the fixed copy runs with only the files copied', copied.startsWith('Error: ') && !copied.includes('Cannot find'), copied);

  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envP, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall deletes an unchanged pre-commit and unsets core.hooksPath',
        !existsSync(join(repoU, '.githooks', 'pre-commit')) && hooksPathOf(repoU) === undefined, String(hooksPathOf(repoU)));
  check('uninstall copies an edited pre-commit aside before deleting it', !existsSync(preP) && backedUpIn(homeP, USER_LINE));
  check('uninstall puts back the pre-commit it replaced',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === THEIR_PRE);
  check('uninstall deletes the fixed copy of the manifest check', !existsSync(checkDir));

  // --- Auto-update ---------------------------------------------------------

  const writeInstalled = (dir, marketplace) => writeFileSync(
    join(dir, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { [`hean-harness@${marketplace}`]: [{ scope: 'user' }] } }, null, 2) + '\n');
  const marketEntry = url => ({ source: { source: 'git', url } });

  // home6: a fresh entry (source only) — --auto-update hean turns it on, revert takes it back out
  const home6 = join(root, 'home6');
  mkdirSync(join(home6, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home6, 'test-market');
  const settings6 = join(home6, '.claude', 'settings.json');
  writeFileSync(settings6, JSON.stringify({ extraKnownMarketplaces: { 'test-market': marketEntry('https://example.com/a.git') } }, null, 2) + '\n');
  const env6 = { ...BASE_ENV, HOME: home6 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env6, encoding: 'utf8', stdio: 'pipe' });
  const afterHean6 = JSON.parse(readFileSync(settings6, 'utf8'));
  check('install-auto-update hean turns autoUpdate on', afterHean6.extraKnownMarketplaces['test-market'].autoUpdate === true);
  check('the marketplace source is unchanged',
        JSON.stringify(afterHean6.extraKnownMarketplaces['test-market'].source) === JSON.stringify(marketEntry('https://example.com/a.git').source));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env6, encoding: 'utf8', stdio: 'pipe' });
  const afterRevert6 = JSON.parse(readFileSync(settings6, 'utf8'));
  check('revert removes the autoUpdate key it added', !('autoUpdate' in afterRevert6.extraKnownMarketplaces['test-market']));
  check('revert leaves the marketplace source alone',
        JSON.stringify(afterRevert6.extraKnownMarketplaces['test-market'].source) === JSON.stringify(marketEntry('https://example.com/a.git').source));

  // home7: the user already had autoUpdate false — revert puts false back, not the key removed
  const home7 = join(root, 'home7');
  mkdirSync(join(home7, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home7, 'test-market');
  const settings7 = join(home7, '.claude', 'settings.json');
  writeFileSync(settings7, JSON.stringify({ extraKnownMarketplaces: { 'test-market': { ...marketEntry('https://example.com/a.git'), autoUpdate: false } } }, null, 2) + '\n');
  const env7 = { ...BASE_ENV, HOME: home7 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env7, encoding: 'utf8', stdio: 'pipe' });
  const afterHean7 = JSON.parse(readFileSync(settings7, 'utf8'));
  check('install-auto-update hean overrides an existing false value', afterHean7.extraKnownMarketplaces['test-market'].autoUpdate === true);
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env7, encoding: 'utf8', stdio: 'pipe' });
  const afterRevert7 = JSON.parse(readFileSync(settings7, 'utf8'));
  check('revert puts the user\'s own false value back', afterRevert7.extraKnownMarketplaces['test-market'].autoUpdate === false);

  // home8: the plugin's own marketplace has no extraKnownMarketplaces entry — nothing is touched
  const home8 = join(root, 'home8');
  mkdirSync(join(home8, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home8, 'test-market');
  const settings8 = join(home8, '.claude', 'settings.json');
  const settings8Text = JSON.stringify({ extraKnownMarketplaces: { 'other-market': marketEntry('https://example.com/b.git') } }, null, 2) + '\n';
  writeFileSync(settings8, settings8Text);
  const env8 = { ...BASE_ENV, HOME: home8 };
  const out8 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env8, encoding: 'utf8', stdio: 'pipe' });
  check('settings.json is untouched when the marketplace has no entry', readFileSync(settings8, 'utf8') === settings8Text);
  check('the output names /plugin when the marketplace has no entry', out8.includes('/plugin'));

  // home9: no install record at all — nothing is touched, exit 0
  const home9 = join(root, 'home9');
  mkdirSync(join(home9, '.claude'), { recursive: true });
  const settings9 = join(home9, '.claude', 'settings.json');
  const settings9Text = JSON.stringify({ theme: 'dark' }, null, 2) + '\n';
  writeFileSync(settings9, settings9Text);
  const env9 = { ...BASE_ENV, HOME: home9 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env9, encoding: 'utf8', stdio: 'pipe' });
  check('exit 0 when there is no install record', true);
  check('settings.json is untouched when there is no install record', readFileSync(settings9, 'utf8') === settings9Text);

  // home10: --auto-update all sets every marketplace, revert restores both
  const home10 = join(root, 'home10');
  mkdirSync(join(home10, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home10, 'test-market');
  const settings10 = join(home10, '.claude', 'settings.json');
  writeFileSync(settings10, JSON.stringify({ extraKnownMarketplaces: {
    'test-market':  marketEntry('https://example.com/a.git'),
    'other-market': marketEntry('https://example.com/b.git')
  } }, null, 2) + '\n');
  const env10 = { ...BASE_ENV, HOME: home10 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'all'], { env: env10, encoding: 'utf8', stdio: 'pipe' });
  const afterAll10 = JSON.parse(readFileSync(settings10, 'utf8'));
  check('--auto-update all turns autoUpdate on for the plugin\'s own marketplace',
        afterAll10.extraKnownMarketplaces['test-market'].autoUpdate === true);
  check('--auto-update all turns autoUpdate on for a second marketplace',
        afterAll10.extraKnownMarketplaces['other-market'].autoUpdate === true);
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env10, encoding: 'utf8', stdio: 'pipe' });
  const afterAllRevert10 = JSON.parse(readFileSync(settings10, 'utf8'));
  check('revert removes the autoUpdate key for the first marketplace',
        !('autoUpdate' in afterAllRevert10.extraKnownMarketplaces['test-market']));
  check('revert removes the autoUpdate key for the second marketplace',
        !('autoUpdate' in afterAllRevert10.extraKnownMarketplaces['other-market']));

  // home11: --auto-update off records the choice, so a later dry run stops asking
  const home11 = join(root, 'home11');
  mkdirSync(join(home11, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home11, 'test-market');
  const settings11 = join(home11, '.claude', 'settings.json');
  writeFileSync(settings11, JSON.stringify({ extraKnownMarketplaces: { 'test-market': marketEntry('https://example.com/a.git') } }, null, 2) + '\n');
  const env11 = { ...BASE_ENV, HOME: home11 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'off'], { env: env11, encoding: 'utf8', stdio: 'pipe' });
  const afterOff11 = JSON.parse(readFileSync(settings11, 'utf8'));
  check('--auto-update off records autoUpdate false', afterOff11.extraKnownMarketplaces['test-market'].autoUpdate === false);
  const dryAfterOff11 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--dry-run'], { env: env11, encoding: 'utf8', stdio: 'pipe' });
  check('a dry run after --auto-update off does not ask again', !dryAfterOff11.includes('!! ASK'));
  const beforeRealOff11 = readFileSync(settings11, 'utf8');
  const realAfterOff11 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs')], { env: env11, encoding: 'utf8', stdio: 'pipe' });
  check('a real run after --auto-update off reports the recorded choice',
        realAfterOff11.includes('test-market is already false in settings.json') && !realAfterOff11.includes('Auto-update was not chosen'),
        realAfterOff11);
  check('a real run after --auto-update off changes nothing', readFileSync(settings11, 'utf8') === beforeRealOff11);

  // home12: a dry run with no autoUpdate key yet prints the ASK line
  const home12 = join(root, 'home12');
  mkdirSync(join(home12, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home12, 'test-market');
  const settings12 = join(home12, '.claude', 'settings.json');
  const settings12Text = JSON.stringify({ extraKnownMarketplaces: { 'test-market': marketEntry('https://example.com/a.git') } }, null, 2) + '\n';
  writeFileSync(settings12, settings12Text);
  const env12 = { ...BASE_ENV, HOME: home12 };
  const dry12 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--dry-run'], { env: env12, encoding: 'utf8', stdio: 'pipe' });
  check('a dry run with the choice not yet made prints the ASK line', dry12.includes('!! ASK — AUTO-UPDATE NOT CHOSEN'));
  check('a dry run changes nothing', readFileSync(settings12, 'utf8') === settings12Text);

  // home13: a real run with no flag changes nothing
  const home13 = join(root, 'home13');
  mkdirSync(join(home13, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home13, 'test-market');
  const settings13 = join(home13, '.claude', 'settings.json');
  const settings13Text = JSON.stringify({ extraKnownMarketplaces: { 'test-market': marketEntry('https://example.com/a.git') } }, null, 2) + '\n';
  writeFileSync(settings13, settings13Text);
  const env13 = { ...BASE_ENV, HOME: home13 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs')], { env: env13, encoding: 'utf8', stdio: 'pipe' });
  check('a real run with no flag changes nothing', readFileSync(settings13, 'utf8') === settings13Text);

  // home14: --auto-update all still sets every existing entry when the plugin's
  // own marketplace (test-market) has no extraKnownMarketplaces entry at all
  const home14 = join(root, 'home14');
  mkdirSync(join(home14, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home14, 'test-market');
  const settings14 = join(home14, '.claude', 'settings.json');
  writeFileSync(settings14, JSON.stringify({ extraKnownMarketplaces: {
    'other-market': marketEntry('https://example.com/b.git')
  } }, null, 2) + '\n');
  const env14 = { ...BASE_ENV, HOME: home14 };
  const out14 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'all'], { env: env14, encoding: 'utf8', stdio: 'pipe' });
  const afterAll14 = JSON.parse(readFileSync(settings14, 'utf8'));
  check('--auto-update all turns autoUpdate on for a marketplace that exists even when the plugin\'s own marketplace has no entry',
        afterAll14.extraKnownMarketplaces['other-market'].autoUpdate === true);
  check('the plugin\'s own marketplace still has no entry', !('test-market' in afterAll14.extraKnownMarketplaces));
  check('the output names the plugin\'s own marketplace as not changed', out14.includes('test-market'));
  check('the output points at /plugin for the plugin\'s own marketplace', out14.includes('/plugin'));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env14, encoding: 'utf8', stdio: 'pipe' });
  const afterRevert14 = JSON.parse(readFileSync(settings14, 'utf8'));
  check('revert restores the file to no autoUpdate key on other-market',
        !('autoUpdate' in afterRevert14.extraKnownMarketplaces['other-market']));

  // home15: setup run twice keeps the auto-update choice, and uninstall still
  // restores the state from before the first run
  const home15 = join(root, 'home15');
  const repo15 = join(root, 'repo15');
  mkdirSync(join(home15, '.claude', 'plugins'), { recursive: true });
  mkdirSync(repo15, { recursive: true });
  execFileSync('git', ['-C', repo15, 'init', '-q', '-b', 'main']);
  writeInstalled(home15, 'test-market');
  const settings15 = join(home15, '.claude', 'settings.json');
  writeFileSync(settings15, JSON.stringify({ theme: 'dark', extraKnownMarketplaces: {
    'test-market': marketEntry('https://example.com/a.git')
  } }, null, 2) + '\n');
  const env15 = { ...BASE_ENV, HOME: home15, SHELL: '/bin/zsh' };
  const setup15 = args => execFileSync('node', [join(SCRIPTS, 'setup.mjs'), '--repo', repo15, ...args],
                                       { env: env15, encoding: 'utf8', stdio: 'pipe' });
  setup15(['--commit-format', 'off', '--auto-update', 'hean']);
  const autoUpdate15 = () => JSON.parse(readFileSync(settings15, 'utf8')).extraKnownMarketplaces['test-market'].autoUpdate;
  check('the first setup with hean turns autoUpdate on', autoUpdate15() === true, String(autoUpdate15()));
  const dry15 = setup15(['--dry-run']);
  check('a dry run after the first setup does not ask about auto-update again', !dry15.includes('!! ASK — AUTO-UPDATE'));
  const second15 = setup15([]);
  check('a second setup with no flag does not ask about auto-update', !second15.includes('!! ASK — AUTO-UPDATE'));
  check('a second setup with no flag keeps autoUpdate on', autoUpdate15() === true, String(autoUpdate15()));
  const dryAgain15 = setup15(['--dry-run']);
  check('a dry run after the second setup still does not ask', !dryAgain15.includes('!! ASK — AUTO-UPDATE'));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env15, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstall15 = JSON.parse(readFileSync(settings15, 'utf8'));
  check('uninstall after two setups removes the autoUpdate key setup added',
        !('autoUpdate' in afterUninstall15.extraKnownMarketplaces['test-market']), JSON.stringify(afterUninstall15));
  check('uninstall after two setups leaves the other settings as they were', afterUninstall15.theme === 'dark');

  // home16: a marketplace name with a dot is refused by the real run and the dry run
  const home16 = join(root, 'home16');
  mkdirSync(join(home16, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home16, 'my.market');
  const settings16 = join(home16, '.claude', 'settings.json');
  const settings16Text = JSON.stringify({ extraKnownMarketplaces: {
    'my.market': marketEntry('https://example.com/a.git')
  } }, null, 2) + '\n';
  writeFileSync(settings16, settings16Text);
  const env16 = { ...BASE_ENV, HOME: home16 };
  const out16 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env16, encoding: 'utf8', stdio: 'pipe' });
  check('a dotted marketplace name is refused', out16.includes('Auto-update was not changed') && out16.includes('contains a "."'), out16);
  check('settings.json is untouched after the refusal', readFileSync(settings16, 'utf8') === settings16Text);
  const dryAll16 = execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'all', '--dry-run'], { env: env16, encoding: 'utf8', stdio: 'pipe' });
  check('the all dry run reports the dotted name as not changed',
        dryAll16.includes('my.market  not changed') && !dryAll16.includes('my.market  to true'), dryAll16);
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'all'], { env: env16, encoding: 'utf8', stdio: 'pipe' });
  check('the all real run leaves the dotted name untouched', readFileSync(settings16, 'utf8') === settings16Text);

  // home17: switching from all to hean puts the other marketplace back
  const home17 = join(root, 'home17');
  mkdirSync(join(home17, '.claude', 'plugins'), { recursive: true });
  writeInstalled(home17, 'test-market');
  const settings17 = join(home17, '.claude', 'settings.json');
  writeFileSync(settings17, JSON.stringify({ extraKnownMarketplaces: {
    'test-market':  marketEntry('https://example.com/a.git'),
    'other-market': { ...marketEntry('https://example.com/b.git'), autoUpdate: false }
  } }, null, 2) + '\n');
  const env17 = { ...BASE_ENV, HOME: home17 };
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'all'], { env: env17, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'install-auto-update.mjs'), '--auto-update', 'hean'], { env: env17, encoding: 'utf8', stdio: 'pipe' });
  const after17 = JSON.parse(readFileSync(settings17, 'utf8')).extraKnownMarketplaces;
  check('switching from all to hean keeps the plugin\'s own marketplace on', after17['test-market'].autoUpdate === true);
  check('switching from all to hean puts the other marketplace\'s own value back', after17['other-market'].autoUpdate === false,
        String(after17['other-market'].autoUpdate));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env17, encoding: 'utf8', stdio: 'pipe' });
  const afterRevert17 = JSON.parse(readFileSync(settings17, 'utf8')).extraKnownMarketplaces;
  check('uninstall after the switch restores the original state',
        !('autoUpdate' in afterRevert17['test-market']) && afterRevert17['other-market'].autoUpdate === false);
} finally {
  let left = '';
  try { left = execFileSync('pgrep', ['-fl', root], { encoding: 'utf8' }); } catch (e) { if (e.status !== 1) throw e; }
  check('no process started by this test is left running', left === '', left);
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
