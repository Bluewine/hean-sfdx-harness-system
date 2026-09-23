#!/usr/bin/env node
/**
 * Puts a commit-msg hook in the repository's .githooks folder and points git at it.
 *
 * The plugin's own commit gate sees only commits Claude Code runs with -m. A
 * commit typed in a terminal or an editor is checked by git's commit-msg hook,
 * so without one a subject with no work item reference lands unchecked.
 *
 * A repository's package.json may run `git config core.hooksPath .githooks &&
 * chmod +x .githooks/*` on npm install. When a branch deletes the folder, that
 * script fails halfway: core.hooksPath is set to a folder that does not exist,
 * and git then runs no hooks at all. Creating the folder here makes the script
 * succeed again, and setting core.hooksPath here makes the hook run before
 * anyone runs npm install.
 *
 * A hook file already there belongs to the repository and is left alone. So is
 * a core.hooksPath pointing somewhere else, which another tool may own.
 */

import { existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installDir, installFile, installGitConfig, getGitConfig } from './lib/install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(dirname(HERE), 'assets', 'githooks', 'commit-msg');
const HOOKS_DIR = '.githooks';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

function main() {
  const start = repoArg >= 0 ? argv[repoArg + 1] : process.cwd();
  let repo;
  try {
    repo = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    log(`Not a git repository: ${start}. No hook to install.`);
    return;
  }

  const hook = join(repo, HOOKS_DIR, 'commit-msg');
  const hookExists = existsSync(hook);
  const hooksPath = getGitConfig(repo, 'core.hooksPath');
  const setPath = hooksPath === undefined;
  const otherPath = !setPath && hooksPath !== HOOKS_DIR;

  log(`Hook           ${hook}`);
  log(`               ${hookExists ? 'present, left as it is' : 'to add'}`);
  log(`core.hooksPath ${hooksPath ?? 'unset'}`);
  log(`               ${setPath ? `to set to ${HOOKS_DIR}` : otherPath ? 'points elsewhere, left as it is' : 'already correct'}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');
  if (!hookExists) {
    installDir(join(repo, HOOKS_DIR));
    installFile(SOURCE, hook);
    chmodSync(hook, 0o755);
    log(`Added ${hook}`);
  }
  if (setPath) {
    installGitConfig(repo, 'core.hooksPath', HOOKS_DIR);
    log(`Set core.hooksPath to ${HOOKS_DIR}`);
  }
  if (otherPath) {
    log(`core.hooksPath is ${hooksPath}, so git runs the hooks there and not ${hook}.`);
    log(`Run "git config core.hooksPath ${HOOKS_DIR}" if this hook should run instead.`);
  }
}

main();
