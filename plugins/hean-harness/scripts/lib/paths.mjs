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
