#!/usr/bin/env node
/**
 * Install manifest for hean-harness.
 *
 * Every change setup makes to the user's machine is recorded here so that
 * uninstall can reverse exactly those changes and nothing else.
 *
 * Lives outside the plugin directory on purpose: ${CLAUDE_PLUGIN_ROOT} moves
 * when the plugin updates, and uninstall must still work after the plugin
 * itself has been removed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync,
         rmSync, readdirSync, rmdirSync, renameSync, statSync, lstatSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { claudeDir } from './paths.mjs';
import { trackedUnder } from './gitignore.mjs';

export const STATE_DIR = join(claudeDir(), 'hean-harness');
export const MANIFEST = join(STATE_DIR, 'install-manifest.json');
const BACKUP_DIR = join(STATE_DIR, 'backups');

/** Change types and how each one is reversed. */
const REVERSIBLE = {
  'file-copy':    'Restore the backup, or delete the file if it did not exist before.',
  'marker-block': 'Strip the marked block out of the file, leaving the rest untouched.',
  'json-key':     'Restore the previous value, or remove the key if it was absent before.',
  'dir-create':   'Remove the directory, but only if it is still empty.',
  'git-config':   'Restore the previous value in the repository, or unset the key if it had none.',
  'repo-folder':  'Empty the repository\'s .claude folder except .claude/manifest/ and files git tracks. Uninstall only.',
  'repo-file':    'Delete the repository\'s .mcp.json unless git tracks it. Uninstall only.',
  'external':     'Run the recorded plugin or marketplace removal on uninstall; anything else is reported.'
};

