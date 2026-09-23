/**
 * Checks for things this environment needs that are not files we install.
 *
 * Java deserves care. A `java` on PATH does not prove a JDK is there:
 * Salesforce machines ship a stub at /usr/local/bin/java that prints an
 * install message and exits 0. Without a real JDK the pmd, cpd and sfge
 * engines cannot start, and that failure stops the whole analyzer run,
 * ESLint included — so the command looks like it worked while checking
 * nothing. Read the version string; do not trust the exit code.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeDir } from './paths.mjs';
import { findLinear, LINEAR_HOST } from './mcp.mjs';

export const SUPERPOWERS = 'superpowers@claude-plugins-official';

/**
 * Where superpowers comes from.
 *
 * A plugin cannot be installed until the marketplace that carries it has been
 * added, and a fresh Claude Code configuration has no marketplaces at all — not
 * even Anthropic's own. Installing without adding it first fails with "not found
 * in marketplace", which reads like the plugin is gone rather than like a step
 * is missing. So setup adds the marketplace and then installs; both commands are
 * safe to repeat and say so when there is nothing to do.
 */
export const SUPERPOWERS_MARKETPLACE = 'claude-plugins-official';
// The full HTTPS URL, not the owner/repo shorthand. The shorthand is resolved
// over SSH, which fails on a machine whose GitHub account has no SSH key on it —
// and the error names the clone rather than the missing key, so it reads as the
// marketplace being unreachable.
export const SUPERPOWERS_SOURCE = 'https://github.com/anthropics/claude-plugins-official.git';

/**
 * The plugins setup installs from a marketplace: the id to install, the
 * marketplace that carries it, and where that marketplace is cloned from.
 */
export const SUPERPOWERS_PLUGIN = { id: SUPERPOWERS, marketplace: SUPERPOWERS_MARKETPLACE, source: SUPERPOWERS_SOURCE };

/**
 * The ego-browser skill, published by ego lite's makers as a plugin. It drives
 * the ego lite browser, which each user installs themselves (EGO_LITE_URL).
 */
export const EGO_PLUGIN = {
  id: 'browser-skills@ego-agent-skills',
  marketplace: 'ego-agent-skills',
  source: 'https://github.com/citrolabs/ego-lite.git'
};
export const EGO_LITE_URL = 'https://lite.ego.app/';

/** Is the marketplace that carries superpowers configured on this machine? */
export function marketplacePresent(name = SUPERPOWERS_MARKETPLACE) {
  if (!present('claude')) return false;
  return new RegExp(`\\b${name}\\b`).test(runOut('claude', ['plugin', 'marketplace', 'list']));
}

/**
 * Run a command and return everything it printed, from both streams.
 * `java -version` writes its version to standard error, so reading only
 * standard output finds nothing and a working JDK looks like a stub.
 */
