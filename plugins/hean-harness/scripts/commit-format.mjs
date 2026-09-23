#!/usr/bin/env node
/**
 * Switches the @WORK-ID commit subject format on or off in one repository,
 * after setup has run there. Nothing else setup installed is touched.
 *
 *   commit-format.mjs status|on|off [--repo R] [--dry-run] [--replace-githook]
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { load } from './lib/manifest.mjs';
import { readChoice, applyChoice, realPath } from './lib/commit-format.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const dryRun = argv.includes('--dry-run');
const replace = argv.includes('--replace-githook');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

function main() {
  if (!['status', 'on', 'off'].includes(cmd)) {
    console.error('Usage: commit-format.mjs status|on|off [--repo R] [--dry-run] [--replace-githook]');
    process.exit(1);
  }

  const start = repoArg >= 0 ? argv[repoArg + 1] : process.cwd();
  let repo;
  try {
    repo = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    log(`Not a git repository: ${start}.`);
    process.exit(1);
  }

  // setup records the repository's .claude folder; without that entry it never ran here.
  // Compared by real path: the same folder can be recorded through a symlinked path.
  const folder = realPath(join(repo, '.claude'));
  const setupRan = load().changes.some(c => c.type === 'repo-folder' && realPath(c.target) === folder);
  if (!setupRan) {
    log(`Setup has not run in ${repo}, so the commit format is not enforced here.`);
    log('Run /hean-harness:setup in this repository first.');
    process.exit(1);
  }

  const current = readChoice(repo);
  log(`Repository     ${repo}`);
  log(`Currently      ${current ?? 'not chosen, so not enforced'}`);
  if (cmd === 'status') return;

  if (current === cmd) {
    log(`Already ${cmd}. Nothing was changed.`);
    return;
  }

  log('');
  for (const line of applyChoice(repo, cmd, { replace, dryRun })) log(line);
  log('');
  log(dryRun ? 'Dry run. Nothing was changed.'
    : cmd === 'on' ? 'The next commit in this repository is checked. No restart is needed.'
    : 'Commits in this repository are no longer checked. No restart is needed.');
}

main();
