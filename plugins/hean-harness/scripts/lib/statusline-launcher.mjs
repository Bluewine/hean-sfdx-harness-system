/**
 * The statusLine command: a few lines of Node held in the setting itself, which
 * find the plugin's current version folder and run its status line script.
 *
 * The plugin's folder is named after its version and moves on every update, so
 * the setting cannot name it, and a copy of the script outside the plugin could
 * not import the plugin's libraries. installed_plugins.json, in Claude Code's
 * plugins folder, records each install's installPath (plugin loading
 * reference); the plugins folder itself does not move. Setup writes that folder
 * and the plugin id into the command as text, so the command needs no path
 * logic of its own and reads the record on every run.
 *
 * When the lookup fails, the command prints FALLBACK instead of nothing: a
 * command that prints nothing leaves the status line empty with no sign why.
 * When the lookup succeeds and the script then throws, it prints SCRIPT_FAILED,
 * so the two causes read differently.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { claudeDir } from './paths.mjs';
import { shQuote } from './shell.mjs';

export const FALLBACK = '⚠ hean-harness status line: plugin not found — run /hean-harness:setup';
export const SCRIPT_FAILED = '⚠ hean-harness status line: the status line script failed — run /hean-harness:doctor';
export const SCRIPT = 'assets/statusline/statusline-command.mjs';

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** Claude Code's plugins folder: CLAUDE_CODE_PLUGIN_CACHE_DIR when set, else <config>/plugins. */
export function pluginsRoot(env = process.env) {
  const override = (env.CLAUDE_CODE_PLUGIN_CACHE_DIR || '').trim();
  return override ? resolve(override) : join(claudeDir(env), 'plugins');
}

/**
 * The id installed_plugins.json files this plugin under, <name>@<marketplace>.
 * A cached install sits at cache/<marketplace>/<plugin>/<version>; a source
 * checkout has the marketplace file two folders up.
 */
export function pluginId(pluginRoot) {
  const parts = resolve(pluginRoot).split(sep);
  const i = parts.lastIndexOf('cache');
  if (i >= 0 && parts.length - i === 4) return `${parts[i + 2]}@${parts[i + 1]}`;
  const name = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))?.name;
  const market = readJson(join(dirname(dirname(resolve(pluginRoot))), '.claude-plugin', 'marketplace.json'))?.name;
  return name && market ? `${name}@${market}` : null;
}

export function launcherSource(root, id) {
  return [
    'import{readFileSync}from"node:fs";import{join}from"node:path";import{pathToFileURL}from"node:url";',
    'let at;',
    'try{',
    `const list=JSON.parse(readFileSync(join(${JSON.stringify(root)},"installed_plugins.json"),"utf8")).plugins[${JSON.stringify(id)}];`,
    'at=join([...list].sort((a,b)=>String(b.lastUpdated??"").localeCompare(String(a.lastUpdated??"")))[0].installPath,' +
      `${JSON.stringify(SCRIPT)});`,
    `}catch{process.stdout.write(${JSON.stringify(`${FALLBACK}\n`)});}`,
    'if(at)try{await import(pathToFileURL(at).href);}',
    `catch{process.stdout.write(${JSON.stringify(`${SCRIPT_FAILED}\n`)});}`
  ].join('');
}

export const launcherCommand = (root, id) => `node --input-type=module -e ${shQuote(launcherSource(root, id))}`;
