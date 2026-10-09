/**
 * Which pre and post steps a repository's deploy.yml lists, and which step a
 * runbook or destructive-changes path needs.
 *
 * The shared Jenkins library runs only the steps deploy.yml lists, and client
 * repositories list different ones. A file under a stage folder whose step is
 * missing is never deployed, and nothing reports it: a hand deploy of the
 * same file passes. The commit gate (hooks/runbook-stage-gate.mjs) and the
 * write-time warning (hooks/runbook-compile-check.mjs) share this answer.
 *
 * deploy.yml has one fixed shape, so a small parser reads it rather than a
 * YAML dependency: top-level stage keys, two-space nested keys, scalar values
 * with or without quotes, and `- key: value` list items with continuation
 * keys. A line outside that shape makes the file unreadable, and every caller
 * then lets the work through with a "!!" line: a guessed step list would
 * refuse commits the pipeline deploys.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export const DEPLOY_YML = 'deploy.yml';

/** The two keys repositories use for the commands-file step. */
export const COMMAND_KEYS = ['runSFCommandFromFile', 'runSFDXCommandFromFile'];

const CAP = { pre: 'Pre', post: 'Post' };

// per step kind: the value deploy.yml must hold, the keys that can hold it, and what Jenkins does with the file
const STEPS = {
  metadata: { value: s => `runbooks/${s}-deploy/metaData`, keys: s => [`${s}.metadata[].sourceFolder`], verb: 'deploys' },
  apex: { value: s => `runbooks/${s}-deploy/apex`, keys: s => [`${s}.runAnonymousScriptFromDir`], verb: 'runs' },
  commands: { value: s => `runbooks/${s}-deploy/sf/commands.txt`, keys: s => COMMAND_KEYS.map(k => `${s}.${k}`), verb: 'runs' },
  destruct: { value: s => `deletePackage/${s}/destructiveChanges${CAP[s]}.xml`, keys: s => [`${s}.metadata-destruct[].destructiveChangesXml`], verb: 'applies' }
};

