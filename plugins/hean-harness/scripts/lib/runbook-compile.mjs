/**
 * Compiles a runbook Apex script the way the Jenkins pipeline does, without
 * running it.
 *
 * The pipeline runs each runbooks/<stage>-deploy/apex/*.apex script with
 * conn.tooling.executeAnonymous() from @store-sfdcbt-net/CICD_node-run-list-exec-lib,
 * on a jsforce connection the CICD_node-jsforce-util copy that runner loads
 * (usually its own nested copy) creates without an API version. jsforce's own default then applies, and it is older than the
 * version metadata deploys use. A script that references a field or type newer
 * than that default passes `sf apex run` locally and fails to compile in
 * Jenkins.
 *
 * So the version is read from the jsforce copy that chain loads, resolved the
 * way Node resolves it from the repository's own node_modules, never assumed. When it cannot be read, the
 * check is skipped with a warning rather than run at a guessed version.
 *
 * The compile goes through `sf apex run --api-version <pipeline version>`.
 * The CLI authenticates itself, so no access token is read or passed on (the
 * CLI redacts it from `sf org display`).
 *
 * The script is compiled behind `if (true) { return; } else {}`: anonymous Apex
 * compiles the whole block before running any of it, so the compile result is
 * the script's, and the guard keeps anything after the first line from running.
 * The empty else keeps a script that starts with `else` from attaching to the guard.
 *
 * Jenkins deploys a stage's runbooks/<stage>-deploy/metaData/ folder before it
 * runs the stage's apex/ scripts, so a script may call a runbook class the org
 * does not hold yet. When a compile problem names a class whose .cls and
 * .cls-meta.xml are in the script's own stage folder (stageClass), deployClass
 * deploys those two files to the same org with `sf project deploy start
 * --metadata-dir`, which takes a folder outside the project's packageDirectories.
 * No other call is made to the org.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { claudeDir } from './paths.mjs';
import { readRoles, SKILL } from './org-roles.mjs';

export const RUNNER_PACKAGE = '@store-sfdcbt-net/CICD_node-run-list-exec-lib';
export const PIPELINE_PACKAGE = '@store-sfdcbt-net/CICD_node-jsforce-util';

/** Repository-relative paths of the scripts the pipeline runs as anonymous Apex. */
export const RUNBOOK_SCRIPT = /^runbooks\/(pre|post)-deploy\/apex\/[^/]+\.apex$/;

/** Compile problems that mean the element is newer than the pipeline's API version. */
export const VERSION_GAP_PROBLEMS = ['No such column', 'Invalid type', 'Variable does not exist', 'Method does not exist'];

export const GUARD = 'if (true) { return; } else {}\n';

/** How long one `sf apex run` and one `sf project deploy start` may take before they are killed. */
export const COMPILE_TIMEOUT_MS = 45000;
export const DEPLOY_TIMEOUT_MS = 90000;

export const isVersionGap = problem => VERSION_GAP_PROBLEMS.some(p => String(problem ?? '').includes(p));

export const sha1 = data => createHash('sha1').update(data).digest('hex');

/**
 * The folder of a package as Node resolves it from dir: dir's own
 * node_modules first, then each parent's. null when no copy is found.
 */
export function packageDir(name, dir) {
  for (let cur = dir; ; cur = dirname(cur)) {
    const candidate = join(cur, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(cur) === cur) return null;
  }
}

