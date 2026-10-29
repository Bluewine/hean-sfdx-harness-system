/**
 * Lints LWC and Aura JavaScript, HTML and CSS files with `sf code-analyzer`
 * the way the Jenkins pipeline does, for the writing-time hook and the commit
 * and push gate.
 *
 * The pipeline makes two ESLint runs: `-r eslint` on JavaScript with the
 * repository's eslint.config.js and every bundled layer off, and
 * `-r eslint:slds` on HTML and CSS with the bundled lwc and slds layers on and
 * no project config. The configurations generated here copy the ones the
 * pipeline's config-file-service.js writes. Every other engine is disabled:
 * without a JDK, pmd, cpd and sfge each record a Critical violation attached
 * to no file.
 *
 * The check fails closed. A config that does not load gives the same exit
 * code and the same empty list as clean code, so before a `clean` result
 * counts, `sf code-analyzer rules` must list at least one rule for a file of
 * each proof family (js-lwc, js-aura, slds) with the same generated config. A
 * project config may name `files` patterns for lwc and not aura, so one
 * family's proof never stands in for another's. Anything else that is not a
 * proven clean result or a list of findings is `could-not-run`.
 *
 * Targets are always single files: a whole-tree target crashes the analyzer on
 * no-irregular-whitespace. ESLint is never called directly; a repository's own
 * ESLint 8 cannot load an ESLint 9 flat config that registers a plugin twice,
 * and the analyzer bundles ESLint 9.
 *
 * Nothing runs at import: the hooks load this module with a dynamic import().
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { claudeDir, isSfdxRepo } from './paths.mjs';
import { git, resolveMergeBase } from './merge-base.mjs';

/** Root-relative paths the check covers, matching the pipeline's force-app target and its SLDS patterns. */
export const IN_SCOPE = /^force-app\/(?:.*\/)?(?:lwc|aura)\/.+\.(?:js|html|css)$/;

export const THRESHOLD = 3;
/** The version of the generated configuration (configFor, THRESHOLD, OTHER_ENGINES); raise it when any of them changes, so older clean records stop matching. */
export const CONFIG_SCHEMA = 1;
export const PLUGIN = '@salesforce/plugin-code-analyzer';
export const INSTALL = `sf plugins install ${PLUGIN}`;
export const WORK_ORDER = 'Fix these findings now, before any other step. Do not ask the user whether to start.';
export const PRE_EXISTING_HEADING = 'Pre-existing (in the file before this branch):';
export const PRE_EXISTING_TEXT = 'Change only what removes the finding, and keep the functionality, behavior and output exactly as before. ' +
  'If a finding cannot be fixed that way, leave it, and tell the user which finding and why; the commit stays refused until the user decides.';

const SELECTOR = { js: 'eslint', slds: 'eslint:slds' };
const OTHER_ENGINES = ['pmd', 'cpd', 'sfge', 'regex', 'retire-js', 'flow'];
const RULE_NOTES = { '@lwc/lwc/no-async-operation': '`lwc-conventions.md` section 4' };
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

const sha1 = data => createHash('sha1').update(data).digest('hex');
const toPosix = p => p.split(sep).join('/');

export const kindOf = rel => (rel.endsWith('.js') ? 'js' : 'slds');

/** The proof family: .js files split by the nearest bundle folder, lwc or aura. */
export function familyOf(rel) {
  if (kindOf(rel) === 'slds') return 'slds';
  const bundle = rel.split('/').slice(0, -1).findLast(s => s === 'lwc' || s === 'aura');
  return bundle === 'aura' ? 'js-aura' : 'js-lwc';
}

/** Whether the check applies to this repository; note is the line to show when it does not, or null for silence. */
export function applies(root) {
  if (!isSfdxRepo(root)) return { ok: false, note: null };
  if (!existsSync(join(root, 'eslint.config.js')))
    return { ok: false, note: `!! The code analyzer check does not apply: ${root} has no eslint.config.js.` };
  return { ok: true };
}

/** Where this repository's clean record and session files live. */
export const stateDirFor = root => join(claudeDir(), 'hean-harness', 'lwc-code-analyzer', sha1(root).slice(0, 12));

