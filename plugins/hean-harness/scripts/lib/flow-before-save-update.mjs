/**
 * Checks that a commit adds no Update Records element on the triggering
 * record to a record-triggered before-save flow, which breaks the rule
 * "Triggering record updates" in flow-conventions.md. A before-save flow sets
 * fields on $Record with an Assignment element and Salesforce saves them
 * without Update Records; that element on the triggering record belongs in an
 * after-save flow. Flow Builder still offers "Use the record that triggered
 * the flow" in a before-save flow, which is why the check exists.
 *
 * An Update Records element counts as updating the triggering record when its
 * inputReference is $Record, or when it updates the object of the flow's
 * <start> and filters on Id = $Record.Id. Only an element added in the commit
 * counts: one whose <name> HEAD already held as such an update in a before-save
 * flow is never refused, whatever else changed in it (connector, location,
 * whitespace, fields), so flows already in the repository are never blocked
 * for what they hold. A flow whose HEAD copy had another trigger type is
 * treated as new throughout.
 *
 * Shared by the Claude Code hook and the git pre-commit hook. Setup copies this
 * file to <config>/hean-harness/hooks/scripts/lib/ with the files
 * install-manifest-check.mjs lists, so this file imports only node built-ins
 * and files in that list. It needs no org. --git-hook runs it as git's
 * pre-commit hook.
 *
 * Flow XML is read with regular expressions, not a parser, as
 * flow-feature-toggle.mjs does.
 *
 * When the check cannot run the commit goes through with a "!!" line naming
 * the reason; a commit refused because a tool is missing blocks all work.
 */

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

import { MAX_BUFFER } from './merge-base.mjs';
import { repoFacts } from './manifest-check.mjs';
import { isSfdxRepo } from './paths.mjs';

const FLOW_FILE = /\.flow-meta\.xml$/;

const tag = (xml, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1].trim() ?? null;
const startOf = xml => /<start>[\s\S]*?<\/start>/.exec(xml ?? '')?.[0] ?? '';

/** Whether a path is a flow file, in any folder. */
export const isFlowFile = path => FLOW_FILE.test(path);

/** Every <recordUpdates> block of this flow XML that updates the triggering record: { name, block }. */
function triggeringUpdates(xml) {
  const object = tag(startOf(xml), 'object')?.toLowerCase();
  const updates = [];
  for (const [block] of (xml ?? '').matchAll(/<recordUpdates>[\s\S]*?<\/recordUpdates>/g)) {
    const byReference = tag(block, 'inputReference') === '$Record';
    const sameObject = object && tag(block, 'object')?.toLowerCase() === object &&
      [...block.matchAll(/<filters>([\s\S]*?)<\/filters>/g)]
        .some(m => tag(m[1], 'field') === 'Id' && /<elementReference>\$Record\.Id<\/elementReference>/.test(m[1]));
    if (byReference || sameObject) updates.push({ name: tag(block, 'name') ?? '', block: block.trim() });
  }
  return updates;
}

/**
 * Every Update Records element on the triggering record that this commit adds
 * or changes in a record-triggered before-save flow: { path, element }.
 */
export function beforeSaveUpdateFindings(xml, headXml, path) {
  if (tag(startOf(xml), 'triggerType') !== 'RecordBeforeSave') return [];
  const updates = triggeringUpdates(xml);
  if (!updates.length) return [];
  const sameTiming = headXml != null && tag(startOf(headXml), 'triggerType') === 'RecordBeforeSave';
  const held = new Set(sameTiming ? triggeringUpdates(headXml).map(u => u.name) : []);
  return updates.filter(u => !held.has(u.name)).map(u => ({ path, element: u.name }));
}

/** The refusal for a commit that adds these findings. */
export function refusalText(findings) {
  const lines = findings.map(f => `    ${f.path}: ${f.element}`);
  return '!! This commit adds an Update Records element on the triggering record to a record-triggered before-save flow, which breaks the flow rule "Triggering record updates":\n\n' +
         `${lines.join('\n')}\n\n` +
         'Set the fields on $Record with an Assignment element instead: Salesforce saves the changes to $Record in a before-save flow without an Update Records element. ' +
         'An Update Records element on the triggering record belongs in an after-save flow. Then retry the commit.';
}

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The before-save triggering record update check did not run: ${String(reason).replace(/\.$/, '')}.`;

/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records, so the staged flows are read from it and compared with HEAD. Exit 3
 * refuses the commit, and the shell hook turns it into git's 1; any other code
 * lets the commit through. Every message goes to standard error, which git
 * shows.
 *
 * runGitHook() returns that exit code instead of exiting, so
 * pre-commit-checks.mjs can run the five pre-commit checks in one node process;
 * facts, from repoFacts(), are what the checks share instead of each asking git.
 */
export function runGitHook(facts) {
  try {
    // git names the index relative to the top of the working tree, where it starts the hook; the calls below use -C
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    facts ??= repoFacts();
    const root = facts.root;
    if (!root) throw new Error('the current folder is not in a git repository');
    if (!isSfdxRepo(root) || facts.inProgress()) return 0;
    const list = facts.staged();
    if (list.status !== 0) throw new Error(`git could not list the staged files (${list.stderr.trim() || `exit ${list.status}`})`);
    const findings = [];
    for (const rel of list.stdout.split('\0').filter(isFlowFile)) {
      const blob = spawnSync('git', ['-C', root, 'show', `:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      if (blob.status !== 0) throw new Error(`git could not read ${rel} from the index`);
      const head = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      findings.push(...beforeSaveUpdateFindings(blob.stdout, head.status === 0 ? head.stdout : null, rel));
    }
    if (!findings.length) return 0;
    process.stderr.write(`${refusalText(findings)}\n`);
    return 3;
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    return 0;
  }
}
if (process.argv[1] && basename(process.argv[1]) === 'flow-before-save-update.mjs' && process.argv.includes('--git-hook')) process.exit(runGitHook());