/** The default API version a jsforce copy's connection module declares, or throws when its shape is unknown. */
function jsforceDefaultVersion(jsforceDir) {
  const file = join(jsforceDir, 'lib', 'connection.js');
  if (!existsSync(file)) throw new Error(`${file} does not exist, so this jsforce's default API version cannot be read`);
  const found = new Set([...readFileSync(file, 'utf8').matchAll(/\bversion\s*:\s*["'](\d+\.\d+)["']/g)].map(m => m[1]));
  if (found.size !== 1) {
    throw new Error(`${file} does not declare exactly one default API version ` +
                    `(found ${found.size ? [...found].join(', ') : 'none'}), so its shape is unknown`);
  }
  return [...found][0];
}

/**
 * The API version the pipeline's anonymous Apex runs at: { version, source,
 * jsforceDir }, or { error } when node_modules, either package, or the
 * version cannot be read.
 */
export function pipelineApiVersion(repoRoot) {
  const runner = packageDir(RUNNER_PACKAGE, repoRoot);
  if (!runner) {
    return { error: existsSync(join(repoRoot, 'node_modules'))
      ? `${RUNNER_PACKAGE} is not installed in ${repoRoot}/node_modules`
      : `${repoRoot} has no node_modules folder` };
  }
  const util = packageDir(PIPELINE_PACKAGE, runner) ?? packageDir(PIPELINE_PACKAGE, repoRoot);
  if (!util) return { error: `${PIPELINE_PACKAGE} is not installed where ${RUNNER_PACKAGE} loads it from (${runner})` };
  const jsforceDir = packageDir('jsforce', util);
  if (!jsforceDir) return { error: `no jsforce copy is installed where ${PIPELINE_PACKAGE} loads it from (${util})` };
  try {
    const version = jsforceDefaultVersion(jsforceDir);
    const pkg = JSON.parse(readFileSync(join(jsforceDir, 'package.json'), 'utf8'));
    return { version, source: `jsforce ${pkg.version ?? '(unknown version)'} at ${jsforceDir}`, jsforceDir };
  } catch (e) {
    return { error: e.message };
  }
}

/** The saved role entry of the org with role development and deploy allowed, or null. */
export function deployEntry(repoRoot) {
  return Object.values(readRoles(repoRoot)).find(r => r?.role === 'development' && r.deploy === true) ?? null;
}

/**
 * The username (or alias) of the org saved with role development and deploy allowed, or null.
 * deployClass writes only to this org: a role-development org saved with deploy allowed is
 * always one hooks/org-write-gate.mjs lets an agent deploy to.
 */
export function deployTarget(repoRoot) {
  const found = deployEntry(repoRoot);
  return found ? (found.username ?? found.alias ?? null) : null;
}

export const NO_TARGET = `No development deploy target is saved for this project; run ${SKILL} to save one.`;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** What `sf --json` printed, parsed whatever the exit code, or null when it is not JSON. */
function parseCliJson(stdout) {
  const text = String(stdout ?? '').replace(ANSI, '').trim();
  for (const candidate of [text, text.slice(text.indexOf('{'))]) {
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  return null;
}

/**
 * Compile one script against the saved development org at the pipeline's API
 * version, running nothing.
 *
 * Returns { compiled, line, column, problem, version, alias } — line and column point
 * into the original file — or { skipped } when the version or the org is not
 * known. Throws when the CLI or the org call fails.
 */
export async function compileScript({ repoRoot, file, alias }) {
  const pipeline = pipelineApiVersion(repoRoot);
  if (pipeline.error) return { skipped: 'version', reason: pipeline.error };
  const target = alias ?? deployTarget(repoRoot);
  if (!target) return { skipped: 'target', reason: NO_TARGET };

  const source = GUARD + readFileSync(file, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'runbook-compile-'));
  let run;
  try {
    const tmp = join(dir, 'script.apex');
    writeFileSync(tmp, source);
    run = spawnSync('sf', ['apex', 'run', '--file', tmp, '--api-version', pipeline.version, '--target-org', target, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: COMPILE_TIMEOUT_MS, cwd: repoRoot,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (run.error) throw new Error(`sf apex run did not finish for ${target}: ${run.error.message}`);

  // A compile failure exits non-zero and still prints JSON, with the result under `data`.
  const json = parseCliJson(run.stdout);
  const body = [json?.result, json?.data].find(b => b && typeof b === 'object' && typeof b.compiled === 'boolean');
  if (!body) {
    const said = json?.message ?? String(run.stderr || run.stdout || '').replace(ANSI, '').trim();
    throw new Error(`sf apex run gave no compile result for ${target}: ${said || `exit ${run.status}`}`);
  }

  const at = n => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null);
  const rawLine = at(body.line);
  return {
    compiled: body.compiled === true,
    line: rawLine === null ? null : Math.max(1, rawLine - 1),
    column: at(body.column),
    problem: body.compileProblem || null,
    version: pipeline.version,
    alias: target
  };
}

/** Compile problems that can name a class the org does not hold, and the name they give. */
const CLASS_NAMED = [/Variable does not exist: ([A-Za-z]\w*)/g, /Invalid type: ([A-Za-z]\w*)/g, /from the type ([A-Za-z]\w*)/g];

/**
 * The runbook class a compile problem names that sits in the script's own stage
 * folder, runbooks/<stage>-deploy/metaData/classes/, with its -meta.xml:
 * { name, folder, cls, meta } with name as the file spells it and folder
 * repository-relative, or null. Apex names ignore case, so the file name does too.
 */
export function stageClass(repoRoot, rel, problem) {
  const stage = String(rel).match(RUNBOOK_SCRIPT)?.[1];
  if (!stage || !problem) return null;
  const folder = `runbooks/${stage}-deploy/metaData/classes/`;
  let files;
  try { files = readdirSync(join(repoRoot, folder)); } catch { return null; }
  for (const named of CLASS_NAMED.flatMap(p => [...String(problem).matchAll(p)].map(m => m[1].toLowerCase()))) {
    const cls = files.find(f => f.toLowerCase() === `${named}.cls`);
    if (!cls || !files.includes(`${cls}-meta.xml`)) continue;
    const name = cls.slice(0, -'.cls'.length);
    return { name, folder, cls: join(repoRoot, folder, cls), meta: join(repoRoot, folder, `${cls}-meta.xml`) };
  }
  return null;
}

/** What a failed `sf project deploy start --json` says went wrong. */
function deployProblem(json, run) {
  const failures = [json?.result?.details?.componentFailures ?? []].flat()
    .map(f => `${f.fullName ?? f.fileName ?? '?'}${f.lineNumber ? ` line ${f.lineNumber}` : ''}: ${f.problem}`);
  if (failures.length) return failures.join('; ');
  return json?.message ?? json?.result?.errorMessage ?? (String(run.stderr || run.stdout || '').replace(ANSI, '').trim() || `exit ${run.status}`);
}

/**
 * Deploy one runbook class from stageClass to alias, the org compileScript
 * compiled against: { deployed: true } or { error }. The class goes up as a
 * metadata-format folder (package.xml and classes/), the shape the stage's
 * metadata step converts the folder to.
 */
export function deployClass({ repoRoot, name, cls, meta, alias }) {
  const dir = mkdtempSync(join(tmpdir(), 'runbook-class-'));
  let run;
  try {
    mkdirSync(join(dir, 'classes'));
    copyFileSync(cls, join(dir, 'classes', `${name}.cls`));
    copyFileSync(meta, join(dir, 'classes', `${name}.cls-meta.xml`));
    const version = readFileSync(meta, 'utf8').match(/<apiVersion>\s*([\d.]+)\s*<\/apiVersion>/)?.[1];
    writeFileSync(join(dir, 'package.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
      `    <types>\n        <members>${name}</members>\n        <name>ApexClass</name>\n    </types>\n` +
      (version ? `    <version>${version}</version>\n` : '') + '</Package>\n');
    // --wait 1 ends the CLI before the 90 s kill, so an unfinished deploy still prints JSON
    run = spawnSync('sf', ['project', 'deploy', 'start', '--metadata-dir', dir, '--target-org', alias,
      '--test-level', 'NoTestRun', '--wait', '1', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: DEPLOY_TIMEOUT_MS, cwd: repoRoot,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  } catch (e) {
    return { error: e.message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (run.error) return { error: `sf project deploy start did not finish: ${run.error.message}` };
  const json = parseCliJson(run.stdout);
  if (run.status === 0 && json?.result?.status === 'Succeeded') return { deployed: true };
  return { error: deployProblem(json, run) };
}

/** Where this repository's compile record lives. */
export const stateDirFor = repoRoot =>
  join(claudeDir(), 'hean-harness', 'runbook-compile', sha1(repoRoot).slice(0, 12));

const recordFile = repoRoot => join(stateDirFor(repoRoot), 'compiled.json');

/** Script path -> { oid, version }: the git object id of the content that last compiled, and its API version. */
export function readRecord(repoRoot) {
  try {
    const json = JSON.parse(readFileSync(recordFile(repoRoot), 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch { return {}; }
}

export function recordCompiled(repoRoot, relPath, oid, version) {
  const record = readRecord(repoRoot);
  record[relPath] = { oid, version };
  mkdirSync(stateDirFor(repoRoot), { recursive: true });
  writeFileSync(recordFile(repoRoot), JSON.stringify(record, null, 2) + '\n');
}

/**
 * Whether this content of the script compiled. When the pipeline version can
 * be read now, the record must be for that version too. Object ids, not raw
 * file hashes, so the working tree and the index agree under line-ending filters.
 */
export function isRecorded(record, relPath, oid, currentVersion) {
  const r = record[relPath];
  return !!r && r.oid === oid && (!currentVersion || r.version === currentVersion);
}