const sessionFile = (root, sessionId) =>
  join(stateDirFor(root), `session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

function readSession(root, sessionId) {
  try {
    const json = JSON.parse(readFileSync(sessionFile(root, sessionId), 'utf8'));
    return { analyzerVersion: json.analyzerVersion ?? null, provenKeys: Array.isArray(json.provenKeys) ? json.provenKeys : [] };
  } catch { return { analyzerVersion: null, provenKeys: [] }; }
}

function writeSession(root, sessionId, data) {
  mkdirSync(stateDirFor(root), { recursive: true });
  writeFileSync(sessionFile(root, sessionId), JSON.stringify(data, null, 2) + '\n');
}

/** The code analyzer plugin's version from `sf plugins --json` output, or null. */
function versionFrom(stdout) {
  try {
    const json = JSON.parse(String(stdout ?? '').replace(ANSI, '').trim());
    const list = Array.isArray(json) ? json : json?.result;
    return list?.find(p => p?.name === PLUGIN)?.version ?? null;
  } catch { return null; }
}

const readOr = (file, fallback) => { try { return readFileSync(file, 'utf8'); } catch { return fallback; } };

const keyFrom = (root, version) => sha1([
  `schema ${CONFIG_SCHEMA}`,
  readOr(join(root, 'eslint.config.js'), 'none'),
  readOr(join(root, 'node_modules', '.package-lock.json'), 'none'),
  version
].join('\0'));

/**
 * The clean record key: the generated configuration's CONFIG_SCHEMA,
 * eslint.config.js, the installed package tree (the config's packages are
 * pinned to latest, so a reinstall can change the rules without changing
 * eslint.config.js) and the analyzer version. The version is
 * cached in the session file. When it cannot be read the key matches no record.
 * Synchronous for the hooks, so the version lookup uses spawnSync with a timeout.
 */
export function recordKey(root, sessionId) {
  const saved = readSession(root, sessionId);
  if (saved.analyzerVersion) return keyFrom(root, saved.analyzerVersion);
  const run = spawnSync('sf', ['plugins', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  const version = run.error ? null : versionFrom(run.stdout);
  if (!version) return keyFrom(root, `unknown:${randomUUID()}`);
  writeSession(root, sessionId, { ...saved, analyzerVersion: version });
  return keyFrom(root, version);
}

const recordFile = root => join(stateDirFor(root), 'clean.json');

function readRecord(root) {
  try {
    const json = JSON.parse(readFileSync(recordFile(root), 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch { return {}; }
}

/** Whether this content (git object id) of the file was found clean under this key. */
export function isRecordedClean(root, rel, oid, key) {
  const r = readRecord(root)[rel];
  return !!r && r.oid === oid && r.key === key;
}

export function recordClean(root, rel, oid, key) {
  const record = readRecord(root);
  record[rel] = { oid, key };
  mkdirSync(stateDirFor(root), { recursive: true });
  writeFileSync(recordFile(root), JSON.stringify(record, null, 2) + '\n');
}

/** The generated code-analyzer.yml for one run kind, copying the pipeline's configuration. */
function configFor(root, kind) {
  const js = kind === 'js';
  return [
    'engines:',
    '  eslint:',
    '    auto_discover_eslint_config: false',
    ...(js ? [`    eslint_config_file: ${JSON.stringify(join(root, 'eslint.config.js'))}`] : []),
    '    disable_javascript_base_config: true',
    `    disable_lwc_base_config: ${js}`,
    `    disable_slds_base_config: ${js}`,
    '    disable_typescript_base_config: true',
    '    disable_react_base_config: true',
    ...OTHER_ENGINES.flatMap(e => [`  ${e}:`, '    disable_engine: true']),
    ''
  ].join('\n');
}

/**
 * Runs sf in the repository root, killed at the deadline. Resolves
 * { code, stdout, stderr }, { error } when sf cannot start, or { timedOut }.
 * The process gets its own group so the kill also stops what sf started.
 */
function runSf(root, args, deadline) {
  return new Promise(done => {
    const ms = deadline - Date.now();
    if (ms <= 0) return done({ timedOut: true });
    let stdout = '', stderr = '', finished = false;
    const finish = result => { if (!finished) { finished = true; clearTimeout(timer); done(result); } };
    const child = spawn('sf', args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({ timedOut: true });
    }, ms);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => finish({ error }));
    child.on('close', code => finish({ code, stdout, stderr }));
  });
}

const tail = text => String(text ?? '').replace(ANSI, '').trim().split('\n').slice(-5).join('\n');

/** The could-not-run reason for a spawn that did not finish, or null when it did. */
function spawnProblem(result, what) {
  if (result.timedOut) return `the deadline passed while \`${what}\` was running, so the analyzer was stopped`;
  if (result.error?.code === 'ENOENT') return `\`sf\` is not on PATH. Install the Salesforce CLI, then run \`${INSTALL}\``;
  if (result.error) return `\`${what}\` could not start: ${result.error.message}`;
  return null;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

const couldNot = reason => ({ kind: 'could-not-run', reason });

/** The analyzer version for this session, asked once with the deadline and cached. */
async function sessionVersion(root, sessionId, deadline) {
  const saved = readSession(root, sessionId);
  if (saved.analyzerVersion) return { version: saved.analyzerVersion };
  const result = await runSf(root, ['plugins', '--json'], deadline);
  const problem = spawnProblem(result, 'sf plugins --json');
  if (problem) return { error: problem };
  const version = versionFrom(result.stdout);
  if (!version) return { error: `the code analyzer plugin is not installed; run \`${INSTALL}\`` };
  writeSession(root, sessionId, { ...saved, analyzerVersion: version });
  return { version };
}

/** Proves that the generated config gives this file's family at least one rule; null on success, else the reason. */
async function prove(root, file, kind, cfg, out, deadline) {
  const args = ['code-analyzer', 'rules', '-t', file, '-r', SELECTOR[kind], '-c', cfg, '-f', out];
  rmSync(out, { force: true });
  const result = await runSf(root, args, deadline);
  const problem = spawnProblem(result, `sf code-analyzer rules -r ${SELECTOR[kind]}`);
  if (problem) return problem;
  if (result.code !== 0)
    return `\`sf code-analyzer rules\` exited ${result.code} for ${file}: ${tail(result.stderr || result.stdout) || 'no error text'}`;
  const json = readJson(out);
  if (!Array.isArray(json?.rules))
    return `\`sf code-analyzer rules\` wrote no rule list for ${file}: ${tail(result.stderr || result.stdout) || `exit ${result.code}`}`;
  if (json.rules.length) return null;
  return kind === 'js'
    ? `the project's rules do not apply to ${file}: \`sf code-analyzer rules -r eslint\` lists none for it with eslint.config.js. ` +
      'Check that eslint.config.js loads (run `npm install` in the repository) and that its `files` patterns cover the file'
    : `the analyzer's SLDS rules do not apply to ${file}: \`sf code-analyzer rules -r eslint:slds\` lists none for it`;
}

/** One run of one kind: { findings } or { error }. */
async function runKind(root, files, kind, cfg, out, deadline) {
  const args = ['code-analyzer', 'run', '-w', root, ...files.flatMap(f => ['-t', f]),
    '-r', SELECTOR[kind], '-s', String(THRESHOLD), '-c', cfg, '-f', out];
  const result = await runSf(root, args, deadline);
  const problem = spawnProblem(result, `sf code-analyzer run -r ${SELECTOR[kind]}`);
  if (problem) return { error: problem };
  const json = readJson(out);
  if (!Array.isArray(json?.violations))
    return { error: `\`sf code-analyzer run\` wrote no results: ${tail(result.stderr || result.stdout) || `exit ${result.code}`}` };
  const targets = new Set(files);
  const findings = [];
  for (const v of json.violations) {
    const at = v?.locations?.[0];
    const said = `${v?.rule} (${v?.engine}): ${v?.message}`;
    if (!at?.file) return { error: `the analyzer reported a failure attached to no file, ${said}` };
    const file = toPosix(relative(root, resolve(root, at.file)));
    if (!targets.has(file)) return { error: `the analyzer reported ${file}, which was not a target, ${said}` };
    if (Number(v.severity) <= THRESHOLD)
      findings.push({ file, line: at.startLine, column: at.startColumn, rule: v.rule, severity: v.severity, message: v.message });
  }
  if (result.code !== 0 && !findings.length)
    return { error: `\`sf code-analyzer run\` exited ${result.code} with no finding at severity ${THRESHOLD} or higher: ${tail(result.stderr) || 'no error text'}` };
  return { findings };
}

/**
 * Lints root-relative in-scope files, one run per kind, under one deadline
 * (milliseconds since the epoch). Returns { kind: 'clean' },
 * { kind: 'findings', findings }, or { kind: 'could-not-run', reason }.
 * It records nothing; the caller records clean files by their object ids.
 */
export async function analyze(root, files, { deadline, sessionId }) {
  if (!(deadline > Date.now())) return couldNot('the deadline passed before the analyzer started');
  const tmp = mkdtempSync(join(tmpdir(), 'lwc-code-analyzer-'));
  try {
    const found = await sessionVersion(root, sessionId, deadline);
    if (found.error) return couldNot(found.error);
    const key = keyFrom(root, found.version);
    const findings = [];
    for (const kind of ['js', 'slds']) {
      const ofKind = files.filter(f => kindOf(f) === kind);
      if (!ofKind.length) continue;
      const cfg = join(tmp, `${kind}.yml`);
      writeFileSync(cfg, configFor(root, kind));
      for (const file of ofKind) {
        const family = familyOf(file);
        const proofKey = `${family}:${key}`;
        const session = readSession(root, sessionId);
        if (session.provenKeys.includes(proofKey)) continue;
        const problem = await prove(root, file, kind, cfg, join(tmp, `${family}-rules.json`), deadline);
        if (problem) return couldNot(problem);
        writeSession(root, sessionId, { ...session, provenKeys: [...session.provenKeys, proofKey] });
      }
      const run = await runKind(root, ofKind, kind, cfg, join(tmp, `${kind}.json`), deadline);
      if (run.error) return couldNot(run.error);
      findings.push(...run.findings);
    }
    return findings.length ? { kind: 'findings', findings } : { kind: 'clean' };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The lines of rel that differ from base, or 'all' when base has no such file. */
function changedLines(root, base, rel) {
  if (git(['cat-file', '-e', `${base}:${rel}`], undefined, { cwd: root }).status !== 0) return 'all';
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', base, '--', rel], undefined, { cwd: root }).stdout;
  const lines = new Set();
  for (const [, start, count] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const n = count === undefined ? 1 : Number(count);
    for (let i = 0; i < n; i++) lines.add(Number(start) + i);
  }
  return lines;
}

/**
 * The commit the pushed tips start from on the remote side: the one boundary
 * commit of `<tips> --not --remotes`, or null when there is none (no
 * remote-tracking branch) or more than one (a merge of two remote lines).
 * Also null when the walk passes the deadline (milliseconds since the epoch).
 */
export function pushBase(root, tips, deadline) {
  let out;
  try { out = git(['rev-list', '--boundary', ...tips, '--not', '--remotes'], undefined, { cwd: root, deadline }); } catch { return null; }
  if (out.status !== 0) return null;
  const boundary = new Set(out.stdout.split('\n').filter(l => l.startsWith('-')).map(l => l.slice(1).trim()));
  return boundary.size === 1 ? [...boundary][0] : null;
}

/**
 * Labels each finding new (on a line the branch changed, or in a file the
 * base does not have) or pre-existing. The base is the branch's merge-base.
 * Without one, a commit or write compares with HEAD; a push passes pushBase,
 * the remote side of its commits, because HEAD already holds the commits
 * being pushed and would label their findings pre-existing. A pushBase of
 * null, or no base at all, labels every finding new.
 */
export function labelFindings(root, findings, options = {}) {
  const branch = git(['branch', '--show-current'], undefined, { cwd: root }).stdout.trim();
  let base;
  try { base = resolveMergeBase(undefined, branch, { cwd: root }).sha; } catch { base = 'pushBase' in options ? options.pushBase : 'HEAD'; }
  const byFile = new Map();
  return findings.map(f => {
    if (base === null) return { ...f, preExisting: false };
    if (!byFile.has(f.file)) byFile.set(f.file, changedLines(root, base, f.file));
    const changed = byFile.get(f.file);
    return { ...f, preExisting: changed !== 'all' && !changed.has(f.line) };
  });
}

const findingLine = f => `- ${f.file}:${f.line} ${f.rule} — ${f.message}${RULE_NOTES[f.rule] ? ` (see ${RULE_NOTES[f.rule]})` : ''}`;

/** The body of a block or refusal that lists findings, opening with the work order. */
export function findingsText(labelled) {
  const fresh = labelled.filter(f => !f.preExisting);
  const old = labelled.filter(f => f.preExisting);
  const parts = [WORK_ORDER];
  if (fresh.length) parts.push('', 'New (on lines this branch changed):', ...fresh.map(findingLine));
  if (old.length) parts.push('', PRE_EXISTING_HEADING, PRE_EXISTING_TEXT, ...old.map(findingLine));
  return parts.join('\n');
}

export const couldNotRunText = reason => `!! The code analyzer check could not run: ${reason}`;
