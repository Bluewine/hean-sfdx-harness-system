/**
 * The two ways this plugin changes a file on the user's machine.
 *
 * Both take a backup first and both write to the install manifest, so every
 * change can be reversed later. Installers call these rather than writing
 * files themselves.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { record, backup, stripBlock, block, setJsonKey, getJsonKey } from './manifest.mjs';

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
  copyFileSync(source, dest);

  // Remember which file this came from, relative to the plugin, so a later
  // check compares against the right one. Several files share a name across
  // folders, so looking one up by name alone finds the wrong copy. Relative,
  // because the plugin's own folder moves whenever the plugin updates.
  const from = relative(PLUGIN_ROOT, source);
  record({ type: 'file-copy', target: dest, backup: saved, existedBefore: existed,
           source: from.startsWith('..') ? null : from });
  return { existed, replaced: existed };
}

/**
 * Add a managed block to a file, replacing any block already there.
 *
 * When the file did not exist, it is recorded as a file we created, so
 * uninstall deletes it. When it did exist, only the block is recorded, so
 * uninstall removes the block and leaves the user's own content alone.
 */
export function installBlock(file, marker, body, style = 'hash') {
  const existed = existsSync(file);
  const saved = existed ? backup(file) : null;

  if (existed) stripBlock(file, marker, style);
  else mkdirSync(dirname(file), { recursive: true });

  const current = existed && existsSync(file) ? readFileSync(file, 'utf8') : '';
  const head = current.trim() ? current.replace(/\n+$/, '\n') : '';
  const blk = block(marker, body, style);
  writeFileSync(file, head ? head + blk : blk.replace(/^\n/, ''));

  // One entry, always the same type. Recording a file-copy here as well would
  // leave a second entry that revert honours by deleting the whole file, taking
  // anything the user wrote into it since.
  record({ type: 'marker-block', target: file, marker, style,
           backup: saved, existedBefore: existed });

  return { existed, replaced: existed };
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

  setJsonKey(json, key, value);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');

  // As above: one entry. `fileExisted` says whether the file itself is ours to
  // remove; `existedBefore` says whether the key had a value to put back.
  record({ type: 'json-key', target: file, key, backup: saved,
           existedBefore: had, previousValue: previous, fileExisted: existed });

  return { existed, hadKey: had, previous };
}

/**
 * Record something installed by an outside command. These cannot be undone
 * automatically, so uninstall reports the hint instead of acting.
 */
export function recordExternal(name, undoHint) {
  record({ type: 'external', target: name, undoHint });
}
