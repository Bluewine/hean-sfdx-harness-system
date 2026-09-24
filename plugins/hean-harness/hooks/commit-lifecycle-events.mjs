#!/usr/bin/env node
/**
 * Records what the user did in this session that the commit approval gate
 * decides on:
 *
 *   UserPromptSubmit         a new user message ends the previous turn's
 *                            approval; a message asking for a commit grants
 *                            one for this turn
 *   PostToolUse, AskUserQuestion
 *                            the user answered one or both implementation
 *                            questions: the saved machine-wide preference is
 *                            updated, and when both are answered together an
 *                            implementation run starts
 *
 * Never blocks anything. Reads the hook input on standard input.
 */

import { readFileSync } from 'node:fs';

import { readState, writeState, onPrompt, readPreference, savePreference, implementationAnswers, startRun, describePreference }
  from '../scripts/lib/commit-lifecycle.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const session = input?.session_id;
const state = readState(session);

switch (input?.hook_event_name) {
  case 'UserPromptSubmit':
    writeState(session, onPrompt(state, String(input.prompt ?? '')));
    break;
  case 'PostToolUse': {
    if (input.tool_name !== 'AskUserQuestion') break;
    const answers = implementationAnswers(input.tool_response);
    if (!answers) break;

    let note;
    if (answers.mode && answers.commits) {
      const { state: next, note: runNote, started, reason } = startRun(state, answers, input.cwd || process.cwd());
      if (reason !== 'pending-undo') savePreference(answers);
      if (started) writeState(session, next);
      note = runNote;
    } else {
      const existing = readPreference();
      if (!existing) break;
      const preference = { ...existing, ...answers };
      savePreference(preference);
      note = `Saved preference: ${describePreference(preference)}.`;
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }));
    break;
  }
}
process.exit(0);
