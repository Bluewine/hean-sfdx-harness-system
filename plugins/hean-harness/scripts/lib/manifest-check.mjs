/**
 * Checks that a commit records an up-to-date per-story manifest,
 * .claude/manifest/<WORK-ID>.xml: the components the commit's tree changes
 * since the branch's merge-base, as branch-manifest --from-index lists them.
 *
 * Shared by the Claude Code hook (hooks/manifest-commit-check.mjs), which
 * builds the index the commit will record before the command runs, and the git
 * pre-commit hook, where git has already built it. Setup copies this file, the
 * five libraries it imports and branch-manifest.mjs, in the plugin's own
 * layout, to <config>/hean-harness/hooks/, because the plugin's folder moves
 * on every update and a git hook pointing there would break. So this file
 * imports only command-line.mjs, merge-base.mjs, paths.mjs, settings.mjs and
 * shell.mjs, and finds branch-manifest.mjs relative to itself. --git-hook runs it as git's
 * pre-commit hook (assets/githooks/pre-commit).
 *
 * A stale manifest is never rewritten in the repository. The rebuilt file is
 * written under <config>/hean-harness/manifest-check/ and the refusal names
 * the command that copies it into place. Another check may refuse the same
 * commit, and a manifest written for a commit that never happens is a change
 * nobody asked for.
 *
 * When the check cannot run (no sf, no base branch, a rebuild past the
 * deadline) the commit goes through with a "!!" line naming the reason. A
 * manifest left unchecked is caught at the next commit or by the pull request
 * skills; a commit refused because a tool is missing blocks all work.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryGit } from './command-line.mjs';
import { MAX_BUFFER, WORK_ID } from './merge-base.mjs';
import { claudeDir } from './paths.mjs';
import { settingsFile } from './settings.mjs';
import { shQuote } from './shell.mjs';

const BRANCH_MANIFEST = fileURLToPath(new URL('../../skills/branch-manifest/scripts/branch-manifest.mjs', import.meta.url));
// Hotfix and back-merge branches (uat-hotfix names them) do not carry their own story manifest.
const SKIPPED_BRANCH = /-(HF|BM)$|^hotfix-/;
// A commit made while one of these is in progress records work taken from elsewhere, not this story's.
const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

/** How long the check may take. Claude Code stops the hook at 60 seconds; this ends first and says so. Tests shorten it. */
export const DEADLINE_MS = Number(process.env.HEAN_MANIFEST_CHECK_DEADLINE_MS) || 50_000;

export const deadlineText = () => {
  const s = Math.round(DEADLINE_MS / 1000);
  return `${s} second${s === 1 ? '' : 's'}`;
};

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The per-story manifest was not checked: ${String(reason).replace(/\.$/, '')}.`;

/** git's environment reading the given index, or the repository's own when none is given. */
function indexEnv(indexFile) {
  const env = { ...process.env };
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  else delete env.GIT_INDEX_FILE;
  return env;
}

/** A file's content as the index holds it, untrimmed, or null when the index has no such file. */
function indexBlob(root, rel, env) {
  const r = spawnSync('git', ['-C', root, 'show', `:${rel}`], { env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The manifest a commit in this repository must keep current, { id, rel }, or
 * null when commits here are not checked: no sfdx-project.json, setup never
 * ran here (no .claude/hean-harness.json in the main checkout), no work ID in
 * the branch name, a hotfix or back-merge branch, a merge, cherry-pick, revert
 * or rebase in progress, or a manifest git ignores.
 */
export function manifestTarget(root) {
  if (!existsSync(join(root, 'sfdx-project.json'))) return null;
  if (!existsSync(settingsFile(root))) return null;
  const branch = tryGit(root, 'branch', '--show-current');
  const id = branch ? WORK_ID.exec(branch)?.[0] : null;
  if (!id || SKIPPED_BRANCH.test(branch)) return null;
  for (const name of IN_PROGRESS) {
    const p = tryGit(root, 'rev-parse', '--git-path', name);
    if (p && existsSync(resolve(root, p))) return null;
  }
  const rel = `.claude/manifest/${id}.xml`;
  // check-ignore exits 0 when ignored, which tryGit returns as ''; --no-index so a tracked manifest counts too
  if (tryGit(root, 'check-ignore', '-q', '--no-index', rel) !== null) return null;
  return { id, rel };
}

/** The items under one section heading of branch-manifest's output. */
function section(out, title) {
  const lines = out.split('\n');
  const at = lines.findIndex(l => l.startsWith(`${title} (`));
  const items = [];
  for (let i = at + 1; at >= 0 && i < lines.length && lines[i].startsWith('  '); i++) items.push(lines[i].trim());
  return items;
}

/**
 * Compare the manifest the commit records with a rebuild from the same index.
 * The committed copy is put in the scratch folder first, so branch-manifest's
 * own comparison says unchanged, updated or created and lists what was added
 * and dropped.
 */
export function checkManifest({ root, target, indexFile = null, deadline = Date.now() + DEADLINE_MS }) {
  const env = indexEnv(indexFile);
  let dirs;
  try {
    dirs = JSON.parse(readFileSync(join(root, 'sfdx-project.json'), 'utf8')).packageDirectories.map(d => d.path);
  } catch (e) {
    return { kind: 'unchecked', reason: `sfdx-project.json could not be read (${e.message})` };
  }
  const changed = spawnSync('git', ['-C', root, 'diff', '--cached', '--name-only', 'HEAD', '--', ...dirs],
                            { env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (changed.status !== 0 || !changed.stdout.trim()) return { kind: 'skip' };

  const committed = indexBlob(root, target.rel, env);
  const scratch = mkdtempSync(join(tmpdir(), 'manifest-check-'));
  try {
    const file = join(scratch, `${target.id}.xml`);
    if (committed !== null) writeFileSync(file, committed);
    const late = { kind: 'unchecked', reason: `the rebuild took longer than ${deadlineText()}` };
    const left = deadline - Date.now();
    if (left <= 0) return late;
    const r = spawnSync(process.execPath,
      [BRANCH_MANIFEST, '--from-index', '--name', target.id, '--output-dir', scratch],
      { cwd: root, env, encoding: 'utf8', timeout: left, maxBuffer: MAX_BUFFER });
    if (r.error?.code === 'ETIMEDOUT' || r.signal) return late;
    if (r.error) return { kind: 'unchecked', reason: `branch-manifest could not run (${r.error.message})` };
    const out = r.stdout ?? '';
    const first = out.split('\n')[0];
    if (first.startsWith('Error: ')) return { kind: 'unchecked', reason: first.slice('Error: '.length) };
    const status = /^Manifest: .* (created|updated|unchanged|not written)/.exec(first)?.[1];
    if (!status) return { kind: 'unchecked', reason: `branch-manifest printed no result (${first || 'no output'})` };
    if (status === 'unchanged') return { kind: 'current' };
    if (status === 'not written') return committed === null ? { kind: 'current' } : { kind: 'empty' };
    return {
      kind: 'stale',
      xml: readFileSync(file, 'utf8'),
      added: section(out, status === 'created' ? 'Components' : 'Added since the previous version of the file'),
      dropped: section(out, 'Dropped since the previous version of the file')
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Write the rebuilt manifest outside the repository, to
 * <config>/hean-harness/manifest-check/<repo-hash>/<WORK-ID>.xml, and return
 * that path for the refusal's copy command.
 */
export function writeManifest(root, target, xml) {
  const dir = join(claudeDir(), 'hean-harness', 'manifest-check',
                   createHash('sha1').update(root).digest('hex').slice(0, 12));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${target.id}.xml`);
  writeFileSync(file, xml);
  return file;
}

