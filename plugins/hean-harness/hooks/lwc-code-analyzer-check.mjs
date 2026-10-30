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
 *   PreToolUse, Bash          a `git commit` or `git push` whose recorded or
 *                             pushed in-scope files are not all recorded clean
 *                             is linted; findings, or a check that could not
 *                             run, deny it. A commit takes its files from the
 *                             index it records (scripts/lib/commit-index.mjs);
 *                             a push takes the files of the pushed commits on
 *                             no remote-tracking branch, at their content in
 *                             each pushed tip. Content that differs from the
 *                             working copy cannot be linted and is refused.
 *                             Any command that is not a commit or push exits
 *                             before anything loads: the handler has
 *                             "onFailure": "block", so a crash there would
 *                             refuse every git command.
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
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const STARTED = Date.now();
const LIB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'lib', 'lwc-code-analyzer.mjs');
const CHECK = `node "${fileURLToPath(import.meta.url)}" --check <file>...`;

/** Milliseconds from start to the checker deadline: 15 s under the 90 s PostToolUse timeout; 20 s under the 150 s PreToolUse timeout; 110 s for --check, under Bash's default 120 s. */
const POST_DEADLINE_MS = 75000;
const PRE_DEADLINE_MS = 130000;
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
  // checked before the library loads, so its failure never blocks a write outside an SFDX repository
  if (!where || !existsSync(join(where.root, 'sfdx-project.json'))) return;
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

/** Whether the command text can hold a git commit or push; read before anything loads. */
const mayGate = command => command.includes('git') && (command.includes('commit') || command.includes('push'));

const fileList = files => files.map(f => `    ${f}`).join('\n');

const UNSTAGED = files =>
  '!! The code analyzer check reads the working copy, and the staged content of these files differs from it ' +
  'and has not been checked:\n\n' + fileList(files) + '\n\nTo have it checked, stage the whole file (`git add <file>`), then retry this commit.';

const UNPUSHABLE = files =>
  '!! The code analyzer check reads the working copy, and the pushed content of these files differs from it ' +
  'and has not been checked:\n\n' + fileList(files) + '\n\nCommit or stash the change, so the pushed content can be ' +
  'checked, or check out the branch being pushed, then retry this push.';

const quoted = words => words.map(w => `\`${w}\``).join(', ');
const NAME_IT = 'Name the branch or commit literally, as in `git push origin my-branch`, then retry this push.';

const UNNAMED_PUSH = words =>
  '!! The code analyzer check cannot tell what this push sends: its remote or refspec uses a variable or a glob, or a brace the shell can expand (' +
  quoted(words) + `). ${NAME_IT}`;

const CONFIGURED_PUSH = (name, values) =>
  `!! The code analyzer check cannot tell what this push sends: \`${name}\` is set to ${quoted(values)}, which names no single branch or commit. ${NAME_IT}`;

const NO_COMMIT = revs =>
  `!! The code analyzer check cannot tell what this push sends: ${quoted(revs)} names no commit in this repository. ` +
  'Correct the branch or commit name, then retry this push.';

/**
 * Whether the shell passes the word to git as typed: not when a variable or
 * glob decides it, nor when it holds a brace, which the shell can expand into
 * several words (`{feat,feat2}`). Stricter than isLiteral, which other gates
 * share.
 */
const named = (isLiteral, word) => isLiteral(word) && !word.includes('{');

const NOT_NAMED = '!! The code analyzer check did not run for this commit: the command stages files its text does not name ' +
  '(a variable, a glob, a pathspec file or picked hunks). Stage the files in their own Bash call, then commit.';

/** The deny text for a check that could not run; a passed deadline names --check so the files can be checked in parts. */
function couldNotRunRefusal(lib, reason, what) {
  const next = /deadline/.test(reason)
    ? `The files may be too many for one run. Check them in parts with \`${CHECK}\`, which records each clean file, then retry this ${what}.`
    : `After the fix, retry this ${what}, or check the files first with \`${CHECK}\`.`;
  return `${lib.couldNotRunText(reason)}\n\n${next}`;
}

/**
 * Judges the files a commit records or a push sends, items being
 * { rel, oid } with oid the content committed or pushed: { deny } or null.
 * A recorded file passes; an unrecorded one whose working copy holds the same
 * content is linted, with the others, in one run; any other is refused.
 */
async function judge(lib, tryGit, root, items, what, sessionId, labelOptions = () => ({})) {
  if (!items.length) return null;
  const key = lib.recordKey(root, sessionId);
  const toRun = new Set(), unlike = new Set();
  for (const { rel, oid } of items) {
    if (lib.isRecordedClean(root, rel, oid, key)) continue;
    if (tryGit(root, 'hash-object', '--', rel) === oid) toRun.add(rel);
    else unlike.add(rel);
  }
  if (unlike.size) return { deny: (what === 'commit' ? UNSTAGED : UNPUSHABLE)([...unlike].sort()) };
  if (!toRun.size) return null;
  const files = [...toRun].sort();
  const result = await lib.analyze(root, files, { deadline: deadlineFrom(PRE_DEADLINE_MS), sessionId });
  if (result.kind === 'findings') return { deny: lib.findingsText(lib.labelFindings(root, result.findings, labelOptions())) };
  if (result.kind !== 'clean') return { deny: couldNotRunRefusal(lib, result.reason, what) };
  const after = lib.recordKey(root, sessionId);
  for (const { rel, oid } of items) if (toRun.has(rel)) lib.recordClean(root, rel, oid, after);
  return null;
}

/**
 * PreToolUse: { deny } with the refusal text, { warn } with "!!" lines when a
 * commit or push could not be judged, or null. Exceptions propagate; the
 * caller refuses on them, so the gate fails closed.
 */
