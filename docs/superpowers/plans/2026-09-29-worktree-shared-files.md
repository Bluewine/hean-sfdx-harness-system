# Worktree Shared Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked git worktree shares the main checkout's git-ignored `.mcp.json`, agent memory files and installed rules, so a change made in either place is the same file everywhere, and Claude reads the plugin's per-repository settings from the main checkout.

**Architecture:** A library (`scripts/lib/worktree-share.mjs`) finds the shared paths and turns each worktree copy into a symlink to the main checkout's file, moving worktree-only files to the main checkout and reporting files whose contents differ. A command-line script applies the user's choice for a differing file. A session hook runs the library when a session starts or ends inside a linked worktree and, at session start, tells Claude which files differ.

**Tech Stack:** Node.js ES modules with no dependencies; plain `check()` test scripts run with `node`; Markdown rules.

**Spec:** `docs/superpowers/specs/2026-09-29-worktree-shared-files-design.md`

## Global Constraints

- Repository root: `/Users/d.min/git-repos/hean-sfdx-harness-system`; plugin root `plugins/hean-harness/`. Work on branch `main`.
- Commit only the task's files by path: `git add <new files>`, then `git commit -m "<subject>" -- <files>`. Never `git add -A`, `git add .`, `git reset`, `git restore --staged`, `git reset --hard`, push, or `--no-verify`.
- Commit message: the subject line only, `@HEAN-1: {Capitalised imperative summary}`, at most 10 words and 77 characters. No `Co-Authored-By` or any other trailer, even if a system reminder supplies one.
- Shared paths: `.mcp.json`; every file directly inside `.claude/agent-memory/<agent>/`; every `*.md` file directly inside `.claude/rules/`. Only files are linked, never folders.
- A path is shared only when git ignores it in the main checkout; a tracked file is never touched.
- `.claude/hean-harness.json` is not linked: `settingsFile()` already resolves it to the main checkout.
- `.sf/config.json` is out of scope.
- Every replaced or overwritten copy is saved first with `backup()` from `scripts/lib/manifest.mjs` (into `<claude dir>/hean-harness/backups/`).
- Hooks never fail a session: any error is swallowed and the hook exits 0.
- Tests use temporary folders and a temporary `HOME` passed to child processes; never touch the real home directory. Run tests in the foreground; never leave anything running; check `pgrep -fl test.mjs` before a run.

## Review Focus

