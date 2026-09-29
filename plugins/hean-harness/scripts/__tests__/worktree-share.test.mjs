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
         lstatSync, readlinkSync, readdirSync, symlinkSync, realpathSync, chmodSync } from 'node:fs';
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
  check('status labels the differing file conflict', /^\s*conflict\s+\.claude\/agent-memory\/dev\/MEMORY\.md$/m.test(status.stdout), status.stdout);

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
  const c2 = repoWithWorktree('merge-refused');
  put(join(c2.main, '.claude', 'rules', 'r.md'), 'm\n');
  put(join(c2.wt, '.claude', 'rules', 'r.md'), 'w\n');
  const noMerged = cli(c2.wt, 'resolve', '--file', '.claude/rules/r.md', '--keep', 'merged');
  check('merged without --merged-from is refused, naming the option',
        noMerged.status !== 0 && /--merged-from/.test(noMerged.stderr + noMerged.stdout), noMerged.stderr);

  // ==== more table rows: .mcp.json move / replace / conflict, main-only memory, nothing anywhere ====
  const e1 = repoWithWorktree('rows-move');
  put(join(e1.wt, '.mcp.json'), 'wt only\n');
  const r1 = cli(e1.wt, 'sync');
  check('worktree-only .mcp.json moves to main and is linked',
        readFileSync(join(e1.main, '.mcp.json'), 'utf8') === 'wt only\n' && linkTo(join(e1.wt, '.mcp.json')) === join(e1.main, '.mcp.json') && /^\s+move\s+\.mcp\.json$/m.test(r1.stdout), r1.stdout);
  check('a second sync leaves the moved .mcp.json alone', !/^\s+(link|move|replace)\s/m.test(cli(e1.wt, 'sync').stdout));
  const e2 = repoWithWorktree('rows-replace');
  put(join(e2.main, '.mcp.json'), 'same-mcp-content\n');
  put(join(e2.wt, '.mcp.json'), 'same-mcp-content\n');
  const r2 = cli(e2.wt, 'sync');
  check('identical .mcp.json becomes a link and the replaced copy is backed up',
        linkTo(join(e2.wt, '.mcp.json')) === join(e2.main, '.mcp.json') && /^\s+replace\s+\.mcp\.json$/m.test(r2.stdout) && backups().includes('same-mcp-content\n'), r2.stdout);
  const e3 = repoWithWorktree('rows-conflict');
  put(join(e3.main, '.mcp.json'), 'main\n');
  put(join(e3.wt, '.mcp.json'), 'wt\n');
  const r3 = cli(e3.wt, 'sync');
  check('differing .mcp.json is reported and both copies stay',
        /^\s+differs\s+\.mcp\.json$/m.test(r3.stdout) && readFileSync(join(e3.wt, '.mcp.json'), 'utf8') === 'wt\n' && linkTo(join(e3.wt, '.mcp.json')) === null && readFileSync(join(e3.main, '.mcp.json'), 'utf8') === 'main\n', r3.stdout);
  const e4 = repoWithWorktree('rows-memory');
  put(join(e4.main, '.claude', 'agent-memory', 'dev', 'only-main.md'), 'm\n');
  cli(e4.wt, 'sync');
  check('main-only agent memory file is linked',
        linkTo(join(e4.wt, '.claude', 'agent-memory', 'dev', 'only-main.md')) === join(e4.main, '.claude', 'agent-memory', 'dev', 'only-main.md'));
  check('a file missing in both checkouts is not created',
        !existsSync(join(e4.wt, '.mcp.json')) && !existsSync(join(e4.main, '.mcp.json')) && linkTo(join(e4.wt, '.mcp.json')) === null);

  // ==== a main entry that is a symlink is never written through ====
  const f = repoWithWorktree('mainlink');
  put(join(root, 'dotfiles-mcp.json'), 'outside\n');
  symlinkSync(join(root, 'dotfiles-mcp.json'), join(f.main, '.mcp.json'));
  put(join(f.wt, '.mcp.json'), 'wt\n');
  cli(f.wt, 'sync');
  check('a main .mcp.json that is a symlink: the outside file and the worktree file are untouched',
        readFileSync(join(root, 'dotfiles-mcp.json'), 'utf8') === 'outside\n' &&
        readFileSync(join(f.wt, '.mcp.json'), 'utf8') === 'wt\n' && linkTo(join(f.wt, '.mcp.json')) === null);

  // ==== a main folder that is a symlink does not disable sharing ====
  const k = repoWithWorktree('mainfolderlink');
  mkdirSync(join(root, 'outside-dev'), { recursive: true });
  mkdirSync(join(k.main, '.claude', 'agent-memory'), { recursive: true });
  symlinkSync(join(root, 'outside-dev'), join(k.main, '.claude', 'agent-memory', 'dev'));
  put(join(k.main, '.mcp.json'), 'main mcp\n');
  put(join(k.wt, '.claude', 'agent-memory', 'dev', 'x.md'), 'x\n');
  const rk = cli(k.wt, 'sync');
  check('a symlinked main folder: .mcp.json is still linked', linkTo(join(k.wt, '.mcp.json')) === join(k.main, '.mcp.json'), rk.stdout + rk.stderr);
  check('a symlinked main folder: nothing is written through it',
        readdirSync(join(root, 'outside-dev')).length === 0 && readFileSync(join(k.wt, '.claude', 'agent-memory', 'dev', 'x.md'), 'utf8') === 'x\n');

  // ==== a worktree folder that is a symlink never lets a file replace itself ====
  const l = repoWithWorktree('wtfolderlink');
  put(join(l.main, '.claude', 'rules', 'r.md'), 'rule\n');
  put(join(l.main, '.claude', 'agent-memory', 'dev', 'n.md'), 'note\n');
  put(join(l.main, '.mcp.json'), 'mcp\n');
  rmSync(join(l.wt, '.claude'), { recursive: true, force: true });
  symlinkSync(join(l.main, '.claude'), join(l.wt, '.claude'));
  const rl = cli(l.wt, 'sync');
  const regular = f => { try { return lstatSync(f).isFile(); } catch { return false; } };
  check('a worktree .claude that links to the main .claude: every main file stays a regular file with its content',
        regular(join(l.main, '.claude', 'rules', 'r.md')) && readFileSync(join(l.main, '.claude', 'rules', 'r.md'), 'utf8') === 'rule\n' &&
        regular(join(l.main, '.claude', 'agent-memory', 'dev', 'n.md')) && readFileSync(join(l.main, '.claude', 'agent-memory', 'dev', 'n.md'), 'utf8') === 'note\n', rl.stdout + rl.stderr);
  check('that sync replaces nothing under .claude and reports no failure', !/replace\s+\.claude|failed/.test(rl.stdout) && rl.status === 0, rl.stdout);
  check('.mcp.json is still linked there', linkTo(join(l.wt, '.mcp.json')) === join(l.main, '.mcp.json'));

  const n = repoWithWorktree('wtagentlink');
  mkdirSync(join(root, 'outside-agent'), { recursive: true });
  put(join(root, 'outside-agent', 'o.md'), 'outside\n');
  put(join(n.main, '.claude', 'agent-memory', 'dev', 'o.md'), 'outside\n');
  mkdirSync(join(n.wt, '.claude', 'agent-memory'), { recursive: true });
  symlinkSync(join(root, 'outside-agent'), join(n.wt, '.claude', 'agent-memory', 'dev'));
  cli(n.wt, 'sync');
  check('a worktree agent-memory folder that links outside: the outside file is untouched',
        readFileSync(join(root, 'outside-agent', 'o.md'), 'utf8') === 'outside\n' && regular(join(root, 'outside-agent', 'o.md')) &&
        readFileSync(join(n.main, '.claude', 'agent-memory', 'dev', 'o.md'), 'utf8') === 'outside\n');

  // ==== uninstall reaches the main checkout's saved answers when setup ran in a worktree ====
  const u = repoWithWorktree('uninstall');
  const inst = spawnSync('node', [join(SCRIPTS, 'install-rules.mjs'), '--repo', u.wt], { env, encoding: 'utf8' });
  const { writeSetting } = await import(join(SCRIPTS, 'lib', 'settings.mjs'));
  writeSetting(u.wt, 'commitFormat', 'on');
  check('an answer saved from the worktree lands in the main checkout', existsSync(join(u.main, '.claude', 'hean-harness.json')), inst.stderr);
  const rev = spawnSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env, encoding: 'utf8' });
  check('uninstall deletes the main checkout saved answers file after setup ran in a worktree',
        rev.status === 0 && !existsSync(join(u.main, '.claude', 'hean-harness.json')), rev.stderr + rev.stdout.slice(0, 300));

  // ==== a path the worktree's branch tracks is left alone ====
  const g = repoWithWorktree('branchtracked');
  put(join(g.wt, '.claude', 'rules', 'team.md'), 'team\n');
  git(g.wt, 'add', '-f', '.claude/rules/team.md');
  git(g.wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'track a rule on the branch');
  put(join(g.main, '.claude', 'rules', 'team.md'), 'team\n');
  cli(g.wt, 'sync');
  check('a rule tracked on the worktree branch is not linked and git sees no change',
        linkTo(join(g.wt, '.claude', 'rules', 'team.md')) === null && git(g.wt, 'status', '--porcelain').trim() === '');

  // ==== an unreadable file does not stop the later paths ====
  if (process.getuid && process.getuid() !== 0) {
    const h = repoWithWorktree('unreadable');
    const stat = () => cli(h.wt, 'status');
    const bad = join(h.main, '.claude', 'rules', 'a-bad.md');
    put(bad, 'x\n');
    put(join(h.wt, '.claude', 'rules', 'a-bad.md'), 'x\n');
    put(join(h.main, '.claude', 'rules', 'z-good.md'), 'good\n');
    chmodSync(bad, 0);
    try {
      const out = cli(h.wt, 'sync');
      check('an unreadable file is reported as failed', /failed\s+\.claude\/rules\/a-bad\.md/.test(out.stdout) && out.status === 0, out.stdout + out.stderr);
      const st = stat();
      check('status reports an unreadable file and exits 0', st.status === 0 && /a-bad\.md.*EACCES/.test(st.stdout) && /z-good\.md/.test(st.stdout), st.stdout + st.stderr);
      check('a later path is still linked', linkTo(join(h.wt, '.claude', 'rules', 'z-good.md')) === join(h.main, '.claude', 'rules', 'z-good.md'));
    } finally { chmodSync(bad, 0o644); }
  }

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
