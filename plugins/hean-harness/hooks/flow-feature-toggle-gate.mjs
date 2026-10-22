#!/usr/bin/env node
/**
 * Refuses a `git commit` that records a Get Records read of the feature toggle
 * types where the flow rule "Feature toggles in flows" forbids one.
 *
 * scripts/lib/flow-feature-toggle.mjs holds the check. It reads the staged
 * flow against its HEAD copy and is cheap, so it runs first. Only when it
 * finds something does the hook ask whether the toggle package is installed
 * in the saved development org (one live query, cached for 7 days). Installed:
 * the commit is refused. Not installed: the commit goes through silently,
 * because the rule has nothing to protect. Unknown: the commit goes through
 * with a "!!" line.
 *
 * What the commit records comes from scripts/lib/commit-index.mjs, as for the
 * Collection Filter gate. A file only deleted is never checked. A commit
 * during a merge, cherry-pick, revert or rebase is not checked. A repository
 * without sfdx-project.json is not checked and prints nothing.
 *
 * The check fails open. Staging the text cannot name, an index git cannot
 * build, a flow file git cannot read, or an org that cannot answer: the commit
 * goes through with a "!!" line. The hook timeout is 30 seconds.
 */

import { readFileSync } from 'node:fs';

import { git, tryGit } from '../scripts/lib/command-line.mjs';
import { commitsIn, commitIndex } from '../scripts/lib/commit-index.mjs';
import { MAX_BUFFER } from '../scripts/lib/merge-base.mjs';
import { operationInProgress } from '../scripts/lib/manifest-check.mjs';
import { isSfdxRepo } from '../scripts/lib/paths.mjs';
import { toggleFindings, refusalText, notChecked, isFlowFile, packageInstalled } from '../scripts/lib/flow-feature-toggle.mjs';

const SELF = 'flow-feature-toggle-gate.mjs';

/** The paths the commit adds or changes, read from the index it records; deletions left out. */
const recordedPaths = (root, env) =>
  git(root, 'diff', '--cached', '--name-only', '--no-renames', '--diff-filter=d', '-z', { env }).split('\0').filter(Boolean);

/** Check every commit in the command, in order: { warnings, refusal? }. The first refused commit stops the walk. */
export function toggleCheck(command, sessionCwd, packageOptions = {}) {
  const warnings = [];
  for (const { root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    if (!isSfdxRepo(root) || operationInProgress(root)) continue;
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
    const findings = [];
    try {
      const env = { ...process.env, GIT_INDEX_FILE: index.file };
      for (const rel of recordedPaths(root, env).filter(isFlowFile)) {
        const xml = tryGit(root, 'show', `:${rel}`, { env, maxBuffer: MAX_BUFFER });
        if (xml == null) { warnings.push(notChecked(`${rel} could not be read from the index this commit records`)); continue; }
        const head = tryGit(root, 'show', `HEAD:${rel}`, { maxBuffer: MAX_BUFFER });
        findings.push(...toggleFindings(xml, head, rel));
      }
    } finally {
      index.cleanup();
    }
    if (!findings.length) continue;
    const pkg = packageInstalled(root, packageOptions);
    if (!pkg.known) warnings.push(notChecked(pkg.reason));
    else if (pkg.installed) return { warnings, refusal: refusalText(findings) };
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
  try { r = toggleCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd()); }
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
