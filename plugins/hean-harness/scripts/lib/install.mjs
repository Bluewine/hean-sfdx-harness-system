/**
 * The two ways this plugin changes a file on the user's machine.
 *
 * Both take a backup first and both write to the install manifest, so every
 * change can be reversed later. Installers call these rather than writing
 * files themselves.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, relative, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { record, backup, findBlock, block, setJsonKey, getJsonKey, load, markers, note } from './manifest.mjs';
import { claudeDir } from './paths.mjs';
import { MARKER } from './shell.mjs';
import { indexLine, mergeIndex } from './memory-index.mjs';

// <plugin>/scripts/lib/install.mjs -> <plugin>
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Make a directory, recording it only when we are the ones who created it.
 * Uninstall then removes it, but only if it is still empty, so a directory
 * the user later put their own files in is kept.
 */
export function installDir(path) {
  if (existsSync(path)) return { existed: true };

  // creating a directory also creates any missing parents, so record each of
  // them too; otherwise uninstall leaves empty parents behind
  const missing = [];
  for (let d = path; !existsSync(d) && d !== dirname(d); d = dirname(d)) missing.push(d);

  mkdirSync(path, { recursive: true });
  for (const d of [...missing].reverse()) record({ type: 'dir-create', target: d });
  return { existed: false, created: missing.length };
}

/** Put a file in place, keeping a copy of anything already there. */
export function installFile(source, dest) {
  const existed = existsSync(dest);
  const saved = existed ? backup(dest) : null;
  mkdirSync(dirname(dest), { recursive: true });

  // Remember which file this came from, relative to the plugin, so a later
  // check compares against the right one. Several files share a name across
  // folders, so looking one up by name alone finds the wrong copy. Relative,
  // because the plugin's own folder moves whenever the plugin updates.
  const from = relative(PLUGIN_ROOT, source);

  // Recorded before the write, not after. A run killed between the two would
  // otherwise leave the user's file overwritten with no entry to reverse it,
  // and the next setup would read our copy as though it were theirs. Reversing
  // an entry whose write never happened is harmless: it restores a backup
  // identical to what is already on disk.
  record({ type: 'file-copy', target: dest, backup: saved, existedBefore: existed,
           source: from.startsWith('..') ? null : from });

  copyFileSync(source, dest);
  return { existed, replaced: existed };
}

/**
 * Add a managed block to a file, replacing any block already there.
 *
 * When the file did not exist, it is recorded as a file we created, so
 * uninstall deletes it. When it did exist, only the block is recorded, so
 * uninstall removes the block and leaves the user's own content alone.
 *
 * A block already in the file is replaced where it sits — top, middle or end —
 * so a shell startup file keeps the order its owner gave it. With no block, one
 * is appended after a blank line, which stripBlock removes along with it, so
 * install then uninstall gives back the file byte for byte. No other line is
 * touched, and the result is read back; on a mismatch the backup is put back.
 *
 * A malformed or duplicated block throws before anything is recorded or written.
 */
export function installBlock(file, marker, body, style = 'hash') {
  const existed = existsSync(file);
  const found = existed ? findBlock(file, marker, style) : null;
  const saved = existed ? backup(file) : null;

  // One entry, always the same type. Recording a file-copy here as well would
  // leave a second entry that revert honours by deleting the whole file, taking
  // anything the user wrote into it since. Recorded before the edit, so an
  // interrupted run still leaves something to reverse.
  record({ type: 'marker-block', target: file, marker, style,
           backup: saved, existedBefore: existed });

  const blk = block(marker, body, style);      // "\n<open>...<close>\n"
  let next;
  if (found) {
    const { lines, start, end } = found;
    next = [...lines.slice(0, start), ...blk.slice(1, -1).split('\n'), ...lines.slice(end + 1)].join('\n');
  } else if (existed) {
    const current = readFileSync(file, 'utf8');
    next = current === '' ? blk.slice(1) : current + (current.endsWith('\n') ? '' : '\n') + blk;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    next = blk.slice(1);
  }

  writeFileSync(file, next);
  if (readFileSync(file, 'utf8') !== next) {
    if (saved) copyFileSync(saved, file);
    throw new Error(`${file} did not read back as written.${saved ? ' The backup was put back.' : ''}`);
  }
  return { existed, replaced: Boolean(found) };
}

