/**
 * Checks that a commit records no Collection Filter condition Flow Builder
 * cannot display. In a FilterCollectionProcessor, every condition's left side
 * must be the current item, <assignNextValueToReference> itself (a collection
 * of plain values), or one of its fields, <assignNextValueToReference>.<Field>.
 * A left side that is a flow variable, formula or constant deploys and runs,
 * but Flow Builder marks the condition invalid.
 *
 * Shared by the Claude Code hook and the git pre-commit hook. Setup copies this
 * file to <config>/hean-harness/hooks/scripts/lib/ with the files
 * install-manifest-check.mjs lists, so this file imports only node built-ins
 * and files in that list. --git-hook runs it as git's pre-commit hook.
 *
 * Flow XML is read with regular expressions, not a parser, as
 * flow-trigger-order.mjs does. A filter with no <conditions> (formula form)
 * has nothing to check.
 *
 * When the check cannot run the commit goes through with a "!!" line naming
 * the reason; a commit refused because a tool is missing blocks all work.
 */

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

import { MAX_BUFFER } from './merge-base.mjs';
import { repoFacts } from './manifest-check.mjs';

const FLOW_FILE = /\.flow-meta\.xml$/;
const tag = (xml, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1].trim() ?? null;

/** Whether a path is a flow file, in any folder. */
export const isFlowFile = path => FLOW_FILE.test(path);

/**
 * Every condition of a Collection Filter in this flow XML whose left side is
 * is neither the filter's current item nor one of its fields: { path, element, left, prefix }.
 */
export function filterFindings(xml, path) {
  const findings = [];
  for (const [, block] of xml.matchAll(/<collectionProcessors>([\s\S]*?)<\/collectionProcessors>/g)) {
    if (tag(block, 'collectionProcessorType') !== 'FilterCollectionProcessor') continue;
    const element = tag(block, 'name') ?? '';
    const prefix = tag(block, 'assignNextValueToReference') ?? '';
    for (const [, condition] of block.matchAll(/<conditions>([\s\S]*?)<\/conditions>/g)) {
      const left = tag(condition, 'leftValueReference') ?? '';
      if (!prefix || (left !== prefix && !left.startsWith(`${prefix}.`))) findings.push({ path, element, left, prefix });
    }
  }
  return findings;
}

/** The refusal for a commit that records these findings. */
export function refusalText(findings) {
  const lines = findings.map(f => `    ${f.path}: ${f.element}: left side \`${f.left}\`, expected \`${f.prefix}\` or \`${f.prefix}.<Field>\``);
  return '!! This commit records Collection Filter conditions Flow Builder cannot display. ' +
         'The flow deploys and runs, but Flow Builder marks each one invalid:\n\n' +
         `${lines.join('\n')}\n\n` +
         "In a FilterCollectionProcessor, every condition's left side must be the current item or one of its fields. " +
         'To combine a flow variable, formula or constant with item fields, set ' +
         '<conditionLogic>formula_evaluates_to_true</conditionLogic>, write the test in <formula> with ' +
         '{!<currentItem>.<Field>} (TEXT() around a picklist field), and remove the <conditions> elements. ' +
         'Then retry the commit.';
}

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The Collection Filter check did not run: ${String(reason).replace(/\.$/, '')}.`;

/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records, so the staged flows are read from it. Exit 3 refuses the commit,
 * and the shell hook turns it into git's 1; any other code lets the commit
 * through. Every message goes to standard error, which git shows. A failure of
 * the check itself lets the commit through, as every other "cannot run" case does.
 *
 * runGitHook() returns that exit code instead of exiting, so
 * pre-commit-checks.mjs can run the four pre-commit checks in one node process;
 * facts, from repoFacts(), are what the checks share instead of each asking git.
 */
export function runGitHook(facts) {
  try {
    // git names the index relative to the top of the working tree, where it starts the hook; the calls below use -C
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    facts ??= repoFacts();
    const root = facts.root;
    if (!root) throw new Error('the current folder is not in a git repository');
    if (facts.inProgress()) return 0;
    const list = facts.staged();
    if (list.status !== 0) throw new Error(`git could not list the staged files (${list.stderr.trim() || `exit ${list.status}`})`);
    const findings = [];
    for (const rel of list.stdout.split('\0').filter(isFlowFile)) {
      const blob = spawnSync('git', ['-C', root, 'show', `:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      if (blob.status !== 0) throw new Error(`git could not read ${rel} from the index`);
      findings.push(...filterFindings(blob.stdout, rel));
    }
    if (!findings.length) return 0;
    process.stderr.write(`${refusalText(findings)}\n`);
    return 3;
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    return 0;
  }
}
if (process.argv[1] && basename(process.argv[1]) === 'flow-collection-filter.mjs' && process.argv.includes('--git-hook')) process.exit(runGitHook());
