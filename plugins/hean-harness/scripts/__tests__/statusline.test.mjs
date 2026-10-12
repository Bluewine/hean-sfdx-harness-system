#!/usr/bin/env node
/**
 * The three status lines: each piece from fixed inputs, the entry script with a
 * fixture on stdin, and the launcher command the statusLine setting holds.
 *
 * Runs against a throwaway home directory. Touches nothing of yours.
 *
 * Run: node scripts/__tests__/statusline.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGIN = dirname(SCRIPTS);
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'statusline-')));
const home = join(sandbox, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
// The libraries resolve the configuration folder when they load, so point it at the sandbox first.
process.env.HOME = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.SF_TARGET_ORG;
const lib = await import(join(SCRIPTS, 'lib', 'statusline.mjs'));

const strip = s => s.replace(/\u001b\[[0-9;]*m/g, '');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  // ── numbers and paths ──────────────────────────────────────────────────────
  check('numbers below 1,000 print as they are', lib.fmtNum(999) === '999' && lib.fmtNum(0) === '0');
  check('thousands are truncated, not rounded', lib.fmtNum(1999) === '1.9k', lib.fmtNum(1999));
  check('millions are truncated, not rounded', lib.fmtNum(2396257) === '2.3M', lib.fmtNum(2396257));
  check('a folder under home starts at ~', lib.homePath(join(home, 'git', 'repo'), home) === '~/git/repo');
  check('home itself is ~', lib.homePath(home, home) === '~');
  check('a folder outside home keeps its full path', lib.homePath('/opt/x', home) === '/opt/x');
  check('a sibling whose name starts with home\'s is not shortened',
        lib.homePath(`${home}other`, home) === `${home}other`);

  // ── commit preference ──────────────────────────────────────────────────────
  check('commit per task reads per task', lib.commitsText({ mode: 'main', commits: 'yes' }) === 'commits: per task');
  check('no commits reads none', lib.commitsText({ mode: 'subagent', commits: 'no' }) === 'commits: none');
  check('no saved preference reads not set', lib.commitsText(null) === 'commits: not set');

  // ── orgs ───────────────────────────────────────────────────────────────────
  const records = [
    { alias: 'hean-prod', username: 'me@acme.com', role: 'production', branch: 'master' },
    { alias: 'hean-uat', username: 'me@acme.com.uat', role: 'pipeline', branch: 'release' },
    { alias: 'hean-res', username: 'me@acme.com.res', role: 'research', branch: null },
    { alias: 'hean-qa', username: 'me@acme.com.qa', role: 'pipeline', branch: 'integration' },
    { alias: 'hean-dev', username: 'me@acme.com.dev', role: 'development', branch: null },
    { alias: 'hean-reint', username: 'me@acme.com.reint', role: 'pipeline', branch: 'work-*' }
  ];
  const loggedIn = new Set(['me@acme.com', 'me@acme.com.qa', 'me@acme.com.dev', 'me@acme.com.reint', 'me@acme.com.res']);
  const login = u => loggedIn.has(u) ? { isSandbox: u !== 'me@acme.com' } : null;
  const chain = lib.orgsText(records, login);
  check('orgs run development, pipeline by branch, research, production, with icons and aliases',
        chain === '🛠️ dev: hean-dev → 🧱 reint (work-*): hean-reint → 🧪 qa (integration): hean-qa → ' +
                  '🎭 uat (release): - → 🔭 res: hean-res → 🏦 prod: hean-prod', chain);
  const noAlias = lib.orgsText([{ alias: null, username: 'me@acme.com.dev', role: 'development', branch: null }], login);
  check('a logged-in org with no alias shows its username', noAlias === '🛠️ dev: me@acme.com.dev', noAlias);
  const others = lib.orgsText([
    { alias: 'z', username: 'me@acme.com.zz', role: 'pipeline', branch: 'zeta' },
    { alias: 'a', username: 'me@acme.com.aa', role: 'pipeline', branch: 'alpha' }
  ], () => ({ isSandbox: true }));
  check('pipeline orgs on other branches sort alphabetically and use 🚚',
        others === '🚚 aa (alpha): a → 🚚 zz (zeta): z', others);
  const scratch = lib.orgsText([{ alias: 's', username: 'test-abc@example.com', role: 'pipeline', branch: 'work-x' }],
    () => ({ isSandbox: false }));
  check('a username that is not sandbox-shaped falls back to the role name',
        scratch === '🧱 pipeline (work-x): s', scratch);
  check('no saved roles names the skill that saves them',
        lib.orgsText([], login) === '🔌 no org roles saved · /hean-harness:org-roles');
  check('saved roles with none logged in say no org is connected',
        lib.orgsText(records, () => null) === '🔌 no org connected');

  // ── lines 2 and 3 ──────────────────────────────────────────────────────────
  check('line 2 outside a project is the commit part alone',
        strip(lib.line2(null, null)) === '💾 commits: not set');
  check('line 2 joins the commit part and the orgs',
        strip(lib.line2({ mode: 'main', commits: 'yes' }, records, login)) === `💾 commits: per task │ ${chain}`);
  const l3 = strip(lib.line3({ model: 'Opus 5.5', effort: 'high', costUsd: 4.18 },
                             { new: 180412, cached: 2396257, turn: { up: 0, down: 0 } }));
  check('line 3 shows model, effort, the meter and the dollars',
        l3 === '🧠 Opus 5.5 · ⚡ high │ 🚕 180.4k new + 2.3M cached · ≈$4.18', l3);
  check('line 3 leaves effort out and shows a dash without the meter',
        strip(lib.line3({ model: 'Opus 5.5', costUsd: 0.42 }, null)) === '🧠 Opus 5.5 │ 🚕 – · ≈$0.42');
  check('line 3 leaves the dollars out when the cost is absent',
        strip(lib.line3({ model: 'Opus 5.5', costUsd: NaN }, null)) === '🧠 Opus 5.5 │ 🚕 –');

  // ── line 1 ─────────────────────────────────────────────────────────────────
  const l1 = strip(lib.line1({ dir: '~/git/repo', branch: 'work-A', worktree: 'A-wt', org: 'dev', usedPct: 12,
                               ctxWindow: 200000, turn: { up: 74210, down: 1830 }, sessionName: 's' }));
  check('line 1 in a worktree with a turn under way',
        l1 === '➜  📁 ~/git/repo 🌿 work-A (A-wt) ☁️ dev 📊 12% (24.0k/200.0k) │ ↑74.2k ↓1.8k 🏷️ s', l1);
  const l1Plain = strip(lib.line1({ dir: '~/git/repo', branch: 'main', usedPct: 12, ctxWindow: 200000 }));
  check('line 1 leaves out the worktree, org, turn and name when they have no value',
        l1Plain === '➜  📁 ~/git/repo 🌿 main 📊 12% (24.0k/200.0k)', l1Plain);

  // ── meter file ─────────────────────────────────────────────────────────────
  const meterDir = join(sandbox, 'meter');
  mkdirSync(meterDir, { recursive: true });
  writeFileSync(join(meterDir, 'good.json'), JSON.stringify({ new: 5, cached: 7, turn: { up: 3, down: 1 }, updatedAt: 1 }));
  writeFileSync(join(meterDir, 'half.json'), '{"new": 5, "cach');
  writeFileSync(join(meterDir, 'neg.json'), JSON.stringify({ new: -1, cached: 7, turn: { up: 3, down: 1 } }));
  const good = lib.readMeter('good', meterDir);
  check('a valid meter file is read', good?.new === 5 && good?.cached === 7 && good?.turn.up === 3 && good?.turn.down === 1,
        JSON.stringify(good));
  check('a half-written meter file reads as absent', lib.readMeter('half', meterDir) === null);
  check('a meter file with a negative count reads as absent', lib.readMeter('neg', meterDir) === null);
  check('a missing meter file reads as absent', lib.readMeter('none', meterDir) === null);
  check('a session id with a slash is refused', lib.readMeter('../good', meterDir) === null);

  const pruneDir = join(sandbox, 'prune');
  lib.prepareMeterDir(pruneDir);
  check('the meter folder is created', existsSync(pruneDir));
  const now = Date.now();
  const old = (now - 31 * 86_400_000) / 1000;
  writeFileSync(join(pruneDir, 'old.json'), '{}');
  writeFileSync(join(pruneDir, 'new.json'), '{}');
  utimesSync(join(pruneDir, 'old.json'), old, old);
  rmSync(join(pruneDir, '.pruned'), { force: true });
  lib.prepareMeterDir(pruneDir, now);
  check('a meter file older than 30 days is deleted', !existsSync(join(pruneDir, 'old.json')));
  check('a recent meter file is kept', existsSync(join(pruneDir, 'new.json')));
  writeFileSync(join(pruneDir, 'old2.json'), '{}');
  utimesSync(join(pruneDir, 'old2.json'), old, old);
  lib.prepareMeterDir(pruneDir, now + 1000);
  check('pruning runs at most once a day', existsSync(join(pruneDir, 'old2.json')));
  // ── the entry script ───────────────────────────────────────────────────────
  const SCRIPT = join(PLUGIN, 'assets', 'statusline', 'statusline-command.mjs');
  const env = { ...process.env, HOME: home };
  const git = (...args) => execFileSync('git', args, { env, encoding: 'utf8', stdio: 'pipe' }).trim();
  const runScript = (input, extraEnv = {}) =>
    spawnSync('node', [SCRIPT], { env: { ...env, ...extraEnv }, input, encoding: 'utf8' });

  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  mkdirSync(join(repo, '.sf'), { recursive: true });
  git('-C', repo, 'init', '-q', '-b', 'work-ABC');
  writeFileSync(join(repo, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}');
  writeFileSync(join(repo, '.sf', 'config.json'), '{"target-org":"hean-dev"}');
  writeFileSync(join(repo, '.claude', 'hean-harness.json'), JSON.stringify({ orgs: {
    '00D1': { alias: 'hean-dev', username: 'me@acme.com.dev', role: 'development', deploy: true, branch: null },
    '00D2': { alias: 'hean-qa', username: 'me@acme.com.qa', role: 'pipeline', deploy: false, branch: 'integration' }
  } }));
  mkdirSync(join(home, '.sfdx'), { recursive: true });
  writeFileSync(join(home, '.sfdx', 'alias.json'), '{"orgs":{"hean-dev":"me@acme.com.dev"}}');
  writeFileSync(join(home, '.sfdx', 'me@acme.com.dev.json'), '{"orgId":"00D1","instanceUrl":"https://x","isSandbox":true}');
  const stateDir = join(home, '.claude', 'hean-harness');
  mkdirSync(join(stateDir, 'meter'), { recursive: true });
  writeFileSync(join(stateDir, 'implementation.json'), '{"mode":"main","commits":"yes"}');
  writeFileSync(join(stateDir, 'meter', 's1.json'), JSON.stringify({ new: 5000, cached: 20000, turn: { up: 2000, down: 300 }, updatedAt: 1 }));

  const fixture = (dir, session = 's1') => JSON.stringify({
    session_id: session, workspace: { current_dir: dir }, model: { display_name: 'Opus 5.5' },
    effort: { level: 'high' }, cost: { total_cost_usd: 1.5 },
    context_window: { used_percentage: 10, context_window_size: 1000000 }
  });

  const r = runScript(fixture(repo));
  const [s1, s2, s3] = strip(r.stdout).split('\n');
  check('the script exits 0', r.status === 0, r.stderr);
  check('line 1 shows the path from ~, the branch, the default org, the context and the turn',
        s1 === '➜  📁 ~/repo 🌿 work-ABC ☁️ hean-dev 📊 10% (100.0k/1.0M) │ ↑2.0k ↓300', s1);
  check('line 2 shows the commit preference and the project\'s orgs',
        s2 === '💾 commits: per task │ 🛠️ dev: hean-dev → 🧪 qa (integration): -', s2);
  check('line 3 shows the model, the effort, the meter and the dollars',
        s3 === '🧠 Opus 5.5 · ⚡ high │ 🚕 5.0k new + 20.0k cached · ≈$1.50', s3);

  const noMeter = strip(runScript(fixture(repo, 's2')).stdout).split('\n');
  check('without a meter file line 1 has no turn and line 3 shows a dash',
        !noMeter[0].includes('↑') && noMeter[2] === '🧠 Opus 5.5 · ⚡ high │ 🚕 – · ≈$1.50', noMeter.join(' / '));

  const plain = join(home, 'plain');
  mkdirSync(plain, { recursive: true });
  git('-C', plain, 'init', '-q', '-b', 'main');
  const plainLines = strip(runScript(fixture(plain)).stdout).split('\n');
  check('a repository that is no SFDX project and has no roles shows only the commit part',
        plainLines[1] === '💾 commits: per task', plainLines[1]);

  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(home, 'repo-wt');
  git('-C', repo, 'worktree', 'add', '-q', '-b', 'work-WT', wt);
  const wtLine = strip(runScript(fixture(wt)).stdout).split('\n')[0];
  check('in a linked worktree the branch is followed by the worktree folder name',
        wtLine.includes('📁 ~/repo-wt 🌿 work-WT (repo-wt)'), wtLine);
  const wtOrgs = strip(runScript(fixture(wt)).stdout).split('\n')[1];
  check('a linked worktree reads the main checkout\'s org roles', wtOrgs === s2, wtOrgs);
  git('-C', wt, 'checkout', '-q', '--detach');
  const sha = git('-C', wt, 'rev-parse', '--short', 'HEAD');
  const detached = strip(runScript(fixture(wt)).stdout).split('\n')[0];
  check('a detached HEAD shows the short commit hash', detached.includes(`🌿 ${sha} (repo-wt)`), detached);

  const empty = runScript('');
  check('empty input still prints and exits 0', empty.status === 0 && empty.stdout.length > 0, empty.stderr);
  rmSync(join(stateDir, 'meter'), { recursive: true, force: true });
  runScript(fixture(repo));
  check('the script creates the meter folder the mod writes into', existsSync(join(stateDir, 'meter')));
  // ── the launcher ───────────────────────────────────────────────────────────
  const launcher = await import(join(SCRIPTS, 'lib', 'statusline-launcher.mjs'));
  const id = launcher.pluginId(PLUGIN);
  check('the plugin id comes from the marketplace file in a source checkout',
        id === 'hean-harness@hean-sfdx-harness-system', String(id));
  check('the plugin id comes from the path in the plugin cache',
        launcher.pluginId('/x/plugins/cache/mkt/plug/1.0.0') === 'plug@mkt');
  check('the plugins folder follows CLAUDE_CODE_PLUGIN_CACHE_DIR',
        launcher.pluginsRoot({ CLAUDE_CODE_PLUGIN_CACHE_DIR: '/p' }) === '/p');
  check('the plugins folder defaults to the configuration folder',
        launcher.pluginsRoot({}) === join(home, '.claude', 'plugins'));

  // A space in the path: the command must keep it one argument.
  const pluginsDir = join(sandbox, 'plug ins');
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [id]: [
    { scope: 'user', installPath: join(sandbox, 'gone'), version: '0.0.1', lastUpdated: '2026-01-01T00:00:00.000Z' },
    { scope: 'user', installPath: PLUGIN, version: '0.0.2', lastUpdated: '2026-10-01T00:00:00.000Z' }
  ] } }));
  const direct = runScript(fixture(repo)).stdout;
  const viaLauncher = spawnSync('bash', ['-c', launcher.launcherCommand(pluginsDir, id)],
    { env, input: fixture(repo), encoding: 'utf8' });
  check('the launcher runs the script of the most recently updated install',
        viaLauncher.status === 0 && viaLauncher.stdout === direct && direct.split('\n').length === 4,
        viaLauncher.stdout + viaLauncher.stderr);
  const lost = spawnSync('bash', ['-c', launcher.launcherCommand(join(sandbox, 'nowhere'), id)],
    { env, input: fixture(repo), encoding: 'utf8' });
  check('without installed_plugins.json the launcher prints the fallback line and exits 0',
        lost.status === 0 && lost.stdout === `${launcher.FALLBACK}\n`, lost.stdout + lost.stderr);

  const brokenPlugin = join(sandbox, 'broken-plugin');
  mkdirSync(join(brokenPlugin, 'assets', 'statusline'), { recursive: true });
  writeFileSync(join(brokenPlugin, 'assets', 'statusline', 'statusline-command.mjs'), 'throw new Error("boom");\n');
  const brokenDir = join(sandbox, 'broken-plugins');
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [id]: [
    { scope: 'user', installPath: brokenPlugin, version: '0.0.3', lastUpdated: '2026-10-02T00:00:00.000Z' }
  ] } }));
  const failed = spawnSync('bash', ['-c', launcher.launcherCommand(brokenDir, id)],
    { env, input: fixture(repo), encoding: 'utf8' });
  check('a script that throws makes the launcher print the script-failed line and exit 0',
        failed.status === 0 && failed.stdout === `${launcher.SCRIPT_FAILED}\n`, failed.stdout + failed.stderr);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
