#!/usr/bin/env node
/**
 * Refuses `git push` and `git reset --hard` while an open implementation run
 * with "no commits" still has per-task commits to undo, so those commits
 * cannot leave the machine or be discarded before the user reviews them.
 *
 * A commit is never refused. scripts/lib/commit-lifecycle.mjs holds the rules
 * and the session state; hooks/commit-lifecycle-events.mjs records the run.
 *
 * Every repository is checked, whichever agent or subagent runs the command.
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';

import { gitCommands, repoOf } from '../scripts/lib/command-line.mjs';

const GATED = new Set(['push', 'reset']);

const isMain = process.argv[1] && process.argv[1].endsWith('commit-approval-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const sessionCwd = input?.cwd || process.cwd();
  const found = [...gitCommands(input?.tool_input?.command ?? '', sessionCwd)].filter(c => GATED.has(c.sub));
  if (!found.length) process.exit(0);

  const { readState, refusal } = await import('../scripts/lib/commit-lifecycle.mjs');
  const state = readState(input?.session_id);
  for (const c of found) {
    const repo = repoOf(c, sessionCwd);
    if (!repo) continue;
    const reason = refusal(state, c, repo);
    if (!reason) continue;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
    }));
    break;
  }
  process.exit(0);
}
