#!/usr/bin/env node
/**
 * Starts and closes implementation runs, and reads and changes the saved
 * machine-wide implementation preference.
 *
 * For a subagent-driven run started with "no commits", finish undoes the
 * run's commits so every change is left in the working tree for review.
 *
 *   implementation-run.mjs start --session <session id>
 *   implementation-run.mjs status --session <session id>
 *   implementation-run.mjs finish --session <session id>
 *   implementation-run.mjs preference show
 *   implementation-run.mjs preference clear
 *   implementation-run.mjs preference set commits on|off
 *   implementation-run.mjs preference set mode subagent|main
 */

import { rmSync } from 'node:fs';

import { readState, writeState, readPreference, savePreference, startRun, finishRun, PREFERENCE_FILE }
  from './lib/commit-lifecycle.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];

function usage() {
  console.error('Usage: implementation-run.mjs start|status|finish --session <session id>');
  console.error('       implementation-run.mjs preference show|clear');
  console.error('       implementation-run.mjs preference set commits on|off');
  console.error('       implementation-run.mjs preference set mode subagent|main');
  process.exit(1);
}

function sessionArg() {
  const i = argv.indexOf('--session');
  return i >= 0 ? argv[i + 1] : undefined;
}

const devMode = preference => preference.mode === 'subagent' ? 'Subagent-driven' : 'Main session';
const describe = preference =>
  `${preference.mode === 'subagent' ? 'subagent-driven' : 'main session'}, ` +
  `${preference.commits === 'yes' ? 'commit per task' : 'no commits'}`;

function preferenceCommand() {
  const sub = argv[1];

  if (sub === 'show') {
    const preference = readPreference();
    console.log(preference ? `Saved preference: ${describe(preference)}.` : 'No implementation preference is saved on this machine.');
    process.exit(0);
    return;
  }

  if (sub === 'clear') {
    rmSync(PREFERENCE_FILE, { force: true });
    console.log('Cleared the saved implementation preference.');
    process.exit(0);
    return;
  }

  if (sub === 'set') {
    const field = argv[2], value = argv[3];
    if (!['commits', 'mode'].includes(field)) { usage(); return; }
    if (field === 'commits' && !['on', 'off'].includes(value)) { usage(); return; }
    if (field === 'mode' && !['subagent', 'main'].includes(value)) { usage(); return; }

    const existing = readPreference();
    const change = field === 'commits' ? { commits: value === 'on' ? 'yes' : 'no' } : { mode: value };
    const filled = !existing ? (field === 'commits' ? { mode: 'subagent' } : { commits: 'no' }) : {};
    const preference = { mode: 'subagent', commits: 'no', ...existing, ...change, ...filled };
    savePreference(preference);
    console.log(`Saved preference: ${describe(preference)}.`);
    if (!existing) {
      console.log(`No preference was saved yet, so the other field was filled with its default ` +
                  `(${field === 'commits' ? 'mode subagent' : 'commits no'}).`);
    }
    process.exit(0);
    return;
  }

  usage();
}

function startCommand() {
  const session = sessionArg();
  if (!session) { usage(); return; }
  const preference = readPreference();
  if (!preference) {
    console.log('No implementation preference is saved on this machine. Ask the two implementation questions.');
    process.exit(2);
    return;
  }
  const state = readState(session);
  const { state: next, note } = startRun(state, preference, process.cwd());
  writeState(session, next);
  console.log(note);
  console.log(`Dev mode: ${devMode(preference)}`);
  process.exit(0);
}

function statusCommand() {
  const session = sessionArg();
  if (!session) { usage(); return; }
  const { run, turn } = readState(session);
  console.log(run ? JSON.stringify(run, null, 2) : 'No implementation run is open in this session.');
  console.log(`Commit approved this turn: ${turn.approved ? 'yes' : 'no'}`);
  process.exit(0);
}

function finishCommand() {
  const session = sessionArg();
  if (!session) { usage(); return; }
  const { ok, lines } = finishRun(session);
  for (const l of lines) console.log(l);
  process.exit(ok ? 0 : 1);
}

switch (cmd) {
  case 'preference': preferenceCommand(); break;
  case 'start': startCommand(); break;
  case 'status': statusCommand(); break;
  case 'finish': finishCommand(); break;
  default: usage();
}
