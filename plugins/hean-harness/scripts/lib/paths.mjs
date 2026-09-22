/**
 * Where Claude Code keeps its configuration.
 *
 * Normally `~/.claude`. When `CLAUDE_CONFIG_DIR` is set, Claude Code keeps its
 * settings, history and plugins there instead, and everything this plugin
 * installs has to follow — otherwise setup writes rules, memories and the
 * status line into a directory the running session never reads, and the
 * install looks successful while having no effect. That variable is also how
 * someone tries the plugin without touching their own configuration, so
 * ignoring it would write into the very directory they were protecting.
 *
 * The shell startup file is deliberately not resolved through here: `.zshrc`
 * lives in the home directory, not in Claude Code's configuration directory.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

export function claudeDir(env = process.env) {
  const override = (env.CLAUDE_CONFIG_DIR || '').trim();
  if (!override) return join(homedir(), '.claude');
  // A relative value would resolve against whatever directory the script
  // happens to run in, which for an installer is never what was meant.
  if (override.startsWith('~')) return join(homedir(), override.slice(1).replace(/^[/\\]/, ''));
  return isAbsolute(override) ? override : join(homedir(), override);
}

/** A path inside the configuration directory. */
export const claudePath = (...parts) => join(claudeDir(), ...parts);

/**
 * Where `.claude.json` is, which is not where you would guess.
 *
 * It holds the per-project state, including each project's MCP servers. By
 * default it sits beside the configuration directory rather than inside it —
 * `~/.claude.json`, next to `~/.claude/` — but when `CLAUDE_CONFIG_DIR` is set
 * it moves inside that directory. Looking in only one of the two finds nothing
 * on half the machines, and a file that is not found reads exactly like a file
 * with nothing in it.
 *
 * So both are checked, and the one that exists wins.
 */
export function userConfigFile(env = process.env) {
  const inside = join(claudeDir(env), '.claude.json');
  const beside = join(homedir(), '.claude.json');
  if (existsSync(inside)) return inside;
  if (existsSync(beside)) return beside;
  return (env.CLAUDE_CONFIG_DIR || '').trim() ? inside : beside;
}