/**
 * Put one index line per shipped memory into a MEMORY.md, owned by the file
 * each line links to rather than by a marked block. memory-index.mjs says why.
 *
 * sources are the shipped memory files for this folder, in the order a missing
 * line is appended. The markers an earlier version wrote are removed wherever
 * they are, keeping the lines between them. Lines for memories an earlier
 * install owned and this version no longer ships are removed too, because the
 * revert before this install keeps the entry and so never reaches them.
 *
 * Every line is generated before anything is recorded, so a memory with broken
 * frontmatter throws with the file untouched. The result is read back; on a
 * mismatch the backup is put back.
 */
export function installIndexLines(file, sources) {
  const entries = sources.map(s => ({ file: basename(s), line: indexLine(s) }));
  const existed = existsSync(file);
  const previous = load().changes.find(c => c.type === 'index-lines' && c.target === file);
  const saved = existed ? backup(file) : null;

  // Recorded before the edit, as installBlock does. An entry for the same file
  // left by the marked-block version is replaced by this one; see SUPERSEDES.
  record({ type: 'index-lines', target: file, files: entries.map(e => e.file),
           backup: saved, existedBefore: existed });

  const { open, close } = markers(MARKER, 'html');
  const next = mergeIndex(existed ? readFileSync(file, 'utf8') : null, entries,
                          { drop: [open, close, note(MARKER, 'html')], retired: previous?.files ?? [] });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  if (readFileSync(file, 'utf8') !== next) {
    if (saved) copyFileSync(saved, file);
    throw new Error(`${file} did not read back as written.${saved ? ' The backup was put back.' : ''}`);
  }
  return { existed, lines: entries.length };
}

/**
 * Set one key in a JSON settings file, remembering what was there before.
 *
 * When the file did not exist, it is recorded as ours so uninstall deletes it.
 * When it did, only the key is recorded, so uninstall puts the old value back
 * and leaves every other setting alone.
 */
export function installJsonKey(file, key, value) {
  const existed = existsSync(file);
  const saved = existed ? backup(file) : null;
  const json = existed ? JSON.parse(readFileSync(file, 'utf8')) : {};

  const had = existed && getJsonKey(json, key) !== undefined;
  const previous = had ? getJsonKey(json, key) : undefined;

  // As above: one entry, recorded before the write. `fileExisted` says whether
  // the file itself is ours to remove; `existedBefore` says whether the key had
  // a value to put back. On a repeat setup the manifest keeps the value from the
  // first run, because by now the file holds ours rather than the user's.
  record({ type: 'json-key', target: file, key, backup: saved,
           existedBefore: had, previousValue: previous, fileExisted: existed });

  setJsonKey(json, key, value);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');

  return { existed, hadKey: had, previous };
}

/** Read one key from a repository's git config, or undefined when it is unset. */
export function getGitConfig(repo, key) {
  try {
    return execFileSync('git', ['-C', repo, 'config', '--get', key],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return undefined; }
}

/**
 * Set one key in a repository's git config, remembering what was there before.
 * Uninstall puts the old value back, or unsets the key when it had none.
 */
export function installGitConfig(repo, key, value) {
  const previous = getGitConfig(repo, key);
  // Recorded before the write, as above.
  record({ type: 'git-config', target: repo, key, value,
           existedBefore: previous !== undefined, previousValue: previous });
  execFileSync('git', ['-C', repo, 'config', key, value], { stdio: 'ignore' });
  return { previous };
}

/**
 * Record the repository's .claude folder, so uninstall deletes it with
 * everything in it. The folder is ignored by git and holds nothing but what
 * setup and the skills wrote on this clone.
 *
 * Refuses when the repository is the home folder, because its .claude is
 * Claude Code's own configuration.
 */
export function installRepoFolder(repo) {
  const target = join(repo, '.claude');
  if (resolve(target) === resolve(claudeDir())) return { recorded: false, target };
  record({ type: 'repo-folder', target });
  return { recorded: true, target };
}

/**
 * Record the repository's .mcp.json, so uninstall deletes it. Git ignores it
 * and setup adds the Linear server to it on each clone. Uninstall keeps it when
 * git tracks it, because a committed file is the team's.
 */
export function installRepoMcpFile(repo) {
  record({ type: 'repo-file', target: join(repo, '.mcp.json') });
}

/**
 * Record something installed by an outside command. These cannot be undone
 * automatically, so uninstall reports the hint instead of acting.
 */
export function recordExternal(name, undoHint) {
  record({ type: 'external', target: name, undoHint });
}
