#!/usr/bin/env node
/**
 * Records what the user did in this session that the commit approval gate
 * decides on:
 *
 *   UserPromptSubmit         a new user message ends the previous turn's
 *                            approval; a typed /hean-harness:commit or a typed
 *                            lifecycle skill grants one for this turn
 *   PreToolUse, Skill        the model started a lifecycle skill
 *   PostToolUse, AskUserQuestion
 *                            the user answered the two implementation
 *                            questions: an implementation run starts
 *
 * Never blocks anything. Reads the hook input on standard input.
 */

import { readFileSync } from 'node:fs';

import { readState, writeState, onPrompt, onSkill, implementationAnswers, startRun }
  from '../scripts/lib/commit-lifecycle.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const session = input?.session_id;
const state = readState(session);

switch (input?.hook_event_name) {
  case 'UserPromptSubmit':
    writeState(session, onPrompt(state, String(input.prompt ?? '')));
    break;
  case 'PreToolUse':
    if (input.tool_name === 'Skill') writeState(session, onSkill(state, input.tool_input?.skill));
    break;
  case 'PostToolUse': {
    if (input.tool_name !== 'AskUserQuestion') break;
    const answers = implementationAnswers(input.tool_response);
    if (!answers) break;
    const { state: next, note } = startRun(state, answers, input.cwd || process.cwd());
    writeState(session, next);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }));
    break;
  }
}
process.exit(0);
