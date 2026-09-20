#!/usr/bin/env node
/**
 * Stops a commit of Salesforce Flow files until they have been checked for a
 * dated change-log entry.
 *
 * It remembers the hash of the staged Flow changes it last saw verified. When
 * the staged changes still hash the same, the commit goes through; when they
 * differ, it denies and points at the skill that adds the entries.
 *
 * The record lives under the home directory, keyed by repository, rather than
 * beside the skill. A plugin's own folder moves on every update, so state
 * written there is lost.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { claudeDir } from '../scripts/lib/paths.mjs';

const ok = () => { process.stdout.write('{}'); process.exit(0); };

/** Where this repository's marker lives. One definition, used by both modes. */
export const stateDirFor = repo =>
  join(claudeDir(), 'hean-harness', 'flow-gate',
       createHash('sha1').update(repo).digest('hex').slice(0, 12));

const gitIn = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Record the staged Flow changes as checked, so the retried commit goes
 * through. The skill that adds the dated entries calls this rather than
 * writing a marker itself — one place decides where the marker lives and how
 * it is hashed, so the gate and the skill cannot drift apart.
 *
 * Runs before anything reads standard input, because this mode has none.
 */
if (process.argv.includes('--mark-verified')) {
  try {
    const root = gitIn(['rev-parse', '--show-toplevel']).trim();
    const diff = gitIn(['-C', root, 'diff', '--cached', '--', '*.flow-meta.xml']);
    const dir = stateDirFor(root);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'last-verified-diff-hash');
    writeFileSync(file, createHash('sha1').update(diff).digest('hex'));
    console.log(`Recorded the staged Flow changes as checked.\n  ${file}`);
  } catch (e) {
    console.error(`Could not record the Flow check: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { ok(); }

const cmd = input?.tool_input?.command ?? '';
if (!/\bgit\s+commit\b/.test(cmd)) ok();

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', ...opts });

let root;
try { root = git(['rev-parse', '--show-toplevel']).trim(); } catch { ok(); }

// nothing staged that is a Flow? then this gate has no opinion
let staged = '';
try { staged = git(['-C', root, 'diff', '--cached', '--', '*.flow-meta.xml']); } catch { ok(); }
if (!staged.trim()) ok();

const stateDir = stateDirFor(root);
const stateFile = join(stateDir, 'last-verified-diff-hash');
const current = createHash('sha1').update(staged).digest('hex');

const last = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : '';
if (current === last) ok();

mkdirSync(stateDir, { recursive: true });

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'Staged Flow changes have not been checked for a dated description entry yet. ' +
      'Invoke the flow-description-comment skill now — it finds the changed Flow files, ' +
      'adds a dated entry to any that need one, re-stages them, then retries this commit.'
  }
}));
process.exit(0);
