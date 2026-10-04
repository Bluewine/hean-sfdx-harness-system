#!/usr/bin/env node
/**
 * Compiles every runbook Apex script at the API version the Jenkins pipeline
 * runs it at, and refuses a commit of a script whose staged content has not
 * compiled.
 *
 *   PostToolUse, Write|Edit   a write to runbooks/<pre|post>-deploy/apex/*.apex
 *                             compiles the file (scripts/lib/runbook-compile.mjs).
 *                             A compile error is returned as context starting
 *                             with "!! " and says what to fix; a pass records
 *                             the file's git object id. Nothing here blocks.
 *   PreToolUse, Bash          a `git commit` with a staged script whose content
 *                             has no recorded pass is denied. When the
 *                             pipeline's version cannot be read, the commit is
 *                             allowed with a warning.
 *   --check <file>            compiles and records one script from the command
 *                             line, for a script not written through Write or Edit.
 *
 * Same-call staging (`git add f && git commit`, `git commit -a`, `git commit
 * <paths>`) is read with the Flow gate's parser: the script content that call
 * stages is the working-tree file, so that content is what must have passed.
 */

import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitCommands, repoOf, tryGit } from '../scripts/lib/command-line.mjs';
import { stagingOf } from './flow-description-gate.mjs';
import {
  RUNBOOK_SCRIPT, compileScript, isVersionGap, readRecord, recordCompiled, isRecorded, pipelineApiVersion
} from '../scripts/lib/runbook-compile.mjs';

const HOOK = `node "${fileURLToPath(import.meta.url)}" --check <file>`;

/** { root, rel } for a file inside a repository, rel repository-relative with forward slashes. */
function locate(file) {
  let real;
  try { real = realpathSync(file); } catch { return null; }
  const root = tryGit(dirname(real), 'rev-parse', '--show-toplevel');
  if (!root) return null;
  return { root, rel: relative(realpathSync(root), real).split(sep).join('/') };
}

/** Compile one script and record a pass: { kind: 'pass'|'fail'|'skip'|'error', text }. */
export async function check(root, rel) {
  const file = join(root, rel);
  let result;
  try {
    result = await compileScript({ repoRoot: root, file });
  } catch (e) {
    return { kind: 'error', text: `The runbook compile check could not run for ${rel}: ${e.message}. The script was not compiled.` };
  }
  if (result.skipped === 'version') {
    return { kind: 'skip', text: `!! The pipeline's anonymous Apex API version could not be read (${result.reason}). ` +
      `Run \`npm install\` in ${root} so the runbook compile check can run. ${rel} was not compiled; ` +
      `commits of it are not checked until the version can be read.` };
  }
  if (result.skipped === 'target') {
    return { kind: 'skip', text: `!! ${result.reason} ${rel} was not compiled, and a commit of it stays refused until it is.` };
  }
  if (result.compiled) {
    const oid = objectId(root, rel);
    if (!oid) return { kind: 'error', text: `${rel} compiles at API ${result.version} on ${result.alias}, but git could not hash it, so the pass was not recorded.` };
    recordCompiled(root, rel, oid, result.version);
    return { kind: 'pass', text: `${rel} compiles at API ${result.version} on ${result.alias} (the pipeline's anonymous Apex version).` };
  }
  const where = `${rel}${result.line ? ` line ${result.line}` : ''}${result.column ? `, column ${result.column}` : ''}`;
  const head = `!! ${where} does not compile at API ${result.version} on ${result.alias}, the version the Jenkins ` +
               `pipeline runs anonymous Apex at: ${result.problem ?? '(no problem text returned)'}`;
  const fix = isVersionGap(result.problem)
    ? `This element is newer than API ${result.version}. The script passes \`sf apex run\` locally but will fail in ` +
      `Jenkins. Move the logic into a force-app Apex class whose apiVersion is new enough for the element, add a ` +
      `test class for it to the project's coverage target, reduce the script to a call of that class, then edit ` +
      `the script again so this check re-runs.`
    : 'This is a compile error in the script. Fix it in the script; the check re-runs on the next edit.';
  return { kind: 'fail', text: `${head}\n\n${fix}` };
}

/** The git object id of the working-tree file as it would be staged, line-ending filters applied; null on failure. */
const objectId = (root, rel) => tryGit(root, 'hash-object', '--', rel);

const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const context = text => emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });

