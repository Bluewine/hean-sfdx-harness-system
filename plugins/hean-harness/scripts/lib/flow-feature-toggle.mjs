/**
 * Checks that a commit adds no Get Records read of a feature toggle that
 * breaks the "Feature toggles in flows" rule. Outside a record-triggered
 * before-save flow, a toggle is read with an action call to
 * FeatureToggleInvocableAction, because a flow that runs as the user cannot
 * query Feature_Toggle__mdt or Child_Feature_Toggle__mdt when access to custom
 * metadata types is restricted. A before-save flow cannot call actions, so it
 * keeps at most one Get Records per toggle type.
 *
 * Only a read added or changed in the commit counts, so flows already in the
 * repository are never blocked for what they hold. The rule applies only when
 * the saved development org has the toggle package; packageInstalled() learns
 * that from two read-only Tooling API queries and caches the answer for 7 days.
 *
 * Shared by the Claude Code hook and the git pre-commit hook. Setup copies this
 * file to <config>/hean-harness/hooks/scripts/lib/ with the files
 * install-manifest-check.mjs lists, so this file imports only node built-ins
 * and files in that list. Besides the files the Collection Filter check
 * already needs, it imports scripts/lib/org-roles.mjs (readRoles). --git-hook runs it as git's
 * pre-commit hook and reads only the cached package answer, never the org.
 *
 * Flow XML is read with regular expressions, not a parser, as
 * flow-collection-filter.mjs does.
 *
 * When the check cannot run the commit goes through with a "!!" line naming
 * the reason; a commit refused because a tool is missing blocks all work.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { tryGit } from './command-line.mjs';
import { MAX_BUFFER } from './merge-base.mjs';
import { operationInProgress } from './manifest-check.mjs';
import { claudePath, isSfdxRepo } from './paths.mjs';
import { readRoles } from './org-roles.mjs';

const FLOW_FILE = /\.flow-meta\.xml$/;
const TOGGLE_OBJECTS = new Set(['Feature_Toggle__mdt', 'Child_Feature_Toggle__mdt']);
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// Both queries share this budget, so a slow org stays under the 30 s hook timeout
const QUERY_BUDGET_MS = 25_000;
const CLASS_QUERY = "SELECT Id FROM ApexClass WHERE Name = 'FeatureToggleInvocableAction'";
const TYPE_QUERY = "SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName = 'Feature_Toggle__mdt'";

const tag = (xml, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1].trim() ?? null;

/** Whether a path is a flow file, in any folder. */
export const isFlowFile = path => FLOW_FILE.test(path);

/** Every <recordLookups> block of this flow XML on a toggle type: { name, object, block }. */
function toggleReads(xml) {
  const reads = [];
  for (const [block] of (xml ?? '').matchAll(/<recordLookups>[\s\S]*?<\/recordLookups>/g)) {
    const object = tag(block, 'object');
    if (TOGGLE_OBJECTS.has(object)) reads.push({ name: tag(block, 'name') ?? '', object, block: block.trim() });
  }
  return reads;
}

/**
 * Every toggle read this commit adds or changes that breaks the rule:
 * { path, element, object, kind }, kind being 'use-action' (any flow that is
 * not record-triggered before-save) or 'one-per-type' (a counted read that is
 * not the first on its toggle type in a before-save flow).
 */
export function toggleFindings(xml, headXml, path) {
  const reads = toggleReads(xml);
  if (!reads.length) return [];
  const before = new Map(toggleReads(headXml).map(r => [r.name, r.block]));
  const counted = new Set(reads.filter(r => before.get(r.name) !== r.block));
  const isBeforeSave = tag(/<start>[\s\S]*?<\/start>/.exec(xml)?.[0] ?? '', 'triggerType') === 'RecordBeforeSave';
  const finding = (r, kind) => ({ path, element: r.name, object: r.object, kind });

  if (!isBeforeSave) return reads.filter(r => counted.has(r)).map(r => finding(r, 'use-action'));

  const findings = [];
  for (const object of TOGGLE_OBJECTS) {
    const sameType = reads.filter(r => r.object === object);
    if (sameType.length < 2) continue;
    // The one allowed read is one already in HEAD; Salesforce sorts elements by name, so file position says nothing
    const added = sameType.filter(r => counted.has(r));
    const allowed = added.length < sameType.length ? 0 : 1;
    added.slice(allowed).forEach(r => findings.push(finding(r, 'one-per-type')));
  }
  return findings;
}

