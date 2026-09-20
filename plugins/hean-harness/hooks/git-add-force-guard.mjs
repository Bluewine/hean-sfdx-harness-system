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
 * Does this one command stage a file past the ignore list?
 *
 * Checked per command rather than across the whole line: a line that stages a
 * file and separately removes a temporary one contains both halves while
 * forcing nothing. Short flags also bundle, so a group containing f counts
 * even though it is not a standalone flag.
 */
function forcesPastIgnore(segment) {
  if (!/\bgit\s+add\b/.test(segment)) return false;
  if (/(^|\s)--force(\s|=|$)/.test(segment)) return true;
  return /(^|\s)-[A-Za-z]*f[A-Za-z]*(\s|$)/.test(segment);
}

const segments = cmd.split(/&&|\|\||;|\|/);

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