export async function gateRefusal(command, sessionCwd, sessionId) {
  if (!mayGate(command)) return null;
  // the library loads only for a repository with sfdx-project.json, so its failure never refuses a commit elsewhere
  const [{ commitsIn, commitIndex }, { git, gitCommands, isLiteral, repoOf, tryGit }, { configuredPush, MATCHING, pushTargets, pushWords }, { operationInProgress }, { isSfdxRepo }] =
    await Promise.all([
      import('../scripts/lib/commit-index.mjs'),
      import('../scripts/lib/command-line.mjs'),
      import('./git-identity-guard.mjs'),
      import('../scripts/lib/manifest-check.mjs'),
      import('../scripts/lib/paths.mjs')
    ]);
  const warnings = [];
  let lib;
  const applies = async root => {
    if (!isSfdxRepo(root)) return false;
    lib ??= await import(LIB);
    const scope = lib.applies(root);
    if (!scope.ok && scope.note) warnings.push(scope.note);
    return scope.ok;
  };
  const lines = text => (text ?? '').split('\n').filter(Boolean);

  for (const { root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    if (!isSfdxRepo(root) || operationInProgress(root) || !(await applies(root))) continue;
    if (unknown) { warnings.push(NOT_NAMED); continue; }
    const index = commitIndex(root, earlier, own, byPath);
    let items;
    try {
      const env = { ...process.env, GIT_INDEX_FILE: index.file };
      const names = tryGit(root, '-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '--diff-filter=AMR', { env });
      if (names === null) throw new Error('git could not list the files this commit records');
      items = lines(names).filter(rel => lib.IN_SCOPE.test(rel)).map(rel => {
        const oid = tryGit(root, 'rev-parse', `:${rel}`, { env });
        if (!oid) throw new Error(`git could not read ${rel} from the index this commit records`);
        return { rel, oid };
      });
    } finally {
      index.cleanup();
    }
    const r = await judge(lib, tryGit, root, items, 'commit', sessionId);
    if (r) return r;
  }

  for (const c of gitCommands(command, sessionCwd)) {
    if (c.sub !== 'push') continue;
    const target = pushTargets(c.args);
    if (!target.sends) continue;
    const root = repoOf(c, sessionCwd);
    if (!root || !(await applies(root))) continue;
    const words = pushWords(c.args);
    const unnamed = [
      ...(words.remote === undefined || named(isLiteral, words.remote) ? [] : [words.remote]),
      ...words.refspecs.filter(spec => !named(isLiteral, spec) || !isLiteral(spec.replace(/^\+/, '').split(':')[0]))
    ];
    if (unnamed.length) return { deny: UNNAMED_PUSH(unnamed) };
    // the analyzer lints every branch for a matching push, not only those the remote has
    const revs = new Set(target.revs.map(rev => rev === MATCHING ? '--branches' : rev));
    // with no typed refspec, git sends what remote.<remote>.push or push.default=matching names, not only HEAD
    const configured = configuredPush(root, words);
    if (configured.unnamed.length) return { deny: CONFIGURED_PUSH(configured.name, configured.unnamed) };
    for (const rev of configured.revs) revs.add(rev === MATCHING ? '--branches' : rev);
    const tips = new Set(), missing = [];
    for (const rev of revs) {
      // --branches and --tags name every branch or tag; any other revision names one commit, and git refuses a push of one that does not exist
      if (rev.startsWith('--')) { for (const tip of lines(tryGit(root, 'rev-parse', rev))) tips.add(tip); continue; }
      const tip = tryGit(root, 'rev-parse', '--verify', '-q', `${rev}^{commit}`);
      if (tip) tips.add(tip);
      else missing.push(rev);
    }
    if (missing.length) return { deny: NO_COMMIT(missing) };
    const items = new Map();
    for (const tip of tips) {
      // the walk has no remote-tracking branch to stop at on a first push, so it gets the time left before the deadline
      const ms = deadlineFrom(PRE_DEADLINE_MS) - Date.now();
      let changed;
      try {
        if (ms <= 0) throw Object.assign(new Error('the deadline passed'), { code: 'ETIMEDOUT' });
        // --cc also lists the files a merge commit's conflict resolution changes, which plain --name-only leaves out
        changed = git(root, '-c', 'core.quotePath=false', 'log', '--cc', '--name-only', '--diff-filter=AMR', '--format=', tip, '--not', '--remotes',
          { timeout: ms, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
      } catch (e) {
        if (e.code === 'ETIMEDOUT') return { deny: couldNotRunRefusal(lib, 'the deadline passed while git was listing the files the pushed commits change', 'push') };
        throw new Error(`git could not list the files the pushed commits at ${tip} change`);
      }
      for (const rel of new Set(lines(changed).filter(f => lib.IN_SCOPE.test(f)))) {
        const oid = tryGit(root, 'rev-parse', '--verify', '-q', `${tip}:${rel}`);
        if (oid) items.set(`${rel}\0${oid}`, { rel, oid });   // a file deleted again by the tip is not pushed
      }
    }
    const r = await judge(lib, tryGit, root, [...items.values()], 'push', sessionId, () => ({ pushBase: lib.pushBase(root, [...tips], deadlineFrom(PRE_DEADLINE_MS)) }));
    if (r) return r;
  }
  return warnings.length ? { warn: warnings.join('\n') } : null;
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
  if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'Bash') {
    const command = input?.tool_input?.command ?? '';
    if (!mayGate(command)) process.exit(0);
    let r;
    try { r = await gateRefusal(command, input.cwd || process.cwd(), input.session_id || 'unknown'); }
    catch (e) { r = { deny: crashText(e) }; }
    if (r?.deny) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.deny } });
    if (r?.warn) emit({ systemMessage: r.warn, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.warn } });
  }
  process.exit(0);
}
