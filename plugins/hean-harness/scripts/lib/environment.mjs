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
import { join } from 'node:path';

export const SUPERPOWERS = 'superpowers@claude-plugins-official';

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

export function checkSuperpowers() {
  if (!present('claude')) {
    const cached = join(homedir(), '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
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
    hit = rows.filter(p => p && p.id === SUPERPOWERS);
  } catch {
    return { ok: false, state: 'unknown', detail: 'the plugin list could not be read' };
  }
  if (hit.length === 0) return { ok: false, state: 'missing', detail: 'not installed' };
  return hit.some(p => p.enabled)
    ? { ok: true, detail: 'installed and enabled' }
    : { ok: false, state: 'disabled', detail: 'installed but switched off' };
}

export function checkJq() {
  return present('jq')
    ? { ok: true, detail: 'installed' }
    : { ok: false, detail: 'not installed, so the status line prints nothing' };
}

export function javaFix() {
  if (platform() !== 'darwin') return "sudo apt install openjdk-17-jdk    (or your distribution's equivalent)";
  return present('brew') ? 'brew install --cask zulu@17' : 'install a JDK 11 or newer from http://sfdc.co/openjdk';
}

export function jqFix() {
  return platform() === 'darwin' ? 'brew install jq' : 'sudo apt install jq';
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

/** Every check, in report order, with the command that fixes each one. */
export function allChecks(repo) {
  const sp = checkSuperpowers();
  return [
    { name: 'Java',          result: checkJava(),             fix: javaFix() },
    { name: 'sf CLI',        result: checkSfCli(),            fix: sfCliFix },
    { name: 'code analyzer', result: checkCodeAnalyzer(),     fix: analyzerFix },
    { name: 'node modules',  result: checkNodeModules(repo),  fix: nodeModulesFix },
    { name: 'superpowers',   result: sp,
      fix: sp.state === 'disabled' ? `claude plugin enable ${SUPERPOWERS}`
                                   : `claude plugin install ${SUPERPOWERS}` },
    { name: 'jq',            result: checkJq(),               fix: jqFix() }
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
