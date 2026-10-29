#!/usr/bin/env node
/**
 * Lints LWC and Aura JavaScript, HTML and CSS files with `sf code-analyzer`
 * the way the Jenkins pipeline does (scripts/lib/lwc-code-analyzer.mjs).
 *
 *   PostToolUse, Write|Edit   a write to an in-scope file lints that one file.
 *                             Findings at Moderate or higher block with a
 *                             reason that opens with the work order; a check
 *                             that could not run blocks with a "!! " reason;
 *                             a clean result records the file's git object id
 *                             and prints nothing.
 *   --check <file>...         lints and records files from the command line,
 *                             for files not written through Write or Edit or
 *                             too many for one gate run. Exit 0 when every
 *                             file is clean and recorded, 1 otherwise, with
 *                             the findings or the reason on stderr.
 *
 * Only node: modules are imported at the top. The library and every other
 * plugin module load with a dynamic import() inside the path that needs them,
 * so a path that has nothing to check exits without loading anything.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const STARTED = Date.now();
const LIB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'lib', 'lwc-code-analyzer.mjs');
const CHECK = `node "${fileURLToPath(import.meta.url)}" --check <file>...`;

/** Milliseconds from start to the checker deadline: 15 s under the 90 s PostToolUse timeout; 110 s for --check, under Bash's default 120 s. */
const POST_DEADLINE_MS = 75000;
const CHECK_DEADLINE_MS = 110000;

/** The deadline as milliseconds since the epoch; HEAN_LWC_ANALYZER_DEADLINE_MS replaces the default (tests only). */
function deadlineFrom(ms) {
  const override = Number(process.env.HEAN_LWC_ANALYZER_DEADLINE_MS);
  return STARTED + (override > 0 ? override : ms);
}

const gitOut = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** { root, rel } for a file inside a git repository, root from git and rel with forward slashes; null otherwise. */
function locate(file) {
  let real;
  try { real = realpathSync(file); } catch { return null; }
  const root = gitOut(dirname(real), 'rev-parse', '--show-toplevel');
  if (!root) return null;
  return { root, rel: relative(realpathSync(root), real).split(sep).join('/') };
}

/** Records each file clean by its object id; returns the files git could not hash. */
function recordAll(lib, root, files, sessionId) {
  const key = lib.recordKey(root, sessionId);
  const unhashed = [];
  for (const rel of files) {
    const oid = gitOut(root, 'hash-object', '--', rel);
    if (oid) lib.recordClean(root, rel, oid, key);
    else unhashed.push(rel);
  }
  return unhashed;
}

const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const block = reason => emit({ decision: 'block', reason });
const context = text => emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });

/** The could-not-run text for an exception; written out so it works when the library itself failed to load. */
const COULD_NOT_RUN = '!! The code analyzer check could not run: ';
const crashText = e => `${COULD_NOT_RUN}${e?.message ?? e}`;

/** PostToolUse: lint the one written file; an exception blocks, so the check fails closed. */
async function afterWrite(input) {
  const raw = input?.tool_input?.file_path;
  if (!raw) return;
  const where = locate(resolve(input.cwd || process.cwd(), raw));
  if (!where) return;
  try {
    await lintWritten(input, where);
  } catch (e) {
    block(crashText(e));
  }
}

async function lintWritten(input, where) {
  const lib = await import(LIB);
  if (!lib.IN_SCOPE.test(where.rel)) return;
  const scope = lib.applies(where.root);
  if (!scope.ok) {
    if (scope.note) context(scope.note);
    return;
  }
  const sessionId = input.session_id || 'unknown';
  const result = await lib.analyze(where.root, [where.rel], { deadline: deadlineFrom(POST_DEADLINE_MS), sessionId });
  if (result.kind === 'findings') block(lib.findingsText(lib.labelFindings(where.root, result.findings)));
  if (result.kind !== 'clean')
    block(`${lib.couldNotRunText(result.reason)}\n\nAfter the fix, edit ${where.rel} again or run \`${CHECK}\` so the check re-runs.`);
  const unhashed = recordAll(lib, where.root, [where.rel], sessionId);
  if (unhashed.length) context(`!! ${where.rel} is clean, but git could not hash it, so the clean result was not recorded.`);
}

/** --check: lint and record the given files, grouped by repository. */
async function checkFiles(targets) {
  if (!targets.length) {
    console.error(`No file given. Usage: ${CHECK}`);
    return 1;
  }
  const lib = await import(LIB);
  const byRoot = new Map();
  let failed = false;
  for (const target of targets) {
    const where = locate(resolve(target));
    if (!where || !lib.IN_SCOPE.test(where.rel)) {
      console.error(`Not an LWC or Aura .js, .html or .css file under force-app in a git repository: ${target}`);
      failed = true;
      continue;
    }
    const scope = lib.applies(where.root);
    if (!scope.ok) {
      console.error(scope.note ?? `!! The code analyzer check does not apply: ${where.root} has no sfdx-project.json.`);
      failed = true;
      continue;
    }
    byRoot.set(where.root, [...new Set([...(byRoot.get(where.root) ?? []), where.rel])]);
  }
  const deadline = deadlineFrom(CHECK_DEADLINE_MS);
  const sessionId = `check-${randomUUID()}`;
  for (const [root, files] of byRoot) {
    let result;
    try {
      result = await lib.analyze(root, files, { deadline, sessionId });
      if (result.kind === 'findings') result.text = lib.findingsText(lib.labelFindings(root, result.findings));
    } catch (e) {
      console.error(crashText(e));
      failed = true;
      continue;
    }
    if (result.kind === 'findings') {
      console.error(result.text);
      failed = true;
      continue;
    }
    if (result.kind !== 'clean') {
      console.error(lib.couldNotRunText(result.reason));
      failed = true;
      continue;
    }
    let unhashed;
    try { unhashed = recordAll(lib, root, files, sessionId); } catch (e) {
      console.error(crashText(e));
      failed = true;
      continue;
    }
    for (const rel of unhashed) console.error(`!! ${rel} is clean, but git could not hash it, so the clean result was not recorded.`);
    if (unhashed.length) failed = true;
    for (const rel of files.filter(f => !unhashed.includes(f))) console.log(`${rel} is clean and recorded.`);
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('lwc-code-analyzer-check.mjs');
if (isMain) {
  const at = process.argv.indexOf('--check');
  if (at !== -1) process.exit(await checkFiles(process.argv.slice(at + 1)));

  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (input.hook_event_name === 'PostToolUse') await afterWrite(input);
  process.exit(0);
}