/**
 * The command that puts a stale result's rebuilt file (scratchFile) in place
 * and stages it, or removes an empty result's manifest, forced, because the
 * file is generated and a local edit would stop `git rm`. It names the
 * repository, so it works from any folder.
 */
export function stageCommand(root, target, kind, scratchFile) {
  const file = join(root, target.rel);
  if (kind === 'empty') return `git -C ${shQuote(root)} rm -f ${target.rel}`;
  return `${existsSync(dirname(file)) ? '' : `mkdir -p ${shQuote(dirname(file))} && `}` +
    `cp ${shQuote(scratchFile)} ${shQuote(file)} && git -C ${shQuote(root)} add ${target.rel}`;
}

/**
 * The refusal for a stale or empty result. next is the exact command to run
 * first, in its own Bash call; retry, when given, is the commit to run after
 * it (a commit by path, which must name the manifest). terminal words it for
 * git's pre-commit hook, where the commit is the user's own and no retry can
 * be printed. restaged says the refused call ran its own git add before the
 * commit, which never ran either, so the retry is the whole call, not the
 * commit alone.
 */
export function refusalText(target, result, next, retry = null, { terminal = false, restaged = false } = {}) {
  const again = restaged ? 'run the same call again, including its git add,' : 'run the commit again';
  const commit = retry
    ? `Then ${again} with the manifest named, as a separate call:\n\n    ${retry}`
    : `Then ${again} as a separate call.`;
  const why = 'Do not chain them: one call that runs both is checked before its first command runs, so the check still sees the old manifest.';
  const steps = terminal
    ? `Run this:\n\n    ${next}\n\nthen commit again. A commit that names its paths needs ${target.rel} among them too.`
    : `Run this in its own Bash call:\n\n    ${next}\n\n${commit}\n\n${why}`;
  if (result.kind === 'empty') {
    return `!! The per-story manifest ${target.rel} has nothing left to list for this commit. ` +
           `Remove it in this commit. ${steps}`;
  }
  const list = (title, items) => items.length ? `\n\n${title}:\n${items.map(i => `    ${i}`).join('\n')}` : '';
  return `!! The per-story manifest ${target.rel} is out of date for this commit. ` +
         `The rebuilt file is outside the repository; copy it into place and add it to the commit. ${steps}` +
         list('Added', result.added) + list('Dropped', result.dropped);
}

/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records and named it in GIT_INDEX_FILE, for -a and a commit by path too, so
 * nothing is read from a command line. Exit 3 refuses the commit, and the
 * shell hook turns it into git's 1; any other code, a crash's 1 included, lets
 * the commit through. Every message goes to standard error, which git shows. As in Claude Code, nothing is
 * written into the repository. A failure of the check itself lets the commit
 * through, as every other "cannot run" case does.
 */
if (process.argv[1] && basename(process.argv[1]) === 'manifest-check.mjs' && process.argv.includes('--git-hook')) {
  try {
    // git names the index relative to the top of the working tree, where it starts the hook; the calls below use -C
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    const root = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
    const target = root && manifestTarget(root);
    if (!target) process.exit(0);
    const result = checkManifest({ root, target, indexFile: process.env.GIT_INDEX_FILE ?? null });
    if (result.kind === 'unchecked') { process.stderr.write(`${notChecked(result.reason)}\n`); process.exit(0); }
    if (result.kind !== 'stale' && result.kind !== 'empty') process.exit(0);
    const scratchFile = result.kind === 'stale' ? writeManifest(root, target, result.xml) : null;
    const next = stageCommand(root, target, result.kind, scratchFile);
    process.stderr.write(`${refusalText(target, result, next, null, { terminal: true })}\n`);
    process.exit(3);
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    process.exit(0);
  }
}
