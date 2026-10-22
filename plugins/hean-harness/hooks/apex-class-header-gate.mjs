#!/usr/bin/env node
/**
 * Refuses a `git commit` that records an Apex class whose class comment does
 * not follow "Class header" in apex-docstring-comments.md: a new class must end
 * its class comment with "@since <date> <WORK-ID>", an edited class needs a
 * "@changes <date> <WORK-ID>: <text>" line for the branch's story, and a class
 * comment holds at most 5 "@changes" lines.
 *
 * scripts/lib/apex-class-header.mjs holds the check. The work ID comes from
 * the branch name; a branch without one is not checked. A class is new when
 * HEAD does not hold it and changed when HEAD does (a rename counts as changed).
 * The check reads git only and makes no org call.
 *
 * What the commit records comes from scripts/lib/commit-index.mjs, as for the
 * Collection Filter gate. A file only deleted is never checked. A commit
 * during a merge, cherry-pick, revert or rebase is not checked. A repository
 * without sfdx-project.json is not checked and prints nothing.
 *
 * The check fails open. Staging the text cannot name, an index git cannot
 * build, or a class file git cannot read: the commit goes through with a "!!"
 * line. The hook timeout is 30 seconds.
 */

import { readFileSync } from 'node:fs';

import { git, tryGit } from '../scripts/lib/command-line.mjs';
import { commitsIn, commitIndex } from '../scripts/lib/commit-index.mjs';
import { MAX_BUFFER, WORK_ID } from '../scripts/lib/merge-base.mjs';
import { operationInProgress } from '../scripts/lib/manifest-check.mjs';
import { isSfdxRepo } from '../scripts/lib/paths.mjs';
import { headerFindings, refusalText, notChecked, isApexClassFile } from '../scripts/lib/apex-class-header.mjs';

const SELF = 'apex-class-header-gate.mjs';

/** The class paths the commit adds (isNew) or changes, read from the index it records; deletions left out. */
const recordedPaths = (root, env, filter) =>
  git(root, 'diff', '--cached', '-M', '--name-only', `--diff-filter=${filter}`, '-z', { env }).split('\0').filter(isApexClassFile);

/** Check every commit in the command, in order: { warnings, refusal? }. The first refused commit stops the walk. */
export function headerCheck(command, sessionCwd) {
  const warnings = [];
  for (const { root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    if (!isSfdxRepo(root) || operationInProgress(root)) continue;
    const branch = tryGit(root, 'branch', '--show-current');
    const workId = branch ? WORK_ID.exec(branch)?.[0] : null;
    if (!workId) continue;
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
      for (const [isNew, filter] of [[true, 'A'], [false, 'MR']]) {
        for (const rel of recordedPaths(root, env, filter)) {
          const source = tryGit(root, 'show', `:${rel}`, { env, maxBuffer: MAX_BUFFER });
          if (source == null) { warnings.push(notChecked(`${rel} could not be read from the index this commit records`)); continue; }
          findings.push(...headerFindings(source, { isNew, workId, path: rel }));
        }
      }
    } finally {
      index.cleanup();
    }
    if (findings.length) return { warnings, refusal: refusalText(findings, workId) };
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
  try { r = headerCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd()); }
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
