#!/usr/bin/env node
/**
 * The session hook shares a linked worktree's files at session start and end,
 * tells Claude at session start which files differ, and stays silent and
 * harmless everywhere else.
 *
 * Runs against throwaway repositories and a throwaway HOME. Touches nothing of yours.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync, realpathSync, chmodSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'worktree-share.mjs');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-share-hook-')));
const HOME = join(root, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
const env = { ...process.env, HOME, CLAUDE_CONFIG_DIR: join(HOME, '.claude') };

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const hook = (cwd, event, raw) => spawnSync('node', [HOOK], {
  env, encoding: 'utf8', input: raw ?? JSON.stringify({ cwd, hook_event_name: event, session_id: 't' })
});
const isLink = f => { try { return lstatSync(f).isSymbolicLink(); } catch { return false; } };

try {
  const main = join(root, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  put(join(main, '.gitignore'), '.claude/\n.mcp.json\n');
  git(main, 'add', '.gitignore');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const wt = join(root, 'wt');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'wt');
  put(join(main, '.claude', 'rules', 'org-roles.md'), 'rule\n');
  put(join(main, '.mcp.json'), 'main\n');
  put(join(wt, '.mcp.json'), 'worktree\n');

  const start = hook(wt, 'SessionStart');
  check('session start exits 0', start.status === 0, start.stderr);
  check('session start links the main-only rule', isLink(join(wt, '.claude', 'rules', 'org-roles.md')));
  check('session start reports the differing file with both paths',
        start.stdout.includes('.mcp.json') && start.stdout.includes(join(main, '.mcp.json')) && start.stdout.includes(join(wt, '.mcp.json')), start.stdout);
  check('session start tells Claude how to resolve',
        start.stdout.includes('AskUserQuestion') && start.stdout.includes('worktree-share.mjs') && start.stdout.includes('resolve'), start.stdout);

  put(join(wt, '.claude', 'agent-memory', 'dev', 'note.md'), 'new\n');
  const end = hook(wt, 'SessionEnd');
  check('session end exits 0 and prints nothing', end.status === 0 && end.stdout === '', end.stdout);
  check('session end moves a new agent memory file to main and links it', isLink(join(wt, '.claude', 'agent-memory', 'dev', 'note.md')));

  check('in the main checkout the hook prints nothing', hook(main, 'SessionStart').stdout === '');
  check('outside any repository the hook prints nothing', hook(root, 'SessionStart').stdout === '');
  const bad = hook(wt, 'SessionStart', 'not json');
  check('unreadable input: exits 0 and prints nothing', bad.status === 0 && bad.stdout === '', bad.stdout);

  // roles saved in the worktree before settings moved to the main checkout
  put(join(wt, '.claude', 'hean-harness.json'), '{}\n');
  const own = hook(wt, 'SessionStart');
  check('session start says the worktree copy of hean-harness.json is no longer read',
        own.stdout.includes(`!! ${join(wt, '.claude', 'hean-harness.json')} is no longer read; answers are saved in ${join(main, '.claude', 'hean-harness.json')}.`), own.stdout);
  check('session end does not print that line', !hook(wt, 'SessionEnd').stdout.includes('no longer read'));
  rmSync(join(wt, '.claude', 'hean-harness.json'));
  check('no such line once the worktree copy is gone', !hook(wt, 'SessionStart').stdout.includes('no longer read'));

  // a worktree .claude folder that is a symlink to the main one holds the real saved answers, not a leftover copy
  const wt2 = join(root, 'wt2');
  git(main, 'worktree', 'add', '-q', wt2, '-b', 'wt2');
  put(join(main, '.claude', 'hean-harness.json'), '{}\n');
  symlinkSync(join(main, '.claude'), join(wt2, '.claude'));
  const viaLink = hook(wt2, 'SessionStart');
  check('a symlinked worktree .claude prints no "no longer read" line', viaLink.status === 0 && !viaLink.stdout.includes('no longer read'), viaLink.stdout);

  // an unreadable main file
  if (process.getuid && process.getuid() !== 0) {
    const badFile = join(main, '.claude', 'rules', 'unreadable.md');
    put(badFile, 'x\n');
    put(join(wt, '.claude', 'rules', 'unreadable.md'), 'x\n');
    chmodSync(badFile, 0);
    try {
      const fail = hook(wt, 'SessionStart');
      check('session start reports a file it could not link', fail.stdout.includes('!! Could not link .claude/rules/unreadable.md'), fail.stdout);
    } finally { chmodSync(badFile, 0o644); }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n  ${failures} failed` : '\n  all checks passed');
process.exit(failures ? 1 : 0);