export function load() {
  if (!existsSync(MANIFEST)) {
    return { schema: 1, plugin: 'hean-harness', version: null,
             installedAt: null, changes: [] };
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

export function save(m) {
  mkdirSync(STATE_DIR, { recursive: true });
  // Write beside the manifest and rename over it. A rename within one directory
  // is atomic, so a reader never sees a half-written file and a process killed
  // mid-write leaves the previous manifest intact rather than a truncated one.
  const tmp = `${MANIFEST}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
  renameSync(tmp, MANIFEST);
}

const LOCK = join(STATE_DIR, 'manifest.lock');
const LOCK_STALE_MS = 30_000;

/**
 * Run fn while holding the manifest lock.
 *
 * Creating a directory is the one filesystem operation that both succeeds for
 * exactly one caller and fails for the rest, on every platform, so it is the
 * lock. Without it two setups running at once each read the manifest, each add
 * their own entry, and whichever saves last erases the other's — leaving files
 * changed on disk that uninstall will never reverse.
 *
 * A lock older than 30 seconds belonged to a process that died holding it, and
 * is broken rather than waited on.
 */
function withLock(fn) {
  mkdirSync(STATE_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try { mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { age = Infinity; }
      if (age > LOCK_STALE_MS) { try { rmSync(LOCK, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() > deadline) {
        throw new Error(
          `Another setup is still running: ${LOCK} has been held for ${Math.round(age / 1000)}s. ` +
          `Wait for it to finish, or remove that directory if no setup is running.`);
      }
      // busy-wait briefly; this lock is held for a single read-modify-write
      const until = Date.now() + 25;
      while (Date.now() < until) { /* spin */ }
    }
  }
  try { return fn(); } finally { try { rmSync(LOCK, { recursive: true, force: true }); } catch {} }
}

/**
 * Copy a file aside before we touch it. Returns the backup path.
 *
 * Named after the file itself plus a short hash of its full path, so two
 * files with the same name never collide and the name stays short. Encoding
 * the whole path into the name instead would eventually pass the 255-byte
 * filename limit and the backup would fail to write.
 */
export function backup(target) {
  if (!existsSync(target)) return null;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = createHash('sha1').update(target).digest('hex').slice(0, 7);
  const dest = join(BACKUP_DIR, `${basename(target)}.${tag}.${stamp}`);
  copyFileSync(target, dest);
  return dest;
}

// <plugin>/scripts/lib/manifest.mjs -> <plugin>
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * The version of the plugin running this script, read from its own plugin.json,
 * so the manifest names the version that actually installed and cannot fall out
 * of step with a literal kept in each installer.
 */
export function pluginVersion() {
  try { return JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; }
  catch { return null; }
}

/**
 * Create the manifest header when it is missing. The version is set here only
 * for a new manifest: scripts outside setup, such as the commit format switch,
 * also call this, and must not make the manifest claim a setup that never ran.
 */
export function init(version) {
  const m = load();
  if (version) m.version = version;
  else if (!m.version) m.version = pluginVersion();
  m.installedAt = m.installedAt || new Date().toISOString();
  save(m);
  return m;
}

/**
 * Record a completed setup run: the plugin version that ran it and when.
 * installedAt keeps the first install; lastSetupAt moves with every run, so
 * doctor can tell whether the rules and memories on disk came from the plugin
 * installed now.
 */
export function markSetupRun() {
  if (!existsSync(MANIFEST)) return null;
  return withLock(() => {
    const m = load();
    m.version = pluginVersion() ?? m.version;
    m.lastSetupAt = new Date().toISOString();
    save(m);
    return m;
  });
}

/**
 * Record one change. Re-recording the same type+target replaces the earlier
 * entry rather than appending, so re-running setup never grows the manifest.
 * The original backup is preserved — it represents the true pre-install state.
 */
// What a change must remember about the state it replaced. On a second setup
// the machine no longer holds the user's original — it holds ours — so these
// fields are taken from the first recording and never overwritten. Losing
// `previousValue` this way replaced a user's own status line with the plugin's
// on uninstall, because the second run read our value as though it were theirs.
const RESTORE_FIELDS = ['backup', 'existedBefore', 'previousValue', 'fileExisted'];

export function record(change) {
  if (!REVERSIBLE[change.type]) {
    throw new Error(`Unknown change type: ${change.type}`);
  }
  return withLock(() => {
    const m = load();
    const i = m.changes.findIndex(c => c.type === change.type && c.target === change.target);
    if (i >= 0) {
      const first = m.changes[i];
      // `in` rather than a truthiness test: a previous value of null, false, 0
      // or undefined is still the value to put back.
      for (const k of RESTORE_FIELDS) if (k in first) change[k] = first[k];
      change.recordedAt = first.recordedAt;
      change.updatedAt = new Date().toISOString();
      m.changes[i] = change;
    } else {
      change.recordedAt = new Date().toISOString();
      m.changes.push(change);
    }
    save(m);
    return change;
  });
}

/**
 * The lines that open and close a managed block.
 *
 * Two styles, because the comment character differs by file type. "hash" is
 * for shell startup files. "html" is for markdown, where a # would render as
 * a heading instead of disappearing.
 *
 * The writer and the remover both call this, so they can never disagree.
 */
export function markers(marker, style = 'hash') {
  return style === 'html'
    ? { open: `<!-- >>> ${marker} >>> -->`, close: `<!-- <<< ${marker} <<< -->` }
    : { open: `# >>> ${marker} >>>`,        close: `# <<< ${marker} <<<` };
}

/**
 * Build a managed block, including the blank line that separates it from
 * whatever comes before. That blank line is removed along with the block.
 */
export function block(marker, body, style = 'hash') {
  const { open, close } = markers(marker, style);
  const note = style === 'html'
    ? `<!-- Added by the ${marker} plugin. Anything written inside this block is replaced when setup runs. -->`
    : `# Added by the ${marker} plugin. Anything written inside this block is replaced when setup runs.`;
  return `\n${open}\n${note}\n${body}\n${close}\n`;
}

/**
 * Find a managed block without changing anything.
 *
 * Returns null when there is none. Throws when the file cannot be edited
 * safely: an opening marker with no closing marker, where treating "no close"
 * as "to end of file" would discard everything the user wrote below it, or two
 * opening markers, where which lines belong to the block is a guess.
 */
export function findBlock(file, marker, style = 'hash') {
  if (!existsSync(file)) return null;
  const { open, close } = markers(marker, style);
  const lines = readFileSync(file, 'utf8').split('\n');
  const opens = lines.flatMap((l, i) => (l.trim() === open ? [i] : []));
  if (!opens.length) return null;
  if (opens.length > 1) {
    throw new Error(
      `${file} has ${opens.length} opening ${marker} markers, on lines ${opens.map(i => i + 1).join(', ')}. ` +
      `Refusing to edit it, because which lines belong to the block cannot be told apart. ` +
      `Delete the extra blocks by hand.`);
  }
  const start = opens[0];
  const end = lines.findIndex((l, i) => i > start && l.trim() === close);
  if (end < 0) {
    throw new Error(
      `${file} has an opening ${marker} marker with no closing marker. ` +
      `Refusing to edit it, because everything below the opening marker would be lost. ` +
      `Restore the closing line "${close}", or delete the block by hand.`);
  }
  return { lines, start, end, text: lines.slice(start, end + 1).join('\n') };
}

/**
 * Remove a marker-delimited block from a file, leaving everything else alone.
 *
 * Surgical removal rather than restoring the backup: a developer may have
 * edited the same file after install, and restoring would destroy that work.
 * The block may sit at the top, in the middle or at the end of the file.
 *
 * Only the block's own lines go, plus the one blank line the writer puts
 * before the opening marker. Every other byte is kept, including blank lines
 * at the end of the file. The written result is read back and compared; on a
 * mismatch the original content is put back and the call throws.
 *
 * backupFirst copies the file aside before editing and returns the copy's path.
 */
export function stripBlock(file, marker, style = 'hash', { backupFirst = false } = {}) {
  const found = findBlock(file, marker, style);
  if (!found) return { found: false, backup: null };
  const { lines, start, end } = found;

  const out = [...lines.slice(0, start), ...lines.slice(end + 1)];
  // the writer puts one blank separator line before the opening marker
  if (start > 0 && out[start - 1] !== undefined && out[start - 1].trim() === '') out.splice(start - 1, 1);
  const before = lines.join('\n');
  const after = out.join('\n');

  const saved = backupFirst ? backup(file) : null;
  writeFileSync(file, after);
  if (readFileSync(file, 'utf8') !== after) {
    writeFileSync(file, before);
    throw new Error(`${file} did not read back as written. The original content was put back.`);
  }
  return { found: true, backup: saved };
}

export function setJsonKey(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
    node = node[p];
  }
  if (value === undefined) delete node[parts.at(-1)];
  else node[parts.at(-1)] = value;
}

export function getJsonKey(obj, path) {
  return path.split('.').reduce((n, p) => (n == null ? undefined : n[p]), obj);
}

/** Which keep category a change falls in, or null when it has none. */
export function category(c) {
  if (c.type === 'repo-folder' || c.type === 'repo-file') return 'uninstall-only';
  if (c.type === 'external' && runnableUndo(c.undoHint)) return 'uninstall-only';
  if (c.type === 'marker-block') return 'blocks';
  if (c.type === 'git-config' && c.key === 'core.hooksPath') return 'githooks';
  if (/[\\/]\.githooks([\\/]|$)/.test(String(c.target))) return 'githooks';
  return null;
}

/**
 * Reverse every recorded change, newest first. Never throws on one failure.
 *
 * A repository's .claude folder is deleted after everything else, so a backup
 * restored into it earlier in the loop never fails for want of the folder.
 *
 * keep is for the revert setup runs before reinstalling. Each category named in
 * it is skipped, and its entries stay in the manifest for uninstall:
 *
 *   uninstall-only  the repository's .claude folder and .mcp.json, and the plugin
 *                   removals. Deleting the folder would take the skill output a
 *                   clone has built up; removing superpowers would only have it
 *                   installed again.
 *   blocks          marked blocks. Setup replaces each one where it sits, so the
 *                   alias stays where the user put it in their startup file.
 *   githooks        the commit-msg hook and core.hooksPath. The repository may
 *                   have come to rely on the hook, so a reinstall replaces it
 *                   only when asked.
 *
 * only, when given, limits the revert to the entries it returns true for. The
 * rest are left untouched in the manifest. Turning the commit format off uses it
 * to undo the hook alone.
 */
export function revert({ dryRun = false, keep = [], only = null } = {}) {
  const m = load();
  const results = [];
  const mcpFileRecorded = m.changes.some(c => c.type === 'repo-file' && basename(c.target) === '.mcp.json');
  const newestFirst = [...m.changes].reverse();
  const ordered = [...newestFirst.filter(c => c.type !== 'repo-folder'),
                   ...newestFirst.filter(c => c.type === 'repo-folder')];
  for (const c of ordered) {
    const r = { type: c.type, target: c.target, action: null, ok: true, note: null };
    if (keep.includes(category(c)) || (only && !only(c))) {
      r.action = 'kept'; r.kept = true; results.push(r); continue;
    }
    try {
      switch (c.type) {
        case 'file-copy':
          // A file git tracks belongs to the repository now, whoever wrote it first.
          if (tracked(c.target)) { r.action = 'kept'; r.note = 'git tracks this file; left as it is'; break; }
          if (c.existedBefore && c.backup && existsSync(c.backup)) {
            r.action = 'restore backup';
            if (!dryRun) copyFileSync(c.backup, c.target);
          } else if (!c.existedBefore) {
            r.action = 'delete file';
            if (!dryRun && existsSync(c.target)) rmSync(c.target);
          } else {
            r.ok = false; r.note = 'backup missing; left in place';
          }
          break;
        case 'marker-block':
          r.action = c.existedBefore === false
            ? `strip block "${c.marker}", then remove the file if we created it and nothing else is in it`
            : `strip block "${c.marker}"`;
          if (dryRun) {
            const b = findBlock(c.target, c.marker, c.style);
            if (b) { r.lines = `${b.start + 1}-${b.end + 1} of ${b.lines.length}`; r.preview = b.text; }
            else r.note = 'block already absent';
          } else {
            const { found, backup: saved } = stripBlock(c.target, c.marker, c.style,
                                                       { backupFirst: true });
            if (!found) r.note = 'block already absent';
            if (saved) r.backup = saved;
            // we created this file; drop it only if the user put nothing in it
            if (c.existedBefore === false && existsSync(c.target)) {
              if (readFileSync(c.target, 'utf8').trim() === '') rmSync(c.target);
              else r.note = 'file kept — it holds content added after setup';
            }
          }
          break;
        case 'json-key':
          r.action = c.existedBefore ? 'restore previous value' : 'remove key';
          if (!dryRun && existsSync(c.target)) {
            const j = JSON.parse(readFileSync(c.target, 'utf8'));
            setJsonKey(j, c.key, c.existedBefore ? c.previousValue : undefined);
            // we created this file; drop it only when nothing is left in it
            if (c.fileExisted === false && Object.keys(j).length === 0) rmSync(c.target);
            else writeFileSync(c.target, JSON.stringify(j, null, 2) + '\n');
          }
          break;
        case 'dir-create':
          r.action = 'remove if empty';
          if (!dryRun && existsSync(c.target) && readdirSync(c.target).length === 0) {
            rmdirSync(c.target);
          } else if (existsSync(c.target) && readdirSync(c.target).length) {
            r.note = 'not empty; kept';
            // Before a reinstall the folder may hold a kept file. Setup finds the
            // folder there and does not record it again, so the entry stays, or
            // uninstall would leave the emptied folder behind.
            if (keep.length) r.kept = true;
          }
          break;
        case 'git-config':
          // The repository's own hooks live in that folder, so the setting is the repository's.
          if (c.key === 'core.hooksPath' && existsSync(c.target) && trackedUnder(c.target, c.value ?? '.githooks')) {
            r.action = 'kept'; r.note = 'the repository tracks its hooks there; left as it is'; break;
          }
          r.action = c.existedBefore ? `set ${c.key} back to ${c.previousValue}` : `unset ${c.key}`;
          if (!dryRun) {
            if (!existsSync(c.target)) { r.note = 'repository is gone'; break; }
            // --unset exits 5 when the key is already gone, which is the state we want
            try {
              execFileSync('git', ['-C', c.target, 'config',
                ...(c.existedBefore ? [c.key, c.previousValue] : ['--unset', c.key])], { stdio: 'ignore' });
            } catch (e) { if (c.existedBefore || e.status !== 5) throw e; }
          }
          break;
        case 'repo-folder':
          // A repository run from the home folder would name ~/.claude itself.
          if (basename(c.target) !== '.claude' || resolve(c.target) === resolve(claudeDir())) {
            r.ok = false; r.note = 'refused: not a repository .claude folder'; break;
          }
          r.action = 'delete everything in it except .claude/manifest/ and files git tracks';
          if (!existsSync(c.target)) { r.note = 'already absent'; break; }
          {
            const kept = clearRepoClaude(c.target, dryRun);
            if (kept) r.note = `kept ${kept} file${kept > 1 ? 's' : ''}: .claude/manifest/ and files git tracks`;
          }
          break;
        case 'repo-file': {
          if (basename(c.target) !== '.mcp.json') {
            r.ok = false; r.note = 'refused: not a repository .mcp.json'; break;
          }
          // A committed file is the team's, whatever setup did to it on this clone.
          const tracked = spawnSync('git', ['-C', dirname(c.target), 'ls-files', '--error-unmatch', basename(c.target)],
                                    { stdio: 'ignore' }).status === 0;
          if (tracked) { r.action = 'kept'; r.note = 'git tracks this file; left for the team to decide'; break; }
          r.action = 'delete file';
          if (!existsSync(c.target)) r.note = 'already absent';
          else if (!dryRun) rmSync(c.target);
          break;
        }
        case 'external': {
          const cmd = runnableUndo(c.undoHint);
          if (cmd) {
            r.action = `run: ${cmd.join(' ')}`;
            if (dryRun) break;
            const p = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
            const output = `${p.stdout ?? ''}${p.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').trim();
            if (p.status === 0) break;
            // gone already, whether the user removed it or never kept it
            if (/not (installed|found)|does not exist|no such/i.test(output)) { r.note = 'already removed'; break; }
            r.ok = false; r.note = output || p.error?.message || `exit ${p.status}`;
            break;
          }
          if (String(c.target).startsWith('mcp:') && mcpFileRecorded) {
            r.action = 'removed with the repository .mcp.json';
            break;
          }
          r.action = 'manual';
          r.note = c.undoHint || 'reverse by hand';
          break;
        }
      }
    } catch (e) {
      r.ok = false; r.note = e.message;
    }
    results.push(r);
  }
  if (!dryRun) {
    const remaining = results.filter(r => !r.ok || r.kept);
    if (remaining.length === 0) {
      rmSync(MANIFEST, { force: true });
      // our own folder goes too, but only once it is empty — backups are kept
      for (const d of [BACKUP_DIR, STATE_DIR]) {
        try { if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d); } catch { /* keep going */ }
      }
    }
    else { m.changes = m.changes.filter(c =>
             remaining.some(r => r.type === c.type && r.target === c.target));
           save(m); }
  }
  return results;
}

/**
 * Empty a repository's .claude folder of everything this plugin and its skills
 * wrote, keeping .claude/manifest/ — each story's deploy manifest, which the team
 * commits — and every file git tracks. Folders left empty are removed, the
 * .claude folder itself included. Returns how many files were kept.
 */
function clearRepoClaude(folder, dryRun) {
  const repo = dirname(folder);
  let trackedFiles = new Set();
  try {
    trackedFiles = new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z', '--', '.claude'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean)
      .map(f => join(repo, f)));
  } catch { /* not a git repository: nothing is tracked */ }
  const manifestDir = join(folder, 'manifest');
  let kept = 0;
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (p === manifestDir) { kept += countFiles(p); continue; }
      // lstat: a symlinked folder is removed as a link, never emptied through it
      if (lstatSync(p).isDirectory()) {
        walk(p);
        if (!dryRun && readdirSync(p).length === 0) rmdirSync(p);
      } else if (trackedFiles.has(p)) {
        kept++;
      } else if (!dryRun) {
        rmSync(p, { force: true });
      }
    }
  };
  walk(folder);
  if (!dryRun && readdirSync(folder).length === 0) rmdirSync(folder);
  return kept;
}

function countFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    n += lstatSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

/**
 * Is this file tracked by the git repository it sits in? Files under the
 * configuration folder are never part of one, so they are not checked.
 */
function tracked(target) {
  if (resolve(target).startsWith(resolve(claudeDir()))) return false;
  const dir = dirname(target);
  return existsSync(dir) && trackedUnder(dir, basename(target));
}

/**
 * The removal commands revert runs by itself, split into arguments.
 *
 * Only a plugin uninstall or a marketplace removal, each naming one thing. Any
 * other hint stays a note for the user, because running recorded text through a
 * shell would run whatever the manifest file happens to hold.
 */
function runnableUndo(hint) {
  const m = /^claude plugin (uninstall|marketplace remove) ([\w.@-]+)$/.exec(String(hint ?? '').trim());
  if (!m) return null;
  return m[1] === 'uninstall'
    ? ['claude', 'plugin', 'uninstall', m[2]]
    : ['claude', 'plugin', 'marketplace', 'remove', m[2]];
}

// ---- CLI -------------------------------------------------------------------
// Only runs when this file is executed directly. Importing it must not act.

const isMain = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(
  rest.reduce((acc, tok, i, a) => {
    if (tok.startsWith('--')) acc.push([tok.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1]]);
    return acc;
  }, [])
);
const out = o => console.log(JSON.stringify(o, null, 2));

switch (cmd) {
  case 'init':
    out(init(args.version)); break;
  case 'path':
    console.log(MANIFEST); break;
  case 'backup-path':
    console.log(backup(args.target) ?? ''); break;
  case 'record': {
    const c = { type: args.type, target: args.target };
    if (args.backup) c.backup = args.backup;
    if (args['existed-before'] !== undefined) c.existedBefore = args['existed-before'] === 'true';
    if (args.marker) c.marker = args.marker;
    if (args.style) c.style = args.style;
    if (args.key) c.key = args.key;
    if (args['previous-value'] !== undefined) {
      try { c.previousValue = JSON.parse(args['previous-value']); }
      catch { c.previousValue = args['previous-value']; }
    }
    if (args['undo-hint']) c.undoHint = args['undo-hint'];
    out(record(c)); break;
  }
  case 'list':
    out(load()); break;
  case 'status': {
    const m = load();
    out({ installed: existsSync(MANIFEST), version: m.version,
          installedAt: m.installedAt, changeCount: m.changes.length,
          manifest: MANIFEST });
    break;
  }
  case 'revert':
    out(revert({ dryRun: args['dry-run'] === true || args['dry-run'] === 'true' })); break;
  case 'get-json-key': {
    if (!existsSync(args.target)) { console.log(''); break; }
    const v = getJsonKey(JSON.parse(readFileSync(args.target, 'utf8')), args.key);
    console.log(v === undefined ? '' : JSON.stringify(v)); break;
  }
  default:
    console.error(`hean-harness manifest

Usage: manifest.mjs <command> [--flags]

  init --version X        create or update the manifest header
  status                  is the toolkit installed, and how many changes
  list                    dump the full manifest
  path                    print the manifest file path
  backup-path --target F  copy F aside, print the backup path
  record --type T --target F [--backup B] [--existed-before true|false]
         [--marker M] [--key K] [--previous-value JSON] [--undo-hint TEXT]
  get-json-key --target F --key a.b.c
  revert [--dry-run true]

Change types: ${Object.keys(REVERSIBLE).join(', ')}`);
    process.exit(cmd ? 1 : 0);
}
}
