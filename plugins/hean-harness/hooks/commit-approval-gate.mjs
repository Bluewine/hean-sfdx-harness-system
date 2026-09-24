#!/usr/bin/env node
/**
 * Refuses a commit the user has not approved, so finished work waits in the
 * working tree where the user can see every change before it is committed.
 *
 * A commit made without the user looking turns "review what was done" into
 * "review what was already recorded", and in practice the second is skipped.
 * The gate allows a commit only when the saved machine-wide preference is
 * "commit per task", the user's latest message asks for a commit, or an open
 * subagent-driven "no commits" run in this repository has its own task review
 * reading the commits. scripts/lib/commit-lifecycle.mjs holds those rules,
 * the saved preference and the session state; hooks/commit-lifecycle-events.mjs
 * records what the user did.
 *
 * Also refuses `git push` and `git reset --hard` while a subagent-driven run
 * with "no commits" still has per-task commits to undo.
 *
 * Every repository is checked, whichever agent or subagent commits. Reads the
 * tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';

import { gitCommands, repoOf } from '../scripts/lib/command-line.mjs';

const GATED = new Set(['commit', 'push', 'reset']);

const isMain = process.argv[1] && process.argv[1].endsWith('commit-approval-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const sessionCwd = input?.cwd || process.cwd();
  const found = [...gitCommands(input?.tool_input?.command ?? '', sessionCwd)].filter(c => GATED.has(c.sub));
  if (!found.length) process.exit(0);

  const { readState, readPreference, refusal } = await import('../scripts/lib/commit-lifecycle.mjs');
  const state = readState(input?.session_id);
  const preference = readPreference();
  for (const c of found) {
    const repo = repoOf(c, sessionCwd);
    if (!repo) continue;
    const reason = refusal(state, preference, c, repo);
    if (!reason) continue;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
    }));
    break;
  }
  process.exit(0);
}
