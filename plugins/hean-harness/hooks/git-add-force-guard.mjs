#!/usr/bin/env node
/**
 * Refuses `git add -f` and `git add --force`.
 *
 * Entries in .gitignore are a decision the team already made. Forcing a file
 * past them puts something in the repository that someone deliberately kept
 * out, and it is easy to do by accident when a command fails and force looks
 * like the fix.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = input?.tool_input?.command ?? '';

/**
 * Blank out anything that is text rather than a command.
 *
 * Quoted strings and comments can hold the same words as a real command. A
 * script that prints an explanation, or a commit message that mentions the
 * flag, is not staging anything — refusing it blocks work for no reason and
 * gives no clue why. Each run of text becomes spaces so that positions, and
 * therefore the word boundaries around them, stay as they were.
 */
function blankOutText(source) {
  let out = '';
  let quote = null;          // which quote character we are inside, if any
  let inComment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inComment) { out += c === '\n' ? (inComment = false, c) : ' '; continue; }
    if (quote) {
      // inside double quotes a backslash escapes the next character; inside
      // single quotes it does not, and nothing but the closing quote ends them
      if (quote === '"' && c === '\\') { out += '  '; i++; continue; }
      if (c === quote) quote = null;
      out += c === '\n' ? c : ' ';
      continue;
    }
    if (c === '\\') { out += ' '; if (source[i + 1] !== undefined) { out += ' '; i++; } continue; }
    if (c === '"' || c === "'") { quote = c; out += ' '; continue; }
    // a # starts a comment only at the start of a word
    if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) { inComment = true; out += ' '; continue; }
    out += c;
  }
  return out;
}

/**
 * Does this one command stage a file past the ignore list?
 *
 * Checked per command rather than across the whole script: a script that
 * stages a file on one line and tests for one with `-f` on another contains
 * both halves while forcing nothing. Short flags bundle, so a group containing
 * f counts even though it is not a standalone flag.
 *
 * The flag must also come after `git add`, not before it: `test -f x && git add y`
 * has both words in one command and forces nothing.
 */
function forcesPastIgnore(segment) {
  const m = /\bgit\s+add\b/.exec(segment);
  if (!m) return false;
  const after = segment.slice(m.index + m[0].length);
  if (/(^|\s)--force(\s|=|$)/.test(after)) return true;
  return /(^|\s)-[A-Za-z]*f[A-Za-z]*(\s|$)/.test(after);
}

// Newlines separate commands exactly as ; does. Leaving them out made a whole
// multi-line script one segment, so any -f anywhere in it denied the run.
const segments = blankOutText(cmd).split(/&&|\|\||;|\||\n/);

if (segments.some(forcesPastIgnore)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'git add -f/--force is prohibited — .gitignore exclusions are intentional. ' +
        'Ask the user before force-adding any file.'
    }
  }));
}
process.exit(0);
