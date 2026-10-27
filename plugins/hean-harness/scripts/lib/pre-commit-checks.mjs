#!/usr/bin/env node
/**
 * Runs the four pre-commit checks in one node process, in the order
 * assets/githooks/pre-commit names them. Starting node once instead of four
 * times shortens every terminal commit.
 *
 * It holds back everything the checks print until all four have run, then
 * prints it and exits PASSED or REFUSED. What would go to standard error goes
 * to file descriptor 3, which the shell hook points at its own standard error
 * while it sends node's to nowhere: a crash of this file prints nothing. Those two codes are the only ones the
 * shell hook takes as a result: any other end (this file cannot load, node
 * crashes, a signal stops it, memory runs out) makes the hook run the four
 * checks one by one, as it did before this file existed. Since nothing was
 * printed yet, nothing is printed twice, and a refusal found before the crash
 * still refuses.
 *
 * Setup copies this file with the checks to <config>/hean-harness/hooks/, so
 * it finds them next to itself. A check whose copy is missing is skipped, as
 * the shell hook skips it. A check that cannot be loaded here (a partial copy,
 * a library it lacks) runs as its own `node <check> --git-hook` process
 * instead, so its crash prints and exits exactly as before and skips only that
 * check. The repository's top folder, its branch and whether a merge,
 * cherry-pick, revert or rebase is in progress are read from git once and
 * shared by the four checks.
 */

import { spawnSync } from 'node:child_process';
import { statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import tty from 'node:tty';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Every check ran: none refused, or one refused. node itself ends with 1 to 14 or with 128 plus a signal.
export const PASSED = 80;
export const REFUSED = 83;
const CHECKS = ['manifest-check.mjs', 'flow-collection-filter.mjs', 'flow-feature-toggle.mjs', 'apex-class-header.mjs'];
const HERE = dirname(fileURLToPath(import.meta.url));

/** What every check reads first, read once; null when manifest-check.mjs cannot be loaded, and each check reads its own. */
async function sharedFacts() {
  try { return (await import(pathToFileURL(join(HERE, 'manifest-check.mjs')).href)).repoFacts?.() ?? null; } catch { return null; }
}

/** One check's exit code: run in this process, or as its own process when it cannot be loaded here. */
async function runCheck(file, facts) {
  let runGitHook = null;
  try { ({ runGitHook } = await import(pathToFileURL(file).href)); } catch { /* run it on its own below */ }
  if (typeof runGitHook === 'function') return runGitHook(facts ?? undefined);
  const own = spawnSync(process.execPath, [file, '--git-hook'],
                        { stdio: ['inherit', 'pipe', 'pipe'], env: ownEnv(), maxBuffer: Infinity });
  // killed or never started: the shell hook reported that for the check it ran, so it runs the checks itself
  if (own.signal || own.error) process.exit(1);
  held.push([process.stdout, own.stdout], [process.stderr, own.stderr]);
  return own.status;
}

/**
 * The environment of a check run as its own process. Its output now goes through a pipe, not the terminal
 * the shell hook gave it, so on a terminal it gets the colour level node would use there.
 */
function ownEnv() {
  if (process.env.FORCE_COLOR !== undefined || !tty.isatty(3)) return process.env;
  const depth = tty.WriteStream.prototype.getColorDepth.call(null, process.env);
  const level = depth >= 24 ? '3' : depth >= 8 ? '2' : depth >= 4 ? '1' : null;
  return level ? { ...process.env, FORCE_COLOR: level } : process.env;
}

// What the checks print, in order, until all four have run
const held = [];

/** Write all of chunk to fd; standard error stands in for fd 3 when the hook did not open it. */
function print(fd, chunk) {
  let bytes = Buffer.from(chunk);
  while (bytes.length) {
    let n;
    try { n = writeSync(fd, bytes); } catch (e) {
      if (e.code === 'EAGAIN') continue;
      if (fd === 3 && e.code === 'EBADF') { fd = 2; continue; }
      throw e;
    }
    bytes = bytes.subarray(n);
  }
}

async function main() {
  for (const stream of [process.stdout, process.stderr]) stream.write = chunk => { held.push([stream, chunk]); return true; };
  const facts = await sharedFacts();
  let refused = false;
  for (const name of CHECKS) {
    const file = join(HERE, name);
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;   // the shell hook's [ -f ]
    if (await runCheck(file, facts) === 3) refused = true;
  }
  for (const [stream, chunk] of held) if (chunk?.length) print(stream === process.stdout ? 1 : 3, chunk);
  process.exitCode = refused ? REFUSED : PASSED;
}

main();
