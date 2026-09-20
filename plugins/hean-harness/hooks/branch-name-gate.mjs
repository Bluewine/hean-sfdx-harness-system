#!/usr/bin/env node
/**
 * Checks a new branch's name against the convention the team recorded.
 *
 * Does nothing at all when no convention is set. A team that declined to name
 * one is not asked again and is never blocked — that is the point of making it
 * a setting rather than a rule.
 *
 * Never fails a session: anything unexpected lets the command through.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const allow = () => { process.stdout.write('{}'); process.exit(0); };

/**
 * Turn a recorded pattern into something matchable.
 * `{WORK-ID}` means a work item key such as ABC-123. Any other `{token}` is
 * free text the team did not constrain.
 */
export function patternToRegex(pattern) {
  const body = pattern.split(/(\{[^}]+\})/).map(part => {
    if (!part.startsWith('{')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = part.slice(1, -1).toUpperCase().replace(/[^A-Z]/g, '');
    return token.includes('WORKID') || token.includes('ISSUEID') ? '[A-Za-z]+-\\d+' : '.+';
  }).join('');
  return new RegExp(`^${body}$`);
}

/** The branch name a command would create, or null when it creates none. */
export function branchFrom(cmd) {
  let m = cmd.match(/\bgit\s+(?:checkout|switch)\s+(?:-[bBc]|--create)\s+(\S+)/);
  if (m) return m[1].replace(/^["']|["']$/g, '');
  // A branch command naming a branch creates one, with or without a start
  // point after it. The listing and deleting forms all begin with a flag.
  m = cmd.match(/\bgit\s+branch\s+(?!-)(\S+)/);
  if (m) return m[1].replace(/^["']|["']$/g, '');
  return null;
}

// Only act when run directly. Importing this file must not read standard
// input, or an importer blocks forever waiting for input that never comes.
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) try {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { allow(); }

  const cmd = input?.tool_input?.command ?? '';
  const branch = branchFrom(cmd);
  if (!branch) allow();

  const { repoRoot, get } = await import('../scripts/lib/settings.mjs');
  let repo;
  try {
    repo = execFileSync('git', ['rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { repo = repoRoot(); }

  const rule = get(repo, 'branchNaming');
  if (!rule || !rule.pattern) allow();          // no convention recorded, nothing to check

  if (patternToRegex(rule.pattern).test(branch)) allow();

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `The branch name "${branch}" does not match this project's convention.\n` +
        `Expected: ${rule.pattern}` +
        (rule.example ? `\nFor example: ${rule.example}` : '') +
        `\n\nRename it, or clear the convention with:\n` +
        `  node "\${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" unset --key branchNaming`
    }
  }));
  process.exit(0);
} catch {
  allow();
}
