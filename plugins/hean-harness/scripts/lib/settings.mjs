/**
 * The answers setup and the skills save for one repository, kept in
 * <main checkout>/.claude/hean-harness.json.
 *
 * The file lives in the main checkout's .claude folder, and every linked
 * worktree of the repository reads and writes that same file, as Claude Code
 * does with settings.local.json.
 *
 * That folder is ignored by git, and uninstall deletes this file as one of the
 * plugin's own files while leaving the rest of the folder, so the answers belong
 * to one clone on one machine and go away with the install. Each answer lives
 * under its own key; a write replaces only its own key and keeps the others.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * The folder holding the repository's main checkout, seen from any folder of it
 * or of a linked worktree. Returns dir unchanged for a bare repository, a git
 * directory not named .git, a git failure, or a folder outside any repository.
 */
export function mainCheckout(dir) {
  try {
    const common = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return common && basename(common) === '.git' ? dirname(common) : dir;
  } catch { return dir; }
}

export const settingsFile = repo => join(mainCheckout(repo), '.claude', 'hean-harness.json');

/** Every saved answer, or {} when nothing is saved or the file cannot be read. */
export function readSettings(repo) {
  try {
    const json = JSON.parse(readFileSync(settingsFile(repo), 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch { return {}; }
}

/** Save one answer under its key, keeping every other key as it is. */
export function writeSetting(repo, key, value) {
  const file = settingsFile(repo);
  const json = readSettings(repo);
  json[key] = value;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
