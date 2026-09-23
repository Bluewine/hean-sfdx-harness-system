/**
 * The answers setup and the skills save for one repository, kept in
 * <repo>/.claude/hean-harness.json.
 *
 * That folder is ignored by git and emptied on uninstall, so the answers belong
 * to one clone on one machine and go away with the install. Each answer lives
 * under its own key; a write replaces only its own key and keeps the others.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const settingsFile = repo => join(repo, '.claude', 'hean-harness.json');

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
