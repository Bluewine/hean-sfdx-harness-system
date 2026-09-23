#!/usr/bin/env node
/**
 * Refuses a command that writes to a Salesforce org unless the project saved
 * that org as a place agents may deploy to.
 *
 * A deploy or data change lands in whichever org the command names, or in the
 * CLI's default org when it names none. The default is a per-machine setting
 * that a developer changes to look at another org and forgets to change back,
 * and nothing in the command shows it. Text rules only steer an agent; this
 * gate makes the saved roles decide, whichever agent, skill or subagent runs
 * the command.
 *
 * The roles are saved per project by /hean-harness:org-roles after the
 * discovery that .claude/rules/org-roles.md describes. Until they are saved,
 * every write from an SFDX project is refused. A folder that is not in an SFDX
 * project is not checked.
 *
 * Checked: the sf (or sfdx) commands in WRITES, and the project's pre and post
 * deploy script. Not checked, because they change nothing: queries, retrieves,
 * describes, running tests, `project deploy validate` and `--dry-run`.
 *
 * The target org comes from -o / --target-org (or the older -u /
 * --targetusername), then SF_TARGET_ORG, then the project's and the machine's
 * CLI config. A value the text cannot read, such as "$ORG_ALIAS", is refused:
 * the agent must write the alias out, which also puts it in front of the user.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { commandsIn } from '../scripts/lib/command-line.mjs';
import { projectRoot, defaultOrg, refusal } from '../scripts/lib/org-roles.mjs';

/** Commands that change an org, by their topic words, including the CLI's aliases for them. */
export const WRITES = new Set([
  'project deploy start', 'deploy metadata',
  'project deploy quick', 'deploy metadata quick',
  'project delete source', 'force source delete',
  'apex run', 'force apex execute',
  'data create record', 'data create file', 'force data record create',
  'data update record', 'data update bulk', 'force data record update',
  'data delete record', 'data delete bulk', 'force data record delete',
  'data upsert bulk',
  'data import tree', 'data import bulk', 'force data tree import',
  'org assign permset', 'org assign permsetlicense',
  'community publish', 'force community publish',
  'package install', 'force package install',
  'agent activate', 'agent deactivate', 'agent publish authoring-bundle',
  'org delete sandbox', 'org delete scratch', 'env delete sandbox', 'env delete scratch'
]);

/** The project-supplied script /hean-harness:jenkins-pre-post-deploy runs. */
const PRE_POST_SCRIPT = 'jenkins-pre-post-deploy.sh';

const ORG_FLAGS = ['-o', '--target-org', '-u', '--targetusername'];
const SHELLS = new Set(['bash', 'sh', 'zsh']);

/** The value of the first of these flags in args: undefined when absent, null when given no value. */
function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (names.includes(a)) return args[i + 1] ?? null;
    for (const n of names) {
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
      if (n.length === 2 && a.startsWith(n) && !a.startsWith('--')) return a.slice(2);   // -oalias
    }
  }
  return undefined;
}

/**
 * The org-writing commands in words, as { org } where org is the name the
 * command gives, or undefined when it gives none. null when words writes nothing.
 */
export function orgWrite(words) {
  let w = words;
  if (w[0] === 'npx') w = w.slice(1);
  if (!w.length) return null;

  const script = SHELLS.has(basename(w[0])) ? w[1] : w[0];
  if (script && basename(script) === PRE_POST_SCRIPT) {
    const args = w.slice(w.indexOf(script) + 1);
    return { org: flagValue(args, ['--org']) };
  }

  if (!['sf', 'sfdx'].includes(basename(w[0])) && w[0] !== '@salesforce/cli') return null;
  const topic = [];
  let i = 1;
  for (; i < w.length && !w[i].startsWith('-'); i++) topic.push(...w[i].split(':'));
  if (!WRITES.has(topic.join(' '))) return null;
  const args = w.slice(i);
  if (args.includes('--dry-run')) return null;
  return { org: flagValue(args, ORG_FLAGS) };
}

/** Why this script may not run, or null when every write in it may. */
export function check(script, sessionCwd, env = process.env) {
  for (const { words, env: local, dir } of commandsIn(script, sessionCwd)) {
    const write = orgWrite(words);
    if (!write) continue;
    const root = projectRoot(dir ?? sessionCwd);
    if (!root) continue;
    const target = write.org !== undefined
      ? (write.org === null ? null : { name: write.org, from: 'flag' })
      : defaultOrg(root, { ...env, ...local });
    const reason = refusal(root, target);
    if (reason) return reason;
  }
  return null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('org-write-gate.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const reason = check(input?.tool_input?.command ?? '', input?.cwd || process.cwd());
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }));
  }
  process.exit(0);
}
