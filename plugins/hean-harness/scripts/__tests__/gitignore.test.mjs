#!/usr/bin/env node
/**
 * A `.githooks/` line an earlier setup wrote, before the repository tracked
 * its own hooks there, must not stay forever once the team starts committing
 * them: it sits inside this plugin's own block and stays stale otherwise,
 * since setup only ever adds lines, never revisits ones already written.
 *
 * Runs against throwaway repositories. Touches nothing of yours.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { ensureIgnored, missingLines, COMMENT } from '../lib/gitignore.mjs';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

const root = mkdtempSync(join(tmpdir(), 'hean-gitignore-'));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

// a repository whose .gitignore already carries a stale `.githooks/` line, and
// that now tracks a real hook under .githooks/ — the setup that wrote the
// stale line ran before the team started committing the folder
function repoTrackingHooks(name, gitignore) {
  const repo = join(root, name);
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  writeFileSync(join(repo, '.githooks', 'commit-msg'), '#!/bin/sh\nexit 0\n');
  execFileSync('git', ['-C', repo, 'add', '.githooks/commit-msg']);
  writeFileSync(join(repo, '.gitignore'), gitignore);
  return repo;
}

function repoNotTrackingHooks(name, gitignore) {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  writeFileSync(join(repo, '.gitignore'), gitignore);
  return repo;
}

try {
  // 1. line removed when hooks are tracked, other lines in the block kept
  const before1 =
    `node_modules/\n\n${COMMENT}\n.claude/*\n!.claude/manifest/\n.githooks/\n.mcp.json\n`;
  const repo1 = repoTrackingHooks('removed', before1);
  const r1 = ensureIgnored(repo1);
  const after1 = readFileSync(join(repo1, '.gitignore'), 'utf8');
  check('the stale .githooks/ line is removed once hooks are tracked',
        !after1.split('\n').includes('.githooks/'));
  check('the rest of the block stays',
        after1.includes('.claude/*') && after1.includes('!.claude/manifest/') && after1.includes('.mcp.json'));
  check('the owner\'s own line above the block stays', after1.startsWith('node_modules/'));
  check('ensureIgnored reports the removal', r1.removedHooksLine === true);
  console.log(`  before:\n${before1.split('\n').map(l => `    ${l}`).join('\n')}`);
  console.log(`  after:\n${after1.split('\n').map(l => `    ${l}`).join('\n')}`);

  // 2. kept when the repository does not track hooks
  const before2 = `${COMMENT}\n.claude/*\n!.claude/manifest/\n.githooks/\n.mcp.json\n`;
  const repo2 = repoNotTrackingHooks('kept-untracked', before2);
  const r2 = ensureIgnored(repo2);
  const after2 = readFileSync(join(repo2, '.gitignore'), 'utf8');
  check('a .githooks/ line stays when the repository does not track hooks',
        after2.split('\n').includes('.githooks/'));
  check('ensureIgnored reports no removal', r2.removedHooksLine === false);
  check('the file is otherwise unchanged', after2 === before2);

  // 3. a team `.githooks/` line outside the plugin's block is not touched
  const before3 =
    `# the team's own hooks note\n.githooks/\n\n${COMMENT}\n.claude/*\n!.claude/manifest/\n.mcp.json\n`;
  const repo3 = repoTrackingHooks('team-line-kept', before3);
  const r3 = ensureIgnored(repo3);
  const after3 = readFileSync(join(repo3, '.gitignore'), 'utf8');
  check('a .githooks/ line outside the plugin block is left alone',
        after3 === before3);
  check('ensureIgnored reports no removal for a line outside the block', r3.removedHooksLine === false);

  // 4. the block comment is removed too once removal empties the block, and
  //    the blank lines on either side collapse to one
  const before4 =
    `.claude/*\n!.claude/manifest/\n.mcp.json\n\n${COMMENT}\n.githooks/\n\nnode_modules/\n`;
  const repo4 = repoTrackingHooks('empty-block', before4);
  const r4 = ensureIgnored(repo4);
  const after4 = readFileSync(join(repo4, '.gitignore'), 'utf8');
  check('the now-empty block\'s comment line is removed too', !after4.includes(COMMENT));
  check('no double blank line is left behind', !after4.includes('\n\n\n'));
  check('the lines on either side of the removed block survive',
        after4.includes('.mcp.json') && after4.includes('node_modules/'));
  check('ensureIgnored still reports the removal', r4.removedHooksLine === true);
  console.log(`  before:\n${before4.split('\n').map(l => `    ${l}`).join('\n')}`);
  console.log(`  after:\n${after4.split('\n').map(l => `    ${l}`).join('\n')}`);

  // 5. a dry run changes nothing
  const before5 = before1;
  const repo5 = repoTrackingHooks('dry-run', before5);
  const dryRun = execFileSync('node', [join(SCRIPTS, 'init-gitignore.mjs'), '--repo', repo5, '--dry-run'],
                               { encoding: 'utf8' });
  const after5 = readFileSync(join(repo5, '.gitignore'), 'utf8');
  check('a dry run leaves the file untouched', after5 === before5);
  check('a dry run reports the pending removal',
        dryRun.includes('to remove  .githooks/  (the repository now tracks its own hooks there)'));

  // the missingLines() listing agrees with what ensureIgnored() did
  const status = missingLines(repo1);
  check('missingLines finds no more stale lines once removed', status.staleHooks.length === 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
