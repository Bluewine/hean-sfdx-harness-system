#!/usr/bin/env node
/**
 * Runs `npm install` in the repository when its packages are not installed.
 *
 * Without node_modules, jest, gulp and prettier cannot run, and a skill that
 * calls them fails with a missing-command error rather than a test result.
 *
 * Runs after the git hooks step on purpose. A repository's prepare script may
 * point git at .githooks and fails when the folder is missing, and npm install
 * runs that script.
 *
 * Runs only when node_modules is missing. A full install takes minutes, and a
 * second setup has nothing to gain from it.
 */

import { existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { recordExternal } from './lib/install.mjs';
import { present } from './lib/environment.mjs';

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
  } catch { repo = start; }

  const modules = join(repo, 'node_modules');
  log(`Repository     ${repo}`);

  if (!existsSync(join(repo, 'package.json'))) {
    log('               no package.json, so nothing to install');
    return;
  }
  if (existsSync(modules)) {
    log('               node_modules is there, left as it is');
    return;
  }
  log('               node_modules is missing, npm install to run');
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  if (!present('npm')) {
    log('The npm command is not on PATH, so the packages cannot be installed from here.');
    log('Install Node.js, then run "npm install" in the repository.');
    process.exit(1);
  }

  init();
  // recorded before the run, so a failure halfway still leaves the hint behind
  recordExternal(`npm:${modules}`, `delete ${modules} if you no longer need the packages`);

  log('Running: npm install');
  const r = spawnSync('npm', ['install'], { cwd: repo, stdio: 'inherit' });
  if (r.status !== 0) {
    log('');
    log(`npm install failed (exit ${r.status ?? 'signal ' + r.signal}). The output above says why.`);
    log('A package from a private registry needs you signed in to that registry first.');
    process.exit(1);
  }
  log('Packages installed.');
}

main();