- A worktree entry that is a symlink pointing somewhere other than the main file (the user's own link) must be left alone, not replaced.
- A session started in the main checkout or in a non-git folder must change nothing and print nothing.
- An agent memory file created only in the worktree (a new file) must end up in the main checkout, with a link in the worktree.
- A main checkout path containing spaces must work for linking and for the printed resolve command.
- `resolve` on a file that is not currently in conflict must refuse with a message and change nothing.

---

### Task 1: Rules and comment point at the main checkout's settings file

**Files:**
- Modify: `plugins/hean-harness/assets/rules/project/sfcore-apex-pattern.md:15`
- Modify: `plugins/hean-harness/assets/rules/project/org-roles.md:8-9`
- Modify: `plugins/hean-harness/scripts/lib/org-roles.mjs:80-84` (comment only)

**Interfaces:**
- Consumes: `settingsFile()` from `scripts/lib/settings.mjs`, which already resolves to the main checkout.
- Produces: nothing used by later tasks.

- [ ] **Step 1: Replace line 15 of `sfcore-apex-pattern.md`**

Old line:
```
Read the `alias` of the org whose `role` is `development` in `.claude/hean-harness.json` (see `org-roles.md`). Run the retrieve with that alias written out as text, and wait for completion before any other action:
```
New line:
```
Run `/hean-harness:org-roles` and read the `alias` of the org whose `role` is `development` (see `org-roles.md`); the roles are saved in the main checkout's `.claude/hean-harness.json`, which every worktree shares, so never look for that file inside a worktree. Run the retrieve with that alias written out as text, and wait for completion before any other action:
```

- [ ] **Step 2: Replace lines 8-9 of `org-roles.md`**

Old:
```
Every org connected to this project has exactly one role, saved per project in
`.claude/hean-harness.json` under `orgs`, keyed by org ID:
```
New:
```
Every org connected to this project has exactly one role, saved per project in the main checkout's
`.claude/hean-harness.json` under `orgs`, keyed by org ID. Every worktree of the repository reads
and writes that same file:
```

- [ ] **Step 3: Replace the doc comment above `recordHome` in `org-roles.mjs`**

Old:
```js
/**
 * The folder whose hean-harness.json holds the project's roles: the top of the
 * git repository, where setup saves its other answers, or the project itself
 * when it is not in one.
 */
```
New:
```js
/**
 * The folder the project's roles are looked up from: the top of the git
 * repository, or the project itself when it is not in one. settingsFile()
 * then resolves that folder to the main checkout, so a linked worktree reads
 * and writes the main checkout's hean-harness.json.
 */
```

- [ ] **Step 4: Verify**

Run: `node --check plugins/hean-harness/scripts/lib/org-roles.mjs && node plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs`
Expected: exit 0, no `FAIL` line.

- [ ] **Step 5: Commit**

```bash
git commit -m "@HEAN-1: Update org role rules for the main checkout file" -- plugins/hean-harness/assets/rules/project/sfcore-apex-pattern.md plugins/hean-harness/assets/rules/project/org-roles.md plugins/hean-harness/scripts/lib/org-roles.mjs
```

---

### Task 2: Shared-file library and resolve command

**Files:**
- Create: `plugins/hean-harness/scripts/lib/worktree-share.mjs`
- Create: `plugins/hean-harness/scripts/worktree-share.mjs`
- Test: `plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs`

**Interfaces:**
- Consumes: `backup(target)` from `scripts/lib/manifest.mjs` (returns the backup path, or null when the target is missing).
- Produces, used by Task 3:
  - `linkedWorktree(dir)` → `{ worktree: string, main: string } | null`
  - `syncWorktree(dir)` → `null` when `dir` is not in a linked worktree, else `{ worktree, main, applied: [{ rel, action }], conflicts: [rel], failures: [{ rel, error }] }`, where `action` is `'link' | 'move' | 'replace'`.
  - Command: `node <plugin>/scripts/worktree-share.mjs status` and `node <plugin>/scripts/worktree-share.mjs resolve --file <rel> --keep worktree|main|merged [--merged-from <file>]`, both acting on the current folder.

- [ ] **Step 1: Write the failing test** — `plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs`

```js
#!/usr/bin/env node
/**
 * A linked worktree shares the main checkout's git-ignored .mcp.json, agent
 * memory files and rules through symlinks; differing copies are reported and
 * only change when the user chooses.
 *
 * Runs against throwaway repositories and a throwaway HOME. Touches nothing of yours.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync,
         lstatSync, readlinkSync, readdirSync, symlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(SCRIPTS, 'worktree-share.mjs');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean share ')));   // a space on purpose
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
const cli = (cwd, ...args) => spawnSync('node', [CLI, ...args], { cwd, env, encoding: 'utf8' });
const linkTo = file => { try { return lstatSync(file).isSymbolicLink() ? readlinkSync(file) : null; } catch { return null; } };
const backups = () => { const d = join(HOME, '.claude', 'hean-harness', 'backups'); return existsSync(d) ? readdirSync(d).map(f => readFileSync(join(d, f), 'utf8')) : []; };

/** A main checkout that ignores .claude/ and .mcp.json, with one commit, and one linked worktree. */
function repoWithWorktree(name) {
  const main = join(root, name, 'main');
  mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  put(join(main, '.gitignore'), '.claude/\n.mcp.json\n');
  put(join(main, 'tracked.txt'), 'x\n');
  git(main, 'add', '.gitignore', 'tracked.txt');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const wt = join(root, name, 'wt');
  git(main, 'worktree', 'add', '-q', wt, '-b', `${name}-wt`);
  return { main, wt };
}

try {
  // ==== the action table ====
  const a = repoWithWorktree('table');
  put(join(a.main, '.mcp.json'), '{"main":1}\n');                                        // main only -> link
  put(join(a.main, '.claude', 'rules', 'org-roles.md'), 'rule\n');                       // main only -> link
  put(join(a.main, '.claude', 'agent-memory', 'dev', 'same.md'), 'same\n');
  put(join(a.wt, '.claude', 'agent-memory', 'dev', 'same.md'), 'same\n');                // same content -> replace
  put(join(a.wt, '.claude', 'agent-memory', 'dev', 'new-in-wt.md'), 'new\n');            // worktree only -> move
  put(join(a.main, '.claude', 'agent-memory', 'dev', 'MEMORY.md'), 'main index\n');
  put(join(a.wt, '.claude', 'agent-memory', 'dev', 'MEMORY.md'), 'worktree index\n');    // differs -> conflict
  mkdirSync(join(a.wt, '.claude', 'rules'), { recursive: true });
  put(join(root, 'elsewhere.md'), 'mine\n');
  symlinkSync(join(root, 'elsewhere.md'), join(a.wt, '.claude', 'rules', 'mine.md'));   // user's own link -> left alone

  const status = cli(a.wt, 'status');
  check('status exits 0 inside a linked worktree', status.status === 0, status.stderr);
  check('status names the conflicting file', status.stdout.includes('.claude/agent-memory/dev/MEMORY.md'), status.stdout);

  const sync = cli(a.wt, 'sync');
  check('sync exits 0', sync.status === 0, sync.stderr);
  check('main-only .mcp.json is linked', linkTo(join(a.wt, '.mcp.json')) === join(a.main, '.mcp.json'));
  check('main-only rule is linked', linkTo(join(a.wt, '.claude', 'rules', 'org-roles.md')) === join(a.main, '.claude', 'rules', 'org-roles.md'));
  check('identical memory file becomes a link', linkTo(join(a.wt, '.claude', 'agent-memory', 'dev', 'same.md')) === join(a.main, '.claude', 'agent-memory', 'dev', 'same.md'));
  check('worktree-only memory file moves to main',
        readFileSync(join(a.main, '.claude', 'agent-memory', 'dev', 'new-in-wt.md'), 'utf8') === 'new\n' &&
        linkTo(join(a.wt, '.claude', 'agent-memory', 'dev', 'new-in-wt.md')) === join(a.main, '.claude', 'agent-memory', 'dev', 'new-in-wt.md'));
  check('differing file is left as it is in both places',
        readFileSync(join(a.wt, '.claude', 'agent-memory', 'dev', 'MEMORY.md'), 'utf8') === 'worktree index\n' &&
        readFileSync(join(a.main, '.claude', 'agent-memory', 'dev', 'MEMORY.md'), 'utf8') === 'main index\n' &&
        linkTo(join(a.wt, '.claude', 'agent-memory', 'dev', 'MEMORY.md')) === null);
  check('sync reports the conflict', sync.stdout.includes('.claude/agent-memory/dev/MEMORY.md'), sync.stdout);
  check("the user's own link is left alone", linkTo(join(a.wt, '.claude', 'rules', 'mine.md')) === join(root, 'elsewhere.md'));
  check('a write through the link changes the main file', (() => {
    writeFileSync(join(a.wt, '.mcp.json'), '{"edited":1}\n');
    return readFileSync(join(a.main, '.mcp.json'), 'utf8') === '{"edited":1}\n';
  })());
  const again = cli(a.wt, 'sync').stdout;
  check('a second sync links, moves and replaces nothing',
        !/^\s+(link|move|replace)\s/m.test(again) && again.includes('.claude/agent-memory/dev/MEMORY.md'), again);

  // ==== resolve ====
  const refuse = cli(a.wt, 'resolve', '--file', '.mcp.json', '--keep', 'worktree');
  check('resolve refuses a file that is not in conflict', refuse.status !== 0 && /not in conflict/.test(refuse.stderr + refuse.stdout));

  const keepWt = cli(a.wt, 'resolve', '--file', '.claude/agent-memory/dev/MEMORY.md', '--keep', 'worktree');
  check('keep worktree copy: exits 0', keepWt.status === 0, keepWt.stderr);
  check('keep worktree copy: main has the worktree content, worktree is a link, main copy backed up',
        readFileSync(join(a.main, '.claude', 'agent-memory', 'dev', 'MEMORY.md'), 'utf8') === 'worktree index\n' &&
        linkTo(join(a.wt, '.claude', 'agent-memory', 'dev', 'MEMORY.md')) === join(a.main, '.claude', 'agent-memory', 'dev', 'MEMORY.md') &&
        backups().includes('main index\n'));

  const b = repoWithWorktree('keepmain');
  put(join(b.main, '.mcp.json'), 'main\n');
  put(join(b.wt, '.mcp.json'), 'wt\n');
  const keepMain = cli(b.wt, 'resolve', '--file', '.mcp.json', '--keep', 'main');
  check('keep main copy: main unchanged, worktree is a link, worktree copy backed up',
        keepMain.status === 0 && readFileSync(join(b.main, '.mcp.json'), 'utf8') === 'main\n' &&
        linkTo(join(b.wt, '.mcp.json')) === join(b.main, '.mcp.json') && backups().includes('wt\n'), keepMain.stderr);

  const c = repoWithWorktree('merge');
  put(join(c.main, '.claude', 'rules', 'r.md'), 'm\n');
  put(join(c.wt, '.claude', 'rules', 'r.md'), 'w\n');
  put(join(root, 'merged.md'), 'm\nw\n');
  const merged = cli(c.wt, 'resolve', '--file', '.claude/rules/r.md', '--keep', 'merged', '--merged-from', join(root, 'merged.md'));
  check('merged: main has the merged content, worktree is a link, both copies backed up',
        merged.status === 0 && readFileSync(join(c.main, '.claude', 'rules', 'r.md'), 'utf8') === 'm\nw\n' &&
        linkTo(join(c.wt, '.claude', 'rules', 'r.md')) === join(c.main, '.claude', 'rules', 'r.md') &&
        backups().includes('m\n') && backups().includes('w\n'), merged.stderr);
  check('merged without --merged-from is refused',
        cli(c.wt, 'resolve', '--file', '.claude/rules/r.md', '--keep', 'merged').status !== 0);

  // ==== tracked files and other folders ====
  const d = repoWithWorktree('tracked');
  put(join(d.main, '.gitignore'), '.claude/\n');                 // .mcp.json no longer ignored
  put(join(d.main, '.mcp.json'), 'team\n');
  git(d.main, 'add', '.gitignore', '.mcp.json');
  git(d.main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'track mcp');
  cli(d.wt, 'sync');
  check('a tracked .mcp.json is never linked', linkTo(join(d.wt, '.mcp.json')) === null);

  const inMain = cli(a.main, 'sync');
  check('sync in the main checkout changes nothing and says so', inMain.status === 0 && /not a linked worktree/.test(inMain.stdout), inMain.stdout);
  const plain = join(root, 'plain');
  mkdirSync(plain);
  const outside = cli(plain, 'sync');
  check('sync outside any repository exits 0 and says so', outside.status === 0 && /not a linked worktree/.test(outside.stdout), outside.stdout);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n  ${failures} failed` : '\n  all checks passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs`
Expected: FAIL lines (the command script does not exist yet).

- [ ] **Step 3: Write the library** — `plugins/hean-harness/scripts/lib/worktree-share.mjs`

```js
/**
 * Files a linked git worktree shares with the main checkout.
 *
 * `git worktree add` checks out committed files only, so a new worktree has
 * none of the git-ignored files setup and the agents keep in the main
 * checkout. Each shared file in the worktree becomes a symlink to the main
 * checkout's file, so a write in either place is one file. Claude Code does
 * the same for settings.local.json and auto memory; .claude/hean-harness.json
 * needs no link, because settingsFile() already resolves to the main checkout.
 *
 * Only files are linked, never folders, and only files git ignores in the main
 * checkout: a tracked file is the team's. When the two copies differ, nothing
 * changes until the user chooses (resolve), and every copy replaced is saved
 * to the backups folder first.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, statSync, readlinkSync, readFileSync, readdirSync,
         mkdirSync, symlinkSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { backup } from './manifest.mjs';

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };

/** { worktree, main } when dir is inside a linked worktree, otherwise null. */
export function linkedWorktree(dir) {
  let top, common;
  try {
    top = git(dir, 'rev-parse', '--show-toplevel');
    common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  } catch { return null; }
  // A submodule's or bare repository's git folder is not named .git.
  if (!isAbsolute(common) || basename(common) !== '.git') return null;
  const main = dirname(common);
  if (real(top) === real(main)) return null;
  return { worktree: real(top), main: real(main) };
}

const filesIn = dir => {
  try { return readdirSync(dir).filter(n => { const s = lstatSync(join(dir, n)); return s.isFile() || s.isSymbolicLink(); }); }
  catch { return []; }
};
const dirsIn = dir => {
  try { return readdirSync(dir).filter(n => lstatSync(join(dir, n)).isDirectory()); }
  catch { return []; }
};

/** Git ignores rel in the main checkout (and does not track it). */
function ignored(main, rel) {
  try { execFileSync('git', ['-C', main, 'check-ignore', '-q', '--', rel], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/** Every shared path, relative to the checkout root, found in either checkout. */
export function sharedPaths({ worktree, main }) {
  const found = new Set(['.mcp.json']);
  for (const root of [main, worktree]) {
    for (const f of filesIn(join(root, '.claude', 'rules'))) if (f.endsWith('.md')) found.add(`.claude/rules/${f}`);
    const mem = join(root, '.claude', 'agent-memory');
    for (const agent of dirsIn(mem)) for (const f of filesIn(join(mem, agent))) found.add(`.claude/agent-memory/${agent}/${f}`);
  }
  return [...found].sort().filter(rel => ignored(main, rel));
}

const isRegularFile = p => { try { return lstatSync(p).isFile(); } catch { return false; } };
const same = (a, b) => readFileSync(a).equals(readFileSync(b));

/**
 * What to do with one shared path:
 * 'ok' (already linked), 'link', 'move', 'replace', 'conflict',
 * 'none' (neither side has it), 'skip' (the worktree entry is something else,
 * such as the user's own symlink or a folder).
 */
export function inspect({ worktree, main }, rel) {
  const w = join(worktree, rel), m = join(main, rel);
  const mainFile = isRegularFile(m);
  let ws = null;
  try { ws = lstatSync(w); } catch { /* missing */ }
  if (!ws) return mainFile ? 'link' : 'none';
  if (ws.isSymbolicLink()) return resolve(dirname(w), readlinkSync(w)) === m ? 'ok' : 'skip';
  if (!ws.isFile()) return 'skip';
  if (!mainFile) return 'move';
  return same(w, m) ? 'replace' : 'conflict';
}

function link(w, m) {
  mkdirSync(dirname(w), { recursive: true });
  symlinkSync(m, w);
}

/** Carry out 'link', 'move' or 'replace' for one path. */
function apply({ worktree, main }, rel, action) {
  const w = join(worktree, rel), m = join(main, rel);
  if (action === 'move') {
    mkdirSync(dirname(m), { recursive: true });
    copyFileSync(w, m);
  }
  if (action === 'move' || action === 'replace') rmSync(w);
  link(w, m);
}

/** Link every shared path that can be linked; report the ones that differ. */
export function syncWorktree(dir) {
  const pair = linkedWorktree(dir);
  if (!pair) return null;
  const out = { ...pair, applied: [], conflicts: [], failures: [] };
  for (const rel of sharedPaths(pair)) {
    const action = inspect(pair, rel);
    if (action === 'conflict') { out.conflicts.push(rel); continue; }
    if (!['link', 'move', 'replace'].includes(action)) continue;
    try { apply(pair, rel, action); out.applied.push({ rel, action }); }
    catch (e) { out.failures.push({ rel, error: e.message }); }
  }
  return out;
}

/**
 * Apply the user's choice for one differing file.
 * keep: 'worktree' | 'main' | 'merged' (mergedFrom: a file holding the merged content).
 * Returns { backups: [paths] }; throws with a plain message when the choice cannot apply.
 */
export function resolveConflict(dir, rel, keep, mergedFrom) {
  const pair = linkedWorktree(dir);
  if (!pair) throw new Error('This folder is not in a linked worktree.');
  if (!sharedPaths(pair).includes(rel)) throw new Error(`${rel} is not a shared file.`);
  if (inspect(pair, rel) !== 'conflict') throw new Error(`${rel} is not in conflict; nothing to resolve.`);
  if (!['worktree', 'main', 'merged'].includes(keep)) throw new Error('--keep takes worktree, main or merged.');
  if (keep === 'merged' && !(mergedFrom && existsSync(mergedFrom) && statSync(mergedFrom).isFile())) {
    throw new Error('--keep merged needs --merged-from <file holding the merged content>.');
  }
  const w = join(pair.worktree, rel), m = join(pair.main, rel);
  const saved = [];
  if (keep !== 'main') saved.push(backup(m));
  if (keep !== 'worktree') saved.push(backup(w));
  if (keep === 'worktree') copyFileSync(w, m);
  if (keep === 'merged') copyFileSync(mergedFrom, m);
  rmSync(w);
  link(w, m);
  return { backups: saved.filter(Boolean) };
}
```

- [ ] **Step 4: Write the command script** — `plugins/hean-harness/scripts/worktree-share.mjs`

```js
#!/usr/bin/env node
/**
 * Shows, links and resolves the files a linked worktree shares with the main
 * checkout (see lib/worktree-share.mjs). Acts on the current folder.
 *
 *   status                                   list each shared file and what sync would do
 *   sync                                     link what can be linked, list what differs
 *   resolve --file <rel> --keep worktree|main|merged [--merged-from <file>]
 */

import { linkedWorktree, sharedPaths, inspect, syncWorktree, resolveConflict } from './lib/worktree-share.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const log = (...a) => console.log(...a);
const cwd = process.cwd();

function main() {
  if (cmd === 'status') {
    const pair = linkedWorktree(cwd);
    if (!pair) { log('This folder is not a linked worktree, so nothing is shared.'); return 0; }
    log(`Worktree       ${pair.worktree}`);
    log(`Main checkout  ${pair.main}`);
    for (const rel of sharedPaths(pair)) log(`  ${inspect(pair, rel).padEnd(9)} ${rel}`);
    return 0;
  }
  if (cmd === 'sync') {
    const r = syncWorktree(cwd);
    if (!r) { log('This folder is not a linked worktree, so nothing is shared.'); return 0; }
    if (!r.applied.length && !r.conflicts.length && !r.failures.length) log('Shared files: nothing to change.');
    for (const a of r.applied) log(`  ${a.action.padEnd(8)} ${a.rel}`);
    for (const f of r.failures) log(`  failed   ${f.rel}  ${f.error}`);
    for (const c of r.conflicts) log(`  differs  ${c}`);
    return 0;
  }
  if (cmd === 'resolve') {
    const file = opt('file'), keep = opt('keep');
    if (!file || !keep) { console.error('resolve needs --file <rel> and --keep worktree|main|merged.'); return 1; }
    try {
      const r = resolveConflict(cwd, file, keep, opt('merged-from'));
      log(`Resolved ${file}: kept the ${keep} copy; the worktree entry is now a link to the main checkout.`);
      for (const b of r.backups) log(`  backup  ${b}`);
      return 0;
    } catch (e) { console.error(e.message); return 1; }
  }
  console.error('Usage: worktree-share.mjs status | sync | resolve --file <rel> --keep worktree|main|merged [--merged-from <file>]');
  return 1;
}

process.exit(main());
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs`
Expected: every line `pass`, final line `all checks passed`, exit 0.

- [ ] **Step 6: Run the other script tests** (setup must be unaffected)

Run each, one at a time, foreground: every file in `plugins/hean-harness/scripts/__tests__/` (`setup-twice.test.mjs` needs a timeout of at least 10 minutes).
Expected: each exits 0, no `FAIL` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/scripts/lib/worktree-share.mjs plugins/hean-harness/scripts/worktree-share.mjs plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs
git commit -m "@HEAN-1: Add worktree shared-file library and resolve command" -- plugins/hean-harness/scripts/lib/worktree-share.mjs plugins/hean-harness/scripts/worktree-share.mjs plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs
```

---

### Task 3: Session hook that shares the files

**Files:**
- Create: `plugins/hean-harness/hooks/worktree-share.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json` (add to `SessionStart`, add a `SessionEnd` block)
- Modify: `docs/wiki-coverage.md` (Hooks table)
- Test: `plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs`

**Interfaces:**
- Consumes: `syncWorktree(dir)` from Task 2; hook input JSON on stdin with `cwd` and `hook_event_name`.
- Produces: nothing used by later tasks.

- [ ] **Step 1: Write the failing test** — `plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs`

```js
#!/usr/bin/env node
/**
 * The session hook shares a linked worktree's files at session start and end,
 * tells Claude at session start which files differ, and stays silent and
 * harmless everywhere else.
 *
 * Runs against throwaway repositories and a throwaway HOME. Touches nothing of yours.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync, realpathSync } from 'node:fs';
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
  check('unreadable input: exits 0', bad.status === 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n  ${failures} failed` : '\n  all checks passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs`
Expected: FAIL lines (the hook does not exist yet).

- [ ] **Step 3: Write the hook** — `plugins/hean-harness/hooks/worktree-share.mjs`

```js
#!/usr/bin/env node
/**
 * At session start and end inside a linked git worktree, links the worktree's
 * shared git-ignored files to the main checkout's (lib/worktree-share.mjs).
 *
 * Session start: files whose two copies differ are listed for Claude, who asks
 * the user about each one; nothing changes until the user chooses. Session end:
 * links and moves only, silently, since the session is closing; the next
 * session start in that worktree reports anything still differing.
 *
 * Never fails a session: any error is swallowed and it exits 0.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(PLUGIN, 'scripts', 'worktree-share.mjs');

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const { syncWorktree } = await import('../scripts/lib/worktree-share.mjs');
  const r = syncWorktree(input.cwd ?? process.cwd());
  if (r && input.hook_event_name === 'SessionStart' && (r.conflicts.length || r.failures.length)) {
    const lines = [];
    if (r.conflicts.length) {
      lines.push(`!! Shared files differ between this worktree and the main checkout (${r.main}):`);
      for (const rel of r.conflicts) {
        lines.push(`  ${rel}`);
        lines.push(`    worktree:      ${join(r.worktree, rel)}`);
        lines.push(`    main checkout: ${join(r.main, rel)}`);
      }
      lines.push('');
      lines.push('Before other work, show the user the difference for each file and ask about it in its own');
      lines.push('AskUserQuestion (header "Shared file") with the options "Merge", "Keep worktree copy" and');
      lines.push('"Keep main copy". Apply each answer with:');
      lines.push(`  node "${CLI}" resolve --file <file> --keep worktree|main`);
      lines.push('For "Merge", write the merged content to a temporary file, show it to the user, then run the');
      lines.push('same command with --keep merged --merged-from <temporary file>.');
    }
    for (const f of r.failures) lines.push(`!! Could not link ${f.rel} to the main checkout: ${f.error}`);
    console.log(lines.join('\n'));
  }
} catch {
  // never let this stop a session
}
process.exit(0);
```

- [ ] **Step 4: Register the hook in `plugins/hean-harness/hooks/hooks.json`**

Replace the `SessionStart` block:
```json
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/check-installed.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
```
with:
```json
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/check-installed.mjs\"",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/worktree-share.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/worktree-share.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
```

- [ ] **Step 5: Add the wiki coverage row** — in `docs/wiki-coverage.md`, Hooks table, after the last existing hook row, add:
```
| worktree-share.mjs | Hooks | pending |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run, one at a time, foreground:
- `node plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs`
- `node plugins/hean-harness/scripts/__tests__/worktree-share.test.mjs`
- `node -e "JSON.parse(require('fs').readFileSync('plugins/hean-harness/hooks/hooks.json','utf8'))"`
- every other file in `plugins/hean-harness/hooks/__tests__/`

Expected: each exits 0 with no `FAIL` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/hooks/worktree-share.mjs plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs
git commit -m "@HEAN-1: Add session hook that shares worktree files" -- plugins/hean-harness/hooks/worktree-share.mjs plugins/hean-harness/hooks/__tests__/worktree-share.test.mjs plugins/hean-harness/hooks/hooks.json docs/wiki-coverage.md
```
