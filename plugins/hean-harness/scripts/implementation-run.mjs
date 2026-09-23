#!/usr/bin/env node
/**
 * Closes the implementation run recorded for one session. For a
 * subagent-driven run started with "no commits", undoes the run's commits so
 * every change is left in the working tree for the user to review.
 *
 *   implementation-run.mjs status|finish --session <session id>
 */

import { readState, finishRun } from './lib/commit-lifecycle.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const i = argv.indexOf('--session');
const session = i >= 0 ? argv[i + 1] : undefined;

if (!['status', 'finish'].includes(cmd) || !session) {
  console.error('Usage: implementation-run.mjs status|finish --session <session id>');
  process.exit(1);
}

if (cmd === 'status') {
  const { run, turn } = readState(session);
  console.log(run ? JSON.stringify(run, null, 2) : 'No implementation run is open in this session.');
  console.log(`Commit approved this turn: ${turn.approved ? 'yes' : 'no'}${turn.skill ? ` (${turn.skill})` : ''}`);
  process.exit(0);
}

const { ok, lines } = finishRun(session);
for (const l of lines) console.log(l);
process.exit(ok ? 0 : 1);
