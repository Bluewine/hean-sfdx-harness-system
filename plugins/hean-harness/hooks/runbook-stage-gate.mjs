#!/usr/bin/env node
/**
 * Refuses a `git commit` that records a runbook or destructive-changes file in
 * a stage folder whose step the repository's deploy.yml does not list.
 *
 * The shared Jenkins library runs only the pre and post steps deploy.yml
 * lists, and repositories list different ones. A file under a stage folder
 * whose step is missing is never deployed and nothing reports it; a hand
 * deploy that tests it passes. scripts/lib/deploy-steps.mjs maps each path to
 * the step it needs.
 *
 * What the commit records comes from scripts/lib/commit-index.mjs, as for the
 * per-story manifest check. A file only deleted is never refused. A commands
 * file counts only when it gains a line that runs something, and a
 * destructive manifest only when it gains a <members> entry, each compared
 * with HEAD: the placeholder files every repository carries are not changes.
 * A commit during a merge, cherry-pick, revert or rebase records work taken
 * from elsewhere and is not checked.
 *
 * The check fails open. No deploy.yml: silent. Staging the text cannot name,
 * an index git cannot build, or an unreadable deploy.yml when the commit
 * records a stage-folder file: the commit goes through with a "!!" line. It
 * calls no sf; building the temporary index can be slow in a large
 * repository, so the hook timeout is 30 seconds.
 */

import { readFileSync } from 'node:fs';

import { git, tryGit } from '../scripts/lib/command-line.mjs';
import { commitsIn, commitIndex } from '../scripts/lib/commit-index.mjs';
import { readDeploySteps, requiredStep, missingStep } from '../scripts/lib/deploy-steps.mjs';
import { operationInProgress } from '../scripts/lib/manifest-check.mjs';

const SELF = 'runbook-stage-gate.mjs';

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The runbook stage check did not run: ${String(reason).replace(/\.$/, '')}.`;

/** The paths the commit adds or changes, read from the index it records; deletions left out. */
const recordedPaths = (root, env) =>
  git(root, 'diff', '--cached', '--name-only', '--no-renames', '--diff-filter=d', '-z', { env }).split('\0').filter(Boolean);

const refusalText = lines =>
  '!! This commit records runbook files Jenkins never deploys or runs, because deploy.yml does not list the step ' +
  'their stage folder needs:\n\n' +
  lines.map(l => `    ${l}`).join('\n') + '\n\n' +
  'Move each file to a stage that runs its step, or add the step to deploy.yml. A new step changes what Jenkins ' +
  "runs for every release of this repository, so adding one is the user's decision: ask before editing deploy.yml. " +
  'Then retry the commit.';

/** Check every commit in the command, in order: { warnings, refusal? }. The first refused commit stops the walk. */
export function stageCheck(command, sessionCwd) {
  const warnings = [];
  for (const { root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    const deploy = readDeploySteps(root);
    if (deploy.missing || operationInProgress(root)) continue;
    if (unknown) {
      warnings.push(notChecked('the command stages files its text does not name (a variable, a glob, a pathspec file or picked hunks)'));
      continue;
    }
    let index;
    try {
      index = commitIndex(root, earlier, own, byPath);
    } catch (e) {
      warnings.push(notChecked(`the index this commit records could not be built (${e.message.split('\n')[0]})`));
      continue;
    }
    let lines;
    try {
      const env = { ...process.env, GIT_INDEX_FILE: index.file };
      const paths = recordedPaths(root, env).filter(rel => requiredStep(rel));
      if (paths.length && deploy.error) { warnings.push(notChecked(deploy.error)); continue; }
      lines = paths.map(rel => missingStep(rel, deploy.steps, {
        content: f => tryGit(root, 'show', `:${f}`, { env }),
        head: f => tryGit(root, 'show', `HEAD:${f}`)
      })).filter(Boolean);
    } finally {
      index.cleanup();
    }
    if (lines.length) return { warnings, refusal: refusalText(lines) };
  }
  return { warnings };
}

const isMain = process.argv[1] && process.argv[1].endsWith(SELF);
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (input.tool_name !== 'Bash') process.exit(0);
  const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
  let r;
  try { r = stageCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd()); }
  catch (e) { r = { warnings: [notChecked(e.message)] }; }
  if (r.refusal) {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.refusal } });
  }
  if (r.warnings.length) {
    const text = r.warnings.join('\n');
    emit({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
  }
  process.exit(0);
}
