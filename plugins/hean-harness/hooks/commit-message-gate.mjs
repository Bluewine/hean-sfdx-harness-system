#!/usr/bin/env node
/**
 * Refuses a commit whose subject line does not carry a work item reference.
 *
 * A subject that names no work item cannot be traced back to what asked for the
 * change. Months later the diff is the only record, and a reviewer reading
 * release history has nothing to look the change up by. The check happens here,
 * before the commit runs, because a rejected commit costs a retyped message
 * while a landed one costs a rewrite of history.
 *
 * Required shape:
 *
 *   @ABC-123: Add the thing
 *   @ABC-123-UK: Add the thing        (a two-letter suffix, where a team uses one)
 *   @ABC-123: [Sonar] Remove the thing (a Sonar fix, which the PR skills list apart)
 *
 * The work item reference, one colon, one space, an optional `[Sonar] ` tag,
 * then a capital letter.
 *
 * assets/githooks/commit-msg repeats this pattern for commits typed outside
 * Claude Code. Change both together.
 *
 * Only a message given on the command line can be checked. A commit that opens
 * an editor, reads a file with -F, or reuses a message with -C passes through
 * untouched, because there is nothing here to read.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';

export const SUBJECT = /^@[A-Z]+-[0-9]+(-[A-Z]{2})?:\s(\[Sonar\]\s)?[A-Z](.*)$/;

/**
 * Blank out anything that is text rather than a command, keeping every position.
 *
 * Used only to find where a real `git commit` starts. A script that prints the
 * words "git commit" in a message is not committing anything, and the message
 * itself is read from the original text at the position this copy reports.
 */
export function blankOutText(source) {
  let out = '';
  let quote = null;
  let inComment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inComment) { out += c === '\n' ? (inComment = false, c) : ' '; continue; }
    if (quote) {
      if (quote === '"' && c === '\\') { out += '  '; i++; continue; }
      if (c === quote) quote = null;
      out += c === '\n' ? c : ' ';
      continue;
    }
    if (c === '\\') { out += ' '; if (source[i + 1] !== undefined) { out += ' '; i++; } continue; }
    if (c === '"' || c === "'") { quote = c; out += ' '; continue; }
    if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) { inComment = true; out += ' '; continue; }
    out += c;
  }
  return out;
}

/**
 * Split one command into its words, from `start` up to whatever ends it.
 *
 * Quotes are removed and their contents kept whole, so `-m "two words"` gives
 * one word. A separator inside quotes does not end the command; outside them,
 * any of ; && || | or a newline does.
 */
export function words(source, start = 0) {
  const out = [];
  let cur = '';
  let started = false;
  let quote = null;
  const push = () => { if (started) { out.push(cur); cur = ''; started = false; } };

  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (quote === '"' && c === '\\' && source[i + 1] !== undefined) { cur += source[++i]; continue; }
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (c === '\\' && source[i + 1] !== undefined) { cur += source[++i]; started = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&') { push(); break; }
    if (/\s/.test(c)) { push(); continue; }
    cur += c; started = true;
  }
  push();
  return out;
}

/**
 * The message a `git commit` was given on the command line, or null.
 *
 * Only the first -m matters: git joins several into paragraphs, and the first
 * is the subject. A bundled short flag ending in m, such as -am, takes the next
 * word as its value, the same as a bare -m does.
 */
export function messageOf(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a === '-m' || a === '--message') return argv[i + 1] ?? null;
    if (a.startsWith('--message=')) return a.slice('--message='.length);
    if (/^-[A-Za-z]*m$/.test(a) && a !== '--') return argv[i + 1] ?? null;   // -m, -am, -sm
    if (/^-[A-Za-z]*m./.test(a) && !a.startsWith('--')) return a.slice(a.indexOf('m') + 1); // -m"text", -am"text"
  }
  return null;
}

/** Every command-line commit message in this script, in the order they run. */
export function commitMessages(cmd) {
  const blanked = blankOutText(cmd);
  const found = [];
  const re = /\bgit\s+commit\b/g;
  let m;
  while ((m = re.exec(blanked)) !== null) {
    const msg = messageOf(words(cmd, m.index));
    if (msg !== null) found.push(msg);
  }
  return found;
}

const REASON = (subject) =>
  `This commit subject does not carry a work item reference:\n\n` +
  `    ${subject}\n\n` +
  `Required shape:  @WORK-ID: Capitalised imperative summary\n` +
  `Pattern:         ${SUBJECT.source}\n\n` +
  `    @ABC-123: Add the work type dedupe check\n` +
  `    @ABC-123-UK: Add the work type dedupe check      (with a team suffix)\n` +
  `    @ABC-123: [Sonar] Remove the unused variable     (a Sonar fix)\n\n` +
  `Take the work item reference from the current branch name, prefix it with @, ` +
  `follow it with one colon and one space, and start the summary with a capital letter.`;

const isMain = process.argv[1] && process.argv[1].endsWith('commit-message-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

  const bad = commitMessages(input?.tool_input?.command ?? '')
    .map(m => m.split('\n')[0])
    .find(subject => !SUBJECT.test(subject));

  if (bad !== undefined) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: REASON(bad)
      }
    }));
  }
  process.exit(0);
}
