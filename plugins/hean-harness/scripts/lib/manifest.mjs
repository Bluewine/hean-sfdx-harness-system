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
         rmSync, readdirSync, rmdirSync, renameSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { claudeDir } from './paths.mjs';

export const STATE_DIR = join(claudeDir(), 'hean-harness');
export const MANIFEST = join(STATE_DIR, 'install-manifest.json');
const BACKUP_DIR = join(STATE_DIR, 'backups');

/** Change types and how each one is reversed. */
const REVERSIBLE = {
  'file-copy':    'Restore the backup, or delete the file if it did not exist before.',
  'marker-block': 'Strip the marked block out of the file, leaving the rest untouched.',
  'json-key':     'Restore the previous value, or remove the key if it was absent before.',
  'dir-create':   'Remove the directory, but only if it is still empty.',
  'external':     'Cannot be reversed automatically. Reported for manual action.'
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

export function init(version) {
  const m = load();
  m.version = version || m.version;
  m.installedAt = m.installedAt || new Date().toISOString();
  save(m);
  return m;
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
 * Remove a marker-delimited block from a file, leaving everything else alone.
 *
 * Surgical removal rather than restoring the backup: a developer may have
 * edited the same file after install, and restoring would destroy that work.
 *
 * The writer puts one blank separator line before the opening marker, so that
 * line is removed with the block. Trailing blank lines are normalised to a
 * single final newline.
 */
export function stripBlock(file, marker, style = 'hash') {
  if (!existsSync(file)) return false;
  const { open, close } = markers(marker, style);
  const lines = readFileSync(file, 'utf8').split('\n');

  // Find both ends before removing anything. A block whose closing marker has
  // been deleted is malformed, and treating "no close" as "to end of file"
  // would discard everything the user wrote below it.
  const start = lines.findIndex(l => l.trim() === open);
  if (start < 0) return false;
  const end = lines.findIndex((l, i) => i > start && l.trim() === close);
  if (end < 0) {
    throw new Error(
      `${file} has an opening ${marker} marker with no closing marker. ` +
      `Refusing to edit it, because everything below the opening marker would be lost. ` +
      `Restore the closing line "${close}", or delete the block by hand.`);
  }

  const out = [...lines.slice(0, start), ...lines.slice(end + 1)];
  // the writer puts one blank separator line before the opening marker
  if (start > 0 && out[start - 1] !== undefined && out[start - 1].trim() === '') out.splice(start - 1, 1);
  writeFileSync(file, out.join('\n').replace(/\n+$/, '') + '\n');
  return true;
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

/** Reverse every recorded change, newest first. Never throws on one failure. */
export function revert({ dryRun = false } = {}) {
  const m = load();
  const results = [];
  for (const c of [...m.changes].reverse()) {
    const r = { type: c.type, target: c.target, action: null, ok: true, note: null };
    try {
      switch (c.type) {
        case 'file-copy':
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
          if (!dryRun) {
            const found = stripBlock(c.target, c.marker, c.style);
            if (!found) r.note = 'block already absent';
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
          }
          break;
        case 'external':
          r.action = 'manual';
          r.note = c.undoHint || 'reverse by hand';
          break;
      }
    } catch (e) {
      r.ok = false; r.note = e.message;
    }
    results.push(r);
  }
  if (!dryRun) {
    const remaining = results.filter(r => !r.ok);
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