/** Standard output only. Use this when the output has to parse. */
export function runOut(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  return (r.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
}

export function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  // strip terminal colour codes: sf wraps versions in them, which corrupts any
  // value parsed out of the output
  return `${r.stdout || ''}${r.stderr || ''}`.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Is this command on PATH? Looks directly, rather than going through a shell. */
export function present(cmd) {
  return (process.env.PATH || '').split(':').filter(Boolean).some(d => {
    try { return statSync(join(d, cmd)).isFile(); } catch { return false; }
  });
}

export function checkJava() {
  if (!present('java')) return { ok: false, detail: 'java is not on PATH' };
  const m = run('java', ['-version']).match(/(?:openjdk|java) version "([0-9._]+)"/);
  if (!m) return { ok: false, detail: 'java runs but prints no version, so it is a stub rather than a JDK' };
  const v = m[1];
  let major = Number(v.split('.')[0]);
  if (major === 1) major = Number(v.split('.')[1]);
  return major >= 11
    ? { ok: true, detail: `JDK ${v}` }
    : { ok: false, detail: `JDK ${v}, but 11 or newer is needed` };
}

/** Is this plugin installed and enabled? */
export function checkPlugin(p) {
  if (!present('claude')) {
    const cached = join(claudeDir(), 'plugins', 'cache', p.marketplace, p.id.split('@')[0]);
    return existsSync(cached)
      ? { ok: true, detail: 'found in the plugin cache' }
      : { ok: false, state: 'missing', detail: 'the claude command is not on PATH and nothing is cached' };
  }
  // stderr can carry an update notice, which would break the parse; and a
  // response that is not an array would throw on .filter outside this guard
  let hit = [];
  try {
    const rows = JSON.parse(runOut('claude', ['plugin', 'list', '--json']));
    if (!Array.isArray(rows)) return { ok: false, state: 'unknown', detail: 'the plugin list could not be read' };
    hit = rows.filter(r => r && r.id === p.id);
  } catch {
    return { ok: false, state: 'unknown', detail: 'the plugin list could not be read' };
  }
  if (hit.length === 0) return { ok: false, state: 'missing', detail: 'not installed' };
  return hit.some(r => r.enabled)
    ? { ok: true, detail: 'installed and enabled' }
    : { ok: false, state: 'disabled', detail: 'installed but switched off' };
}

export const checkSuperpowers = () => checkPlugin(SUPERPOWERS_PLUGIN);

/** Where ego lite's own onboarding writes the ego-browser skill. */
export const egoOnboardingSkill = () => join(claudeDir(), 'skills', 'ego-browser', 'SKILL.md');

/**
 * Is the ego-browser skill available? ego lite's onboarding writes its own copy
 * into the user's skills folder. Installing the plugin beside it would load the
 * same skill twice under two names, so that copy counts as installed.
 */
export function checkEgoSkills() {
  if (existsSync(egoOnboardingSkill())) {
    return { ok: true, onboarding: true, detail: `written by ego lite's onboarding to ${dirname(egoOnboardingSkill())}` };
  }
  return checkPlugin(EGO_PLUGIN);
}

/**
 * Is the ego lite browser installed? Each user installs it themselves, so it is
 * recommended rather than required: only the ego-browser skill needs it.
 */
export function checkEgoLite() {
  if (platform() !== 'darwin') {
    return { ok: true, optional: true, detail: `not available here — ego lite is macOS only (${EGO_LITE_URL})` };
  }
  const apps = ['/Applications/ego lite.app', join(homedir(), 'Applications', 'ego lite.app')];
  if (apps.some(a => existsSync(a)) || present('ego-browser')) return { ok: true, detail: 'installed' };
  return { ok: true, optional: true, recommend: true,
           detail: `not installed — recommended for browser tasks; install it yourself from ${EGO_LITE_URL}` };
}

/**
 * Python is not needed to install or run the harness. Two skills shell out to
 * it for JSON and XML work against a live org, so it is reported rather than
 * required: everything else works without it.
 */
export function checkPython() {
  return present('python3')
    ? { ok: true, detail: 'installed' }
    : { ok: true, optional: true,
        detail: 'not installed — only /deprecate-flow and /soql-bindvar-resolver need it' };
}

export function javaFix() {
  if (platform() !== 'darwin') return "sudo apt install openjdk-17-jdk    (or your distribution's equivalent)";
  return present('brew') ? 'brew install --cask zulu@17' : 'install a JDK 11 or newer from http://sfdc.co/openjdk';
}

export function pythonFix() {
  return platform() === 'darwin' ? 'brew install python' : 'sudo apt install python3';
}

/**
 * Has `npm install` been run in this repository?
 *
 * Only meaningful when the repository has a package.json. Without the
 * dependencies, jest, gulp and prettier cannot run at all.
 */
export function checkNodeModules(repo) {
  if (!repo || !existsSync(join(repo, 'package.json'))) {
    return { ok: true, skipped: true, detail: 'no package.json here, so nothing to install' };
  }
  return existsSync(join(repo, 'node_modules'))
    ? { ok: true, detail: 'installed' }
    : { ok: false, detail: 'not installed, so jest, gulp and prettier cannot run' };
}

export function checkSfCli() {
  if (!present('sf')) {
    return { ok: false, detail: 'not installed, so no retrieve, deploy, Apex test run or analyzer run is possible' };
  }
  const v = run('sf', ['--version']).split('\n')[0].trim();
  return { ok: true, detail: v || 'installed' };
}

/**
 * Is the code analyzer plugin there, and which version?
 *
 * It is an `sf` plugin, not an npm dependency, so `npm install` does not
 * provide it and it is easy to assume it is present. Different versions
 * report different findings, so a version that does not match the one the
 * build pipeline installs makes a local run disagree with the pipeline.
 *
 * Parsing stops at the uninstalled section, whose rows carry a version
 * without the plugin being installed.
 */
export function checkCodeAnalyzer() {
  if (!present('sf')) return { ok: false, skipped: true, detail: 'cannot check without the sf CLI' };
  const out = run('sf', ['plugins'], { NO_COLOR: '1', FORCE_COLOR: '0' });
  let version = null;
  for (const raw of out.split('\n')) {
    if (/Uninstalled JIT Plugins/i.test(raw)) break;
    const m = raw.trim().match(/^(?:@salesforce\/plugin-)?code-analyzer\s+(\S+)/);
    if (m) { version = m[1]; break; }
  }
  return version
    ? { ok: true, detail: `${version} — make sure this matches what your build pipeline installs` }
    : { ok: false, detail: 'not installed, so the code analyzer cannot run' };
}

export const sfCliFix = 'install it from https://developer.salesforce.com/tools/salesforcecli';
export const analyzerFix = 'sf plugins install @salesforce/plugin-code-analyzer';
export const nodeModulesFix = 'npm install';

/**
 * Can the Linear skills reach Linear?
 *
 * Several skills resolve a work ID to an issue and a sprint cycle through an MCP
 * server. Being declared is not the same as being usable — the server still has
 * to be authenticated, which happens in a browser and cannot be scripted — so
 * this reports what is declared and says so in those words.
 */
export function checkLinearMcp(repo) {
  const hits = findLinear(repo);
  if (!hits.length) {
    return { ok: false, state: 'missing',
             detail: 'no server points at Linear, so the story lookups cannot run' };
  }
  const names = [...new Set(hits.map(h => h.name))].join(', ');
  return { ok: true, detail: `${names}, declared in ${hits[0].where} — authenticate it in a session with /mcp` };
}

export const linearFix =
  `claude mcp add --transport http --scope project linear-server https://${LINEAR_HOST}/mcp`;

/**
 * The command that fixes a plugin, which is two commands when the marketplace
 * it comes from has not been added yet.
 */
export function pluginFix(p, r = checkPlugin(p)) {
  if (r.state === 'disabled') return `claude plugin enable ${p.id}`;
  const install = `claude plugin install ${p.id}`;
  return marketplacePresent(p.marketplace)
    ? install
    : `claude plugin marketplace add ${p.source} && ${install}`;
}

export const superpowersFix = (sp = checkSuperpowers()) => pluginFix(SUPERPOWERS_PLUGIN, sp);

/** Every check, in report order, with the command that fixes each one. */
export function allChecks(repo) {
  const sp = checkSuperpowers();
  const ego = checkEgoSkills();
  return [
    { name: 'Java',          result: checkJava(),             fix: javaFix() },
    { name: 'sf CLI',        result: checkSfCli(),            fix: sfCliFix },
    { name: 'code analyzer', result: checkCodeAnalyzer(),     fix: analyzerFix },
    { name: 'node modules',  result: checkNodeModules(repo),  fix: nodeModulesFix },
    { name: 'superpowers',   result: sp,       fix: superpowersFix(sp) },
    { name: 'ego skills',    result: ego,      fix: ego.ok ? null : pluginFix(EGO_PLUGIN, ego) },
    { name: 'ego lite',      result: checkEgoLite(),          fix: null },
    { name: 'Linear',        result: checkLinearMcp(repo),    fix: linearFix },
    { name: 'python3',       result: checkPython(),           fix: pythonFix() }
  ];
}

/** Print the checks. Returns how many need attention. */
export function reportChecks(checks, log = console.log) {
  let bad = 0;
  for (const { name, result, fix } of checks) {
    const mark = result.skipped ? 'skipped' : result.ok ? 'ok     ' : 'MISSING';
    log(`  ${mark}  ${name.padEnd(14)} ${result.detail}`);
    if (!result.ok && !result.skipped) { bad++; if (fix) log(`  ${''.padEnd(7)}  ${''.padEnd(14)} fix: ${fix}`); }
  }
  return bad;
}

/** The repository we are in, or null. */
export function currentRepo() {
  const r = run('git', ['rev-parse', '--show-toplevel']).trim();
  return r && !r.startsWith('fatal') ? r : null;
}