/** A path as deploy.yml may write it, compared without a leading ./ or a trailing /. */
const norm = p => String(p ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');

/** A scalar value: quotes removed, or, unquoted, a trailing " # comment" removed. */
function scalar(raw) {
  const v = raw.trim();
  const quoted = /^(["'])(.*?)\1\s*(?:#.*)?$/.exec(v);
  return quoted ? quoted[2] : v.replace(/\s+#.*$/, '');
}

const isBlank = raw => raw.trim() === '' || raw.trim().startsWith('#');

/**
 * deploy.yml's text as { stage: { key: string | Array<object> } }. Throws,
 * naming the line, on a line outside the fixed shape, and when it names no stage or neither `pre` nor `post`.
 */
export function parseDeploySteps(text) {
  const out = {};
  let top = null, key = null, item = null;
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (isBlank(line)) return;
    const fail = () => { throw new Error(`line ${i + 1} is not in the shape deploy.yml uses: ${JSON.stringify(line.trim())}`); };
    let m;
    if ((m = /^([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!isBlank(m[2])) fail();
      top = m[1]; out[top] = {}; key = null; item = null;
      return;
    }
    if ((m = /^ {2}([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!top) fail();
      key = m[1]; item = null;
      out[top][key] = isBlank(m[2]) ? [] : scalar(m[2]);
      return;
    }
    if ((m = /^ {4}- ([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!top || !key || !Array.isArray(out[top][key])) fail();
      item = { [m[1]]: scalar(m[2]) };
      out[top][key].push(item);
      return;
    }
    if ((m = /^ {6}([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!item) fail();
      item[m[1]] = scalar(m[2]);
      return;
    }
    fail();
  });
  if (!Object.keys(out).length) throw new Error('it names no stage');
  if (!out.pre && !out.post) throw new Error('it has neither a pre: nor a post: stage');
  return out;
}

/** { steps } from <root>/deploy.yml, { missing: true } when there is none, or { error } when it cannot be read. */
export function readDeploySteps(root) {
  const file = join(root, DEPLOY_YML);
  if (!existsSync(file)) return { missing: true };
  try {
    return { steps: parseDeploySteps(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `${DEPLOY_YML} could not be read (${e.message})` };
  }
}

/** The step one stage needs for one kind of file: { stage, kind, key, value }. */
export const stepFor = (stage, kind) => ({
  stage, kind, key: STEPS[kind].keys(stage).map(k => `\`${k}\``).join(' or '), value: STEPS[kind].value(stage)
});

/**
 * The step a path needs, { stage, kind, key, value, compare }, or null when it
 * needs none. compare says the file's content decides: 'commands' for a
 * commands file, 'members' for a destructive manifest. path is repository-
 * relative, or absolute with repoRoot given.
 */
export function requiredStep(path, repoRoot = null) {
  const rel = (isAbsolute(path) && repoRoot ? relative(repoRoot, path) : path).split(sep).join('/');
  let m = /^runbooks\/(pre|post)-deploy\/(metaData|apex|sf)\/(.+)$/.exec(rel);
  if (m) {
    const [, stage, folder, rest] = m;
    if (folder === 'metaData') return rest.split('/').at(-1) === '.keep' ? null : { ...stepFor(stage, 'metadata'), compare: null };
    if (folder === 'apex') return /^[^/]+\.apex$/.test(rest) ? { ...stepFor(stage, 'apex'), compare: null } : null;
    return { ...stepFor(stage, 'commands'), compare: rest === 'commands.txt' ? 'commands' : null };
  }
  m = /^deletePackage\/(pre|post)\/destructiveChanges(Pre|Post)\.xml$/.exec(rel);
  if (m && CAP[m[1]] === m[2]) return { ...stepFor(m[1], 'destruct'), compare: 'members' };
  return null;
}

/** Whether deploy.yml lists the step req names. */
export function stepPresent(steps, req) {
  const stage = steps?.[req.stage] ?? {};
  const list = k => (Array.isArray(stage[k]) ? stage[k] : []);
  const one = k => (typeof stage[k] === 'string' ? norm(stage[k]) : null);
  if (req.kind === 'metadata') return list('metadata').some(i => norm(i.sourceFolder) === req.value);
  if (req.kind === 'apex') return one('runAnonymousScriptFromDir') === req.value;
  if (req.kind === 'commands') return COMMAND_KEYS.some(k => one(k) === req.value);
  return list('metadata-destruct').some(i => norm(i.destructiveChangesXml) === req.value);
}

/** The lines of a commands file that run something: not blank, not a # comment, not the `version` placeholder. */
export const commandLines = text => String(text ?? '').split(/\r?\n/).map(l => l.trim())
  .filter(l => l && !l.startsWith('#') && l !== 'version');

/** Whether next has a command line old lacks. */
export function addsCommand(next, old) {
  const had = new Set(commandLines(old));
  return commandLines(next).some(l => !had.has(l));
}

/** The Type:member pairs a destructive manifest lists. */
export function memberPairs(xml) {
  const pairs = new Set();
  for (const [, body] of String(xml ?? '').matchAll(/<types>([\s\S]*?)<\/types>/g)) {
    const name = /<name>\s*([^<]*?)\s*<\/name>/.exec(body)?.[1] ?? '';
    for (const [, member] of body.matchAll(/<members>\s*([^<]*?)\s*<\/members>/g)) pairs.add(`${name}:${member}`);
  }
  return pairs;
}

/** The Type:member pairs next lists and old does not. */
export function addedMembers(next, old) {
  const had = memberPairs(old);
  return [...memberPairs(next)].filter(p => !had.has(p));
}

/** One line naming the path, the missing key and, when it has the step, the other stage. */
export function missingStepLine(rel, req, steps) {
  const other = req.stage === 'pre' ? 'post' : 'pre';
  const elsewhere = stepPresent(steps, stepFor(other, req.kind)) ? ` \`${other}\` runs this step; \`${req.stage}\` does not.` : '';
  return `${rel}: deploy.yml has no ${req.key} for ${req.value}, so Jenkins never ${STEPS[req.kind].verb} it.${elsewhere}`;
}

/**
 * The missing-step line for one path, or null when it needs no step, its step
 * is listed, or it adds nothing that runs. content(rel) and head(rel) give the
 * file as written or committed and as HEAD has it (null when absent); they are
 * read only for a commands file or a destructive manifest, whose placeholders
 * every repository carries.
 */
export function missingStep(rel, steps, { content, head }) {
  const req = requiredStep(rel);
  if (!req || stepPresent(steps, req)) return null;
  if (req.compare === 'commands' && !addsCommand(content(rel), head(rel))) return null;
  if (req.compare === 'members' && !addedMembers(content(rel), head(rel)).length) return null;
  return missingStepLine(rel, req, steps);
}
