#!/usr/bin/env node
/**
 * Checks that each local `origin/<branch>` matches what the remote actually has.
 *
 * `git fetch` can fail without stopping anything: the local copy of the remote
 * branch simply keeps answering with whatever it held before. Every range
 * computed from it is then wrong in the one direction nobody notices, because
 * work that has already merged still looks unmerged.
 *
 * Exits 0 only when every named branch was checked and every one matched.
 * A branch that could not be read is a failure, not a pass — the whole point
 * is that an unperformed check must never look like a successful one.
 *
 * Usage: verify-remote-refs.mjs <branch> [<branch> ...]
 */

import { execFileSync } from 'node:child_process';

const branches = process.argv.slice(2).filter(Boolean);

if (!branches.length) {
  console.error('verify-remote-refs: name at least one branch to check.');
  process.exit(2);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let failed = 0;

for (const branch of branches) {
  let local;
  try {
    local = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
  } catch {
    local = '';
  }
  if (!local) {
    console.error(`  MISSING  origin/${branch} does not exist locally. Run: git fetch origin ${branch}`);
    failed++;
    continue;
  }

  let remote;
  try {
    // Asks the remote itself rather than any cached copy, so it catches a fetch
    // that failed. Works against any git host, not only one provider's API.
    const line = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
    remote = line.split(/\s+/)[0] || '';
  } catch (e) {
    const why = (e.stderr || e.message || '').toString().trim().split('\n')[0];
    console.error(`  UNREADABLE  could not ask the remote about ${branch}: ${why}`);
    failed++;
    continue;
  }

  if (!remote) {
    console.error(`  MISSING  the remote has no branch named ${branch}.`);
    failed++;
  } else if (remote !== local) {
    console.error(
      `  STALE  origin/${branch} is ${local.slice(0, 8)} locally but ${remote.slice(0, 8)} on the remote. ` +
      `The last fetch did not succeed. Run: git fetch origin ${branch}`);
    failed++;
  } else {
    console.log(`  ok  origin/${branch} matches the remote at ${local.slice(0, 8)}`);
  }
}

if (failed) {
  console.error(`\nverify-remote-refs: ${failed} of ${branches.length} branch checks failed. ` +
                `Stopping, because any range computed from these refs would be wrong.`);
  process.exit(1);
}
process.exit(0);
