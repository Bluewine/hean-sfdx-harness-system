/**
 * Works out which shell the user logs in with, and which file the alias
 * belongs in.
 *
 * Only zsh and bash are supported, because those are the two that can be
 * tested. Any other shell is reported as unsupported so the caller can print
 * instructions instead of writing a file it cannot verify.
 */

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';

const MARKER = 'hean-harness';
const SUPPORTED = ['zsh', 'bash'];

/**
 * Pick the file the shell reads when it starts.
 *
 * zsh reads .zshrc for every interactive shell, login or not.
 * bash on macOS reads .bash_profile, because Terminal opens login shells.
 * bash on Linux reads .bashrc.
 * When the usual file is missing but the other one already exists, use the
 * one that exists rather than creating a second startup file.
 */
function profileFor(name, home, os) {
  if (name === 'zsh') return join(home, '.zshrc');
  if (name === 'bash') {
    const macFirst = os === 'darwin';
    const primary = join(home, macFirst ? '.bash_profile' : '.bashrc');
    const other = join(home, macFirst ? '.bashrc' : '.bash_profile');
    return existsSync(primary) || !existsSync(other) ? primary : other;
  }
  return null;
}

export function detectShell({ env = process.env, home = homedir(), os = platform() } = {}) {
  const shellPath = env.SHELL || '';
  const name = basename(shellPath) || 'unknown';
  const supported = SUPPORTED.includes(name);
  const profile = profileFor(name, home, os);
  return {
    name,
    shellPath,
    supported,
    profile,
    reloadCommand: profile ? `source ${profile.replace(home, '~')}` : null
  };
}

/**
 * The command that starts Claude Code with the rules loaded.
 *
 * The alias wraps this, and it is also what someone types by hand when the
 * alias could not be installed. One definition, so the two cannot differ.
 * The path to the rules file must already be absolute.
 */
export function claudeCommand(promptPath, { skipPermissions = true } = {}) {
  const flags = [
    skipPermissions ? '--dangerously-skip-permissions' : null,
    `--append-system-prompt-file ${promptPath}`
  ].filter(Boolean).join(' ');
  return `claude ${flags}`;
}

/** The alias line written into the shell startup file. */
export function aliasLine(promptPath, opts) {
  return `alias claude="${claudeCommand(promptPath, opts)}"`;
}

export { MARKER, SUPPORTED };