/** The refusal for a commit that adds these findings. */
export function refusalText(findings) {
  const lines = findings.map(f => `    ${f.path}: ${f.element}: ` + (f.kind === 'one-per-type'
    ? `a second Get Records on ${f.object} in a before-save flow`
    : `Get Records on ${f.object} outside a before-save flow`));
  return '!! This commit adds Get Records reads of feature toggles that break the flow rule "Feature toggles in flows":\n\n' +
         `${lines.join('\n')}\n\n` +
         'Outside a record-triggered before-save flow, read a toggle with an action call to FeatureToggleInvocableAction ' +
         '(parentToggleLabel, plus childToggleLabel for a child toggle) and treat a null isActive as off: ' +
         'a flow that runs as the user cannot query the toggle types when custom metadata access is restricted. ' +
         'A before-save flow cannot call actions, so it keeps at most one Get Records per toggle type. Then retry the commit.';
}

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The feature toggle check did not run: ${String(reason).replace(/\.$/, '')}.`;

/** Rows of one read-only Tooling API query against this org alias. Throws when the CLI or the org call fails. */
function toolingQuery(alias, soql, timeoutMs = QUERY_BUDGET_MS) {
  const run = spawnSync('sf', ['data', 'query', '--use-tooling-api', '--query', soql, '--json', '-o', alias],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  if (run.error) throw new Error(`sf data query did not finish for ${alias}: ${run.error.message}`);
  let json = null;
  try { json = JSON.parse(run.stdout); } catch { /* reported below */ }
  if (run.status !== 0 || !Array.isArray(json?.result?.records)) {
    throw new Error(`sf data query failed for ${alias}: ${json?.message ?? (String(run.stderr).trim() || `exit ${run.status}`)}`);
  }
  return json.result.records;
}

/**
 * Whether the saved development deploy target has the toggle package (the
 * FeatureToggleInvocableAction class and the Feature_Toggle__mdt type).
 * Returns { known: true, installed } or { known: false, reason }.
 * A cached answer younger than 7 days is used. Otherwise the org is queried
 * through opts.query(alias, soql, timeoutMs) -> rows (both queries share
 * opts.budgetMs, 25 s by default), unless opts.cachedOnly is set. A
 * failed query writes no cache.
 */
export function packageInstalled(root, { query = toolingQuery, now = Date.now(), cacheDir = claudePath('hean-harness', 'feature-toggle-package'), cachedOnly = false, budgetMs = QUERY_BUDGET_MS } = {}) {
  // The same pick as deployEntry in runbook-compile.mjs: the development org saved with deploy allowed
  const found = Object.entries(readRoles(root)).find(([, r]) => r?.role === 'development' && r.deploy === true);
  if (!found) return { known: false, reason: 'no development deploy target is saved for this project' };
  const [orgId, entry] = found;
  const alias = entry.username ?? entry.alias;
  if (!alias) return { known: false, reason: 'the saved development deploy target has no org ID or alias' };

  const file = join(cacheDir, `${orgId}.json`);
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof cached.installed === 'boolean' && now - cached.checkedAt >= 0 && now - cached.checkedAt < CACHE_MAX_AGE_MS) {
      return { known: true, installed: cached.installed };
    }
  } catch { /* no usable cache */ }
  if (cachedOnly) return { known: false, reason: `no recent cached answer for ${alias}` };

  // One deadline for both queries: each gets the time left, and none left means the org did not answer
  const deadline = performance.now() + budgetMs;
  const ask = soql => {
    const left = Math.floor(deadline - performance.now());
    if (left <= 0) throw new Error('the org did not answer in time');
    return query(alias, soql, left);
  };
  let installed;
  try {
    installed = ask(CLASS_QUERY).length > 0 && ask(TYPE_QUERY).length > 0;
  } catch (e) {
    return { known: false, reason: e.message };
  }
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ installed, checkedAt: now }));
  } catch { /* the answer is still good for this run */ }
  return { known: true, installed };
}

/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records, so the staged flows are read from it and compared with HEAD. Exit 3
 * refuses the commit, and the shell hook turns it into git's 1; any other code
 * lets the commit through. Every message goes to standard error, which git
 * shows. The org is never called: only a cached "installed" answer refuses.
 */
if (process.argv[1] && basename(process.argv[1]) === 'flow-feature-toggle.mjs' && process.argv.includes('--git-hook')) {
  try {
    // git names the index relative to the top of the working tree, where it starts the hook; the calls below use -C
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    const root = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
    if (!root) throw new Error('the current folder is not in a git repository');
    if (!isSfdxRepo(root) || operationInProgress(root)) process.exit(0);
    const list = spawnSync('git', ['-C', root, 'diff', '--cached', '--name-only', '--diff-filter=d', '-z'],
                           { encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (list.status !== 0) throw new Error(`git could not list the staged files (${list.stderr.trim() || `exit ${list.status}`})`);
    const findings = [];
    for (const rel of list.stdout.split('\0').filter(isFlowFile)) {
      const blob = spawnSync('git', ['-C', root, 'show', `:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      if (blob.status !== 0) throw new Error(`git could not read ${rel} from the index`);
      const head = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      findings.push(...toggleFindings(blob.stdout, head.status === 0 ? head.stdout : null, rel));
    }
    if (!findings.length) process.exit(0);
    const pkg = packageInstalled(root, { cachedOnly: true });
    if (!pkg.known || !pkg.installed) process.exit(0);
    process.stderr.write(`${refusalText(findings)}\n`);
    process.exit(3);
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    process.exit(0);
  }
}