/** The changed runbook scripts, repository-relative, that this staging would add to the index. */
function scriptsStagedBy(staging, dir) {
  const spec = staging.scope === 'paths' ? ['--', ...staging.paths] : [];
  const out = args => (tryGit(dir, ...args) ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const found = new Set(out(['diff', '--name-only', '--diff-filter=d', ...spec]));
  if (staging.scope !== 'tracked') for (const f of out(['ls-files', '--others', '--exclude-standard', '--full-name', ...spec])) found.add(f);
  return [...found].filter(f => RUNBOOK_SCRIPT.test(f));
}

/** The staged runbook scripts (deletions left out) and the object id of each staged blob. */
function stagedScripts(root) {
  const names = (tryGit(root, 'diff', '--cached', '--name-only', '--no-renames', '--diff-filter=d', '-z') ?? '')
    .split('\0').filter(f => RUNBOOK_SCRIPT.test(f));
  return new Map(names.map(f => [f, tryGit(root, 'rev-parse', `:${f}`)]));
}

/**
 * Whether a `git add` or `git commit` picks hunks interactively (-p, --patch,
 * -i, --interactive). The staged content then differs from the working tree in
 * a way the text cannot say, so it counts as unknown staging.
 */
export function stagesInteractively(sub, args) {
  if (sub !== 'add' && sub !== 'stage' && sub !== 'commit') return false;
  for (const a of args) {
    if (a === '--') break;
    if (a === '--patch' || a === '--interactive') return true;
    if (/^-[A-Za-z]+$/.test(a)) {
      // a commit's -m/-F/-c/-C/-t take a value: letters after one of them are that value
      const flags = sub === 'commit' ? a.slice(1).split(/[mFcCt]/)[0] : a.slice(1);
      if (/[pi]/.test(flags)) return true;
    }
  }
  return false;
}

const INTERACTIVE = files =>
  'This command stages runbook Apex scripts interactively and commits in the same call:\n\n' +
  files.map(f => `    ${f}`).join('\n') + '\n\n' +
  'The runbook compile check cannot tell which content it stages. Stage them in their own Bash call, ' +
  'then run the commit as a separate call.';

const UNCHECKED = files =>
  'These runbook Apex scripts have not compiled at the pipeline\'s API version in their staged form:\n\n' +
  files.map(f => `    ${f}`).join('\n') + '\n\n' +
  'Edit or re-save each script so the runbook compile check runs, or run\n\n' +
  `    ${HOOK}\n\n` +
  'for each one, then retry this commit.';

/**
 * PreToolUse: { deny } with the denial text, { warn } when a staged script
 * cannot be checked because the pipeline's version cannot be read, or null.
 */
export function commitRefusal(command, sessionCwd) {
  const stagedInCall = new Map();
  const interactiveIn = new Set();
  const warnings = [];
  for (const c of gitCommands(command, sessionCwd)) {
    const interactive = stagesInteractively(c.sub, c.args);
    const staging = interactive ? { scope: 'all', paths: [] } : stagingOf(c.sub, c.args);
    if (!staging && c.sub !== 'commit') continue;
    const root = repoOf(c, sessionCwd);
    if (!root) continue;
    const dir = c.dir ?? sessionCwd;
    if (interactive) interactiveIn.add(root);
    if (c.sub !== 'commit') {
      stagedInCall.set(root, [...(stagedInCall.get(root) ?? []), ...scriptsStagedBy(staging, dir)]);
      continue;
    }
    const inCall = [...new Set([...(stagedInCall.get(root) ?? []), ...(staging ? scriptsStagedBy(staging, dir) : [])])].sort();
    if (inCall.length && interactiveIn.has(root)) return { deny: INTERACTIVE(inCall) };
    const ids = stagedScripts(root);
    for (const f of inCall) ids.set(f, existsSync(join(root, f)) ? objectId(root, f) : null);
    if (!ids.size) continue;
    const pipeline = pipelineApiVersion(root);
    if (pipeline.error) {
      warnings.push(`!! The pipeline's anonymous Apex API version cannot be read (${pipeline.error}), so these ` +
        `runbook Apex scripts were not compiled before this commit: ${[...ids.keys()].sort().join(', ')}. ` +
        `Run \`npm install\` in ${root} so the runbook compile check can run.`);
      continue;
    }
    const record = readRecord(root);
    const unchecked = [...ids].filter(([f, id]) => !id || !isRecorded(record, f, id, pipeline.version)).map(([f]) => f).sort();
    if (unchecked.length) return { deny: UNCHECKED(unchecked) };
  }
  return warnings.length ? { warn: warnings.join('\n') } : null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('runbook-compile-check.mjs');
if (isMain) {
  const at = process.argv.indexOf('--check');
  if (at !== -1) {
    const target = process.argv[at + 1];
    const where = target && locate(resolve(target));
    if (!where || !RUNBOOK_SCRIPT.test(where.rel)) {
      console.error(`Not a runbook Apex script in a git repository: ${target ?? '(no file given)'}`);
      process.exit(1);
    }
    const r = await check(where.root, where.rel);
    (r.kind === 'pass' ? console.log : console.error)(r.text);
    process.exit(r.kind === 'pass' ? 0 : 1);
  }

  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

  if (input.hook_event_name === 'PreToolUse') {
    if (input.tool_name !== 'Bash') process.exit(0);
    const r = commitRefusal(input?.tool_input?.command ?? '', input.cwd || process.cwd());
    if (r?.deny) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.deny } });
    if (r?.warn) emit({ systemMessage: r.warn, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.warn } });
    process.exit(0);
  }

  if (input.hook_event_name === 'PostToolUse') {
    const raw = input?.tool_input?.file_path;
    if (!raw) process.exit(0);
    const where = locate(resolve(input.cwd || process.cwd(), raw));
    if (!where || !RUNBOOK_SCRIPT.test(where.rel)) process.exit(0);
    // a failed compile is context, not a block: a block stops Claude's loop, and the commit gate enforces the fix
    context((await check(where.root, where.rel)).text);
  }
  process.exit(0);
}
