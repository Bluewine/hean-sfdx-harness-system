#!/usr/bin/env node
/**
 * Applies the repository's commit format choice: with it on, puts a commit-msg
 * hook in the repository's .githooks folder and points git at it; with it off,
 * takes away the hook this plugin put there.
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
 * The choice is asked once. --commit-format on|off gives it; without the flag
 * the answer saved in the repository is used, and with neither nothing is
 * installed and the step says the question is still open.
 *
 * A hook file already there is left alone, whether the repository or a previous
 * install put it there, because the repository may rely on it. --replace-githook
 * replaces it, keeping a backup. A core.hooksPath pointing somewhere else is
 * always left alone, because another tool may own it.
 */

import { execFileSync } from 'node:child_process';

import { readChoice, applyChoice, settingsFile } from './lib/commit-format.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const replace = argv.includes('--replace-githook');
const formatArg = argv.indexOf('--commit-format');
const given = formatArg >= 0 ? argv[formatArg + 1] : null;
const log = (...a) => console.log(...a);

function main() {
  if (given !== null && given !== 'on' && given !== 'off') {
    console.error(`--commit-format takes on or off, not "${given}".`);
    process.exit(1);
  }

  const start = repoArg >= 0 ? argv[repoArg + 1] : process.cwd();
  let repo;
  try {
    repo = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    log(`Not a git repository: ${start}. No hook to install.`);
    return;
  }

  const saved = readChoice(repo);
  const choice = given ?? saved;
  if (!choice) {
    log('!! ASK — COMMIT FORMAT NOT CHOSEN for this repository.');
    log('!! Enforce the "@WORK-ID: Summary" commit subject format here? Run setup with');
    log('!! --commit-format on or --commit-format off. Nothing is enforced until then.');
    log('');
    if (dryRun) log('Dry run. Nothing was changed.');
    return;
  }
  if (!given) log(`Using the answer saved in ${settingsFile(repo)}`);

  for (const line of applyChoice(repo, choice, { replace, dryRun })) log(line);
  log('');
  if (dryRun) log('Dry run. Nothing was changed.');
}

main();
