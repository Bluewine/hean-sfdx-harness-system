#!/usr/bin/env node
/**
 * `test-changed`'s coverage split must charge a file's uncovered lines to
 * whoever actually left them uncovered. A whole-suite Jest run mixes the
 * branch's own new lines with every pre-existing gap in the rest of the
 * repository, so reporting one blended percentage lets a branch look
 * responsible for coverage it never touched.
 *
 * The split must also reflect the working tree exactly as it sits right now,
 * committed or not — a file only staged, only edited, or never added at all
 * still counts as changed.
 *
 * Runs against throwaway repositories. Touches nothing of yours.
 *
 * Run: node scripts/__tests__/coverage-split.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// <plugin>/scripts/__tests__/ -> <plugin>/
const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPT = join(PLUGIN, 'skills', 'test-changed', 'scripts', 'coverage-split.mjs');

const root = mkdtempSync(join(tmpdir(), 'hean-coverage-split-'));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

function git(repo, args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
}

function put(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function newRepo(name, base) {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', base]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  return repo;
}

function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
}

// coverage-split.mjs finds its root via `git rev-parse --show-toplevel`, which
// resolves symlinks (e.g. macOS's /tmp -> /private/tmp); the fixture's
// absolute paths must be built from that same resolved root, or they never
// match the git-relative paths the script compares them against.
function realRoot(repo) {
  return execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function summary(repo, entries) {
  const root = realRoot(repo);
  const files = {};
  for (const [path, total, covered] of entries) {
    files[join(root, path)] = { lines: { total, covered, skipped: 0, pct: (covered / total) * 100 } };
  }
  put(repo, 'coverage/coverage-summary.json', JSON.stringify(files));
}

function run(repo, args = []) {
  return execFileSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
}

try {
  // 1. changed (committed) file at 100%, untracked changed file at 100%, one
  //    untouched file fully covered, one untouched file with a single
  //    uncovered line — committed or not, all read from the current files.
  const repo = newRepo('scope', 'integration');
  put(repo, 'src/changed.js', 'a\nb\n');
  put(repo, 'src/untouched-full.js', 'a\n');
  put(repo, 'src/untouched-partial.js', 'a\n');
  commit(repo, 'base');
  git(repo, ['checkout', '-q', '-b', 'work-TEST-1']);
  put(repo, 'src/changed.js', 'a\nb\nc\n');
  commit(repo, 'edit changed.js');
  put(repo, 'src/new-untracked.js', 'a\n'); // never git add-ed
  summary(repo, [
    ['src/changed.js', 10, 10],
    ['src/new-untracked.js', 5, 5],
    ['src/untouched-full.js', 8, 8],
    ['src/untouched-partial.js', 20, 19]
  ]);
  const out = run(repo).trimEnd().split('\n');
  check('three lines printed', out.length === 3, JSON.stringify(out));
  check('changed line: committed + untracked files, 100%',
        out[0] === 'Files this branch changed (2):                 100.0%', out[0]);
  check('untouched line: singular uncovered-line note',
        out[1] === 'Files this branch did not touch (2):            96.4%   ← 1 uncovered line, not from this branch',
        out[1]);
  check('whole-repository line: every file in the summary',
        out[2] === 'Whole repository (4):                           97.7%', out[2]);

  // 2. no coverage summary on disk at all
  const noSummary = newRepo('no-summary', 'main');
  put(noSummary, 'src/a.js', 'a\n');
  commit(noSummary, 'base');
  const out2 = run(noSummary).trimEnd();
  check('missing summary reports the exact message and still exits 0',
        out2 === 'No coverage summary found — run npx jest --coverage --coverageReporters=json-summary first.',
        out2);

  // 3. a summary exists, but nothing in it belongs to this branch's changes
  const noChange = newRepo('no-change', 'integration');
  put(noChange, 'src/only.js', 'a\n');
  commit(noChange, 'base');
  git(noChange, ['checkout', '-q', '-b', 'work-TEST-2']);
  summary(noChange, [['src/only.js', 10, 10]]);
  const out3 = run(noChange).trimEnd().split('\n');
  check('no changed file in the summary still prints three lines', out3.length === 3, JSON.stringify(out3));
  check('the changed line shows a dash when no changed file is in the summary',
        out3[0] === 'Files this branch changed (0):                      —', out3[0]);
  check('the whole-repository line is still printed',
        out3[2] === 'Whole repository (1):                          100.0%', out3[2]);

  // 4. a changed file with no lines to cover prints a dash, not NaN%
  const zeroLines = newRepo('zero-lines', 'integration');
  put(zeroLines, 'src/base.js', 'a\n');
  commit(zeroLines, 'base');
  git(zeroLines, ['checkout', '-q', '-b', 'work-TEST-3']);
  put(zeroLines, 'src/empty.js', '\n');
  summary(zeroLines, [['src/empty.js', 0, 0], ['src/base.js', 4, 4]]);
  const out4 = run(zeroLines).trimEnd().split('\n');
  check('a group with no lines prints a dash, not NaN%',
        out4[0] === 'Files this branch changed (1):                      —' && !out4.join('').includes('NaN'),
        JSON.stringify(out4));

  // 5. no base branch: one line saying so, then the whole-repository line, exit 0
  const noBase = newRepo('no-base', 'solo');
  put(noBase, 'src/a.js', 'a\n');
  commit(noBase, 'base');
  summary(noBase, [['src/a.js', 10, 5]]);
  const out5 = run(noBase).trimEnd().split('\n');
  check('no base branch prints one line saying so, then the whole-repository line',
        out5.length === 2 &&
        out5[0] === 'Base branch could not be found, so the split into changed and untouched files is skipped.' &&
        out5[1] === 'Whole repository (1):                           50.0%',
        JSON.stringify(out5));

  // 6. a file under .claude/worktrees/ is another branch's checkout and is not counted
  const worktree = newRepo('worktree', 'integration');
  put(worktree, 'src/a.js', 'a\n');
  commit(worktree, 'base');
  git(worktree, ['checkout', '-q', '-b', 'work-TEST-4']);
  summary(worktree, [['src/a.js', 10, 10], ['.claude/worktrees/other/src/a.js', 10, 0]]);
  const out6 = run(worktree).trimEnd().split('\n');
  check('a .claude/worktrees/ file is left out of every line',
        out6[2] === 'Whole repository (1):                          100.0%', JSON.stringify(out6));

  // 7. a summary older than this run's start is refused; a fresh one is read
  const stale = newRepo('stale', 'integration');
  put(stale, 'src/a.js', 'a\n');
  commit(stale, 'base');
  git(stale, ['checkout', '-q', '-b', 'work-TEST-5']);
  summary(stale, [['src/a.js', 10, 10]]);
  const summaryFile = join(realRoot(stale), 'coverage', 'coverage-summary.json');
  const now = Math.floor(Date.now() / 1000);
  utimesSync(summaryFile, now - 3600, now - 3600);
  const out7 = run(stale, ['--since', String(now)]).trimEnd();
  check('a summary older than --since is refused',
        out7 === 'The coverage summary is older than this Jest run, so Jest stopped before writing coverage. No numbers are reported.',
        out7);
  utimesSync(summaryFile, now + 1, now + 1);
  const out7b = run(stale, ['--since', String(now)]).trimEnd().split('\n');
  check('a summary written after --since is read', out7b.length === 3, JSON.stringify(out7b));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
