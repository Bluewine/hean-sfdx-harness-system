#!/usr/bin/env node
/**
 * Which commits the per-story manifest check lets through, which it refuses,
 * and what it leaves on disk.
 *
 * No org is called. PATH starts with a fake `sf` that maps classes/*.cls to
 * ApexClass and flows/*.flow-meta.xml to Flow and writes the package.xml that
 * branch-manifest reads; FAKE_SF_SLEEP_MS makes it slow. Each repository is a
 * throwaway SFDX repository. CLAUDE_CONFIG_DIR is a throwaway folder, so the
 * rebuilt manifests the hook writes outside the repository land there.
 *
 * Run: node hooks/__tests__/manifest-commit-check.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync,
         renameSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'manifest-commit-check.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'manifest-check-')));
const BIN = join(sandbox, 'bin');
const NO_SF = join(sandbox, 'no-sf');
mkdirSync(BIN);
mkdirSync(NO_SF);
const FAKE_SF = String.raw`#!${process.execPath}
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const ms = Number(process.env.FAKE_SF_SLEEP_MS || 0);
if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const types = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--source-dir') continue;
  const p = args[++i];
  const cls = /\/classes\/([^/]+?)\.cls(?:-meta\.xml)?$/.exec(p);
  const flow = /\/flows\/([^/]+?)\.flow-meta\.xml$/.exec(p);
  const hit = cls ? ['ApexClass', cls[1]] : flow ? ['Flow', flow[1]] : null;
  if (!hit) {
    console.log(JSON.stringify({ status: 1, message: path.resolve(p) + ': Could not infer a metadata type' }));
    process.exit(1);
  }
  (types[hit[0]] ??= new Set()).add(hit[1]);
}
const blocks = Object.keys(types).sort().map(t =>
  '    <types>\n' + [...types[t]].sort().map(m => '        <members>' + m + '</members>\n').join('') +
  '        <name>' + t + '</name>\n    </types>\n');
fs.mkdirSync(value('--output-dir'), { recursive: true });
fs.writeFileSync(path.join(value('--output-dir'), value('--name')),
  '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  blocks.join('') + '    <version>67.0</version>\n</Package>\n');
console.log(JSON.stringify({ status: 0 }));
`;
writeFileSync(join(BIN, 'sf'), FAKE_SF);
chmodSync(join(BIN, 'sf'), 0o755);
// a PATH with git and node but no sf
symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(NO_SF, 'git'));
symlinkSync(process.execPath, join(NO_SF, 'node'));
const NO_SF_PATH = `${NO_SF}:/usr/bin:/bin`;

const CONFIG = join(sandbox, 'config');
mkdirSync(CONFIG);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CONFIG, PATH: `${BIN}:${process.env.PATH}` };

const CLASSES = 'force-app/main/default/classes';
const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const addClass = (repo, name) => {
  write(repo, `${CLASSES}/${name}.cls`, `public class ${name} {}\n`);
  write(repo, `${CLASSES}/${name}.cls-meta.xml`, '<ApexClass/>\n');
};
/** Run a command a refusal printed, as Claude would type it in the given folder. */
const run = (cwd, command) => execFileSync('sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A throwaway SFDX repository: class A committed on integration, then a story branch checked out.
 * setup: false leaves out .claude/hean-harness.json, the file setup writes, as in a repository setup never ran in.
 */
function makeRepo(name, branch, { setup = true } = {}) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  write(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
  write(repo, '.gitignore', '.claude/*\n!.claude/manifest/\n.githooks/\n');
  write(repo, 'notes.txt', 'one\n');
  addClass(repo, 'A');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', branch);
  if (setup) write(repo, '.claude/hean-harness.json', '{"commitFormat":"off"}\n');
  return repo;
}

/** Run the hook as Claude Code does before a Bash call: { deny, warn }, each null when absent. */
function hook(repo, command, { cwd = repo, extraEnv = {} } = {}) {
  const out = execFileSync(process.execPath, [HOOK], { env: { ...env, ...extraEnv }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'test', cwd, tool_input: { command } }) });
  const o = out.trim() ? JSON.parse(out) : {};
  return {
    deny: o.hookSpecificOutput?.permissionDecision === 'deny' ? o.hookSpecificOutput.permissionDecisionReason : null,
    warn: o.systemMessage ?? null
  };
}

/** The commands a refusal prints, in order: its lines indented by four spaces, before any list of components. */
const commandsOf = text => (text ?? '').split(/\n\n(?:Added|Dropped):/)[0]
  .split('\n').filter(l => l.startsWith('    ')).map(l => l.slice(4));

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;

const OUT_OF_DATE = 'is out of date for this commit';
const NOT_CHECKED = '!! The per-story manifest was not checked';
const M = '.claude/manifest/ABC-1.xml';
const repo = makeRepo('story', 'work-ABC-1_story');
const ADD = `git -C '${repo}' add ${M}`;
const RM = `git -C '${repo}' rm -f ${M}`;
const manifest = () => existsSync(join(repo, M)) ? readFileSync(join(repo, M), 'utf8') : null;
const SCRATCH = join(CONFIG, 'hean-harness', 'manifest-check',
                     createHash('sha1').update(repo).digest('hex').slice(0, 12), 'ABC-1.xml');
const scratch = () => existsSync(SCRATCH) ? readFileSync(SCRATCH, 'utf8') : null;
const unstageManifest = () => { git(repo, 'reset', '-q', '--', M); git(repo, 'checkout', '--', M); };
let r;

console.log('Out of date');
addClass(repo, 'B');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit -m "@ABC-1: Add B"');
has('a missing manifest is refused', r.deny, OUT_OF_DATE, `cp '${SCRATCH}' '${join(repo, M)}'`, ADD, 'ApexClass: B');
check('the refusal leaves the repository without a manifest', manifest() === null, manifest());
check('the refusal changes nothing in the repository', git(repo, 'status', '--porcelain') === `A  ${CLASSES}/B.cls\nA  ${CLASSES}/B.cls-meta.xml`,
      git(repo, 'status', '--porcelain'));
check('the rebuilt manifest is written outside the repository',
      Boolean(scratch()?.includes('<members>B</members>')) && !scratch().includes('<members>A</members>'), scratch());
check('a missing manifest gets one command to run', commandsOf(r.deny).length === 1, JSON.stringify(commandsOf(r.deny)));
has('the refusal says to run the command in its own call', r.deny, 'in its own Bash call', 'as a separate call');
check('a refusal for a commit that stages nothing itself names no git add to repeat',
      !r.deny.includes('including its git add'), r.deny);
const chained = hook(repo, `${commandsOf(r.deny)[0]} && git commit -m "@ABC-1: Add B"`);
check('the command chained with the commit for a new manifest is not passed as checked', chained.deny === null, JSON.stringify(chained));
has('the command chained with the commit for a new manifest says it was not checked', chained.warn, NOT_CHECKED);
check('the chained call changes nothing in the repository', manifest() === null, manifest());
run(repo, commandsOf(r.deny)[0]);
check('the printed command puts the rebuilt manifest in place', manifest() !== null && manifest() === scratch(), manifest());
check('the printed command stages the manifest', git(repo, 'diff', '--cached', '--name-only').split('\n').includes(M));
r = hook(repo, 'git commit -m "@ABC-1: Add B"');
check('the commit is allowed after the printed command', silent(r), JSON.stringify(r));

console.log('Staged in the same call');
git(repo, 'reset', '-q', '--', M);
r = hook(repo, `git add ${M} && git commit -m "@ABC-1: Add B"`);
check('adding the rebuilt manifest in the same call is allowed', silent(r), JSON.stringify(r));
git(repo, 'add', M);
git(repo, 'commit', '-q', '-m', 'B');

console.log('Current');
write(repo, `${CLASSES}/B.cls`, 'public class B { Integer i; }\n');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit -m "@ABC-1: Update B"');
check('a change to a component the manifest lists is allowed', silent(r), JSON.stringify(r));
git(repo, 'commit', '-q', '-m', 'B again');
write(repo, 'notes.txt', 'two\n');
git(repo, 'add', 'notes.txt');
r = hook(repo, 'git commit -m "@ABC-1: Update notes"', { extraEnv: { PATH: NO_SF_PATH } });
check('a commit outside the package folders is not checked, and sf is not run', silent(r), JSON.stringify(r));
git(repo, 'commit', '-q', '-m', 'notes');
const committed = manifest();
addClass(repo, 'Z');
r = hook(repo, `git add ${CLASSES} && git commit -m "@ABC-1: Add Z"`);
has('a refused call that staged files itself says to run it again with its git add', r.deny, OUT_OF_DATE,
    'run the same call again, including its git add');
check('that refusal does not say to run the commit alone', !r.deny?.includes('run the commit again'), r.deny);
rmSync(join(repo, CLASSES, 'Z.cls'));
rmSync(join(repo, CLASSES, 'Z.cls-meta.xml'));

console.log('git commit -a');
write(repo, `${CLASSES}/A.cls`, 'public class A { Integer j; }\n');
addClass(repo, 'Untracked');
r = hook(repo, 'git commit -am "@ABC-1: Update A"');
has('commit -a counts tracked edits', r.deny, OUT_OF_DATE, ADD, 'ApexClass: A');
check('commit -a leaves untracked files out', !r.deny?.includes('Untracked') && !scratch().includes('Untracked'), scratch());
check('a stale manifest is left as committed', manifest() === committed, manifest());
const chainedStale = hook(repo, `${commandsOf(r.deny)[0]} && git commit -am "@ABC-1: Update A"`);
has('the command chained with the commit for a stale manifest is refused again', chainedStale.deny, OUT_OF_DATE);
run(repo, commandsOf(r.deny)[0]);
r = hook(repo, 'git commit -am "@ABC-1: Update A"');
check('commit -a is allowed after the printed command', silent(r), JSON.stringify(r));
unstageManifest();

console.log('Commit by path');
r = hook(repo, `git commit -m "@ABC-1: Update A" -- ${CLASSES}/A.cls`);
const retryByPath = `git commit -m '@ABC-1: Update A' -- ${CLASSES}/A.cls '${join(repo, M)}'`;
has('a commit by path without the manifest is refused', r.deny, OUT_OF_DATE, ADD, retryByPath);
check('a commit by path gets the copy, then the commit to retry', commandsOf(r.deny)[1] === retryByPath,
      JSON.stringify(commandsOf(r.deny)));
check('a refused commit by path leaves the manifest as committed', manifest() === committed, manifest());
const [copyByPath, retry] = commandsOf(r.deny);
run(repo, copyByPath);
r = hook(repo, retry);
check('the printed commit by path is allowed after the printed command', silent(r), JSON.stringify(r));
run(repo, retry);
check('the printed commit by path records the rebuilt manifest', git(repo, 'show', `HEAD:${M}`) === scratch().trim());
git(repo, 'reset', '-q', '--hard', 'HEAD~1');
git(repo, 'clean', '-qfd');
write(repo, `${CLASSES}/A.cls`, 'public class A { Integer f; }\n');
addClass(repo, 'Loose');
r = hook(repo, 'git commit -m "@ABC-1: Update A" -- force-app');
has('a commit by folder path is checked', r.deny, OUT_OF_DATE, 'ApexClass: A');
check('a commit by folder path leaves an untracked file in the folder out',
      !r.deny?.includes('Loose') && !scratch()?.includes('Loose'), scratch());
const [copyFolder, retryFolder] = commandsOf(r.deny);
run(repo, copyFolder);
r = hook(repo, retryFolder ?? 'true');
check('the printed commit by folder path is allowed after the printed command', silent(r), JSON.stringify(r));
run(repo, retryFolder ?? 'true');
check('the commit by folder path records a manifest without the untracked file',
      git(repo, 'show', `HEAD:${M}`).includes('<members>A</members>') && !git(repo, 'show', `HEAD:${M}`).includes('Loose') &&
        !git(repo, 'ls-tree', '-r', '--name-only', 'HEAD').includes('Loose'));
git(repo, 'reset', '-q', '--hard', 'HEAD~1');
git(repo, 'clean', '-qfd');
addClass(repo, 'Q');
const qPaths = `${CLASSES}/Q.cls ${CLASSES}/Q.cls-meta.xml`;
r = hook(repo, `git add ${qPaths} && git commit -m "@ABC-1: Add Q" -- ${qPaths}`);
const retryQ = `git add ${qPaths} && git commit -m '@ABC-1: Add Q' -- ${qPaths} '${join(repo, M)}'`;
check('a refused commit by path that staged files itself retries with its git add',
      commandsOf(r.deny)[1] === retryQ && r.deny.includes('including its git add'), JSON.stringify(commandsOf(r.deny)));
run(repo, commandsOf(r.deny)[0]);
r = hook(repo, retryQ);
check('the printed call with its git add is allowed after the printed command', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--hard');
git(repo, 'clean', '-qfd');

console.log('Nothing left to list');
git(repo, 'rm', '-q', `${CLASSES}/B.cls`, `${CLASSES}/B.cls-meta.xml`);
r = hook(repo, 'git commit -m "@ABC-1: Remove B"');
has('a manifest with nothing left to list is refused with git rm', r.deny, 'nothing left to list', RM);
check('the hook does not delete the manifest itself', manifest() === committed);
run(repo, commandsOf(r.deny)[0]);
r = hook(repo, 'git commit -m "@ABC-1: Remove B"');
check('the commit is allowed after the printed git rm', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--hard');
write(repo, M, `${committed}<!-- edited by hand -->\n`);
git(repo, 'rm', '-q', `${CLASSES}/B.cls`, `${CLASSES}/B.cls-meta.xml`);
r = hook(repo, 'git commit -m "@ABC-1: Remove B"');
has('an edited manifest with nothing left to list is refused with git rm -f', r.deny, 'nothing left to list', RM);
run(repo, commandsOf(r.deny)[0]);
check('the printed git rm -f removes an edited manifest', manifest() === null, manifest());
r = hook(repo, 'git commit -m "@ABC-1: Remove B"');
check('the commit is allowed after the printed git rm -f', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--hard');
rmSync(join(repo, CLASSES, 'B.cls'));
rmSync(join(repo, CLASSES, 'B.cls-meta.xml'));
r = hook(repo, `git commit -m "@ABC-1: Remove B" -- ${CLASSES}/B.cls ${CLASSES}/B.cls-meta.xml`);
const retryRm = `git commit -m '@ABC-1: Remove B' -- ${CLASSES}/B.cls ${CLASSES}/B.cls-meta.xml '${join(repo, M)}'`;
check('an empty manifest in a commit by path gets git rm, then the commit to retry',
      JSON.stringify(commandsOf(r.deny)) === JSON.stringify([RM, retryRm]), JSON.stringify(commandsOf(r.deny)));
run(repo, RM);
r = hook(repo, retryRm);
check('the printed commit by path is allowed after the printed git rm', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--hard');

console.log('Skipped');
addClass(repo, 'D');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit --dry-run -m "x"');
check('a dry run is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
write(repo, '.gitignore', '.claude/\n.githooks/\n');
r = hook(repo, 'git commit -m "x"');
check('an ignored manifest is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
git(repo, 'checkout', '--', '.gitignore');
for (const branch of ['work-ABC-1-HF', 'work-ABC-1-BM', 'hotfix-ABC-1', 'feature/no-work-id']) {
  git(repo, 'checkout', '-q', '-b', branch);
  r = hook(repo, 'git commit -m "x"');
  check(`branch ${branch} is not checked`, silent(r) && manifest() === committed, JSON.stringify(r));
  git(repo, 'checkout', '-q', 'work-ABC-1_story');
}
git(repo, 'reset', '-q', '--hard');
git(repo, 'clean', '-qfd');
git(repo, 'checkout', '-q', '-b', 'other', 'integration');
addClass(repo, 'E');
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'E');
git(repo, 'checkout', '-q', 'work-ABC-1_story');
git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'other');
r = hook(repo, 'git commit -m "x"');
check('a merge in progress is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
git(repo, 'merge', '--abort');
const plain = join(sandbox, 'plain');
mkdirSync(plain);
git(plain, 'init', '-q', '-b', 'work-ABC-2_story');
addClass(plain, 'P');
git(plain, 'add', '-A');
check('a repository without sfdx-project.json is not checked', silent(hook(plain, 'git commit -m "x"')));
const noSetup = makeRepo('no-setup', 'work-ABC-3_story', { setup: false });
addClass(noSetup, 'N');
git(noSetup, 'add', CLASSES);
check('a repository setup never ran in is not checked', silent(hook(noSetup, 'git commit -m "x"', { extraEnv: { PATH: NO_SF_PATH } })));

console.log('The check cannot run');
addClass(repo, 'F');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit -m "x"', { extraEnv: { PATH: NO_SF_PATH } });
check('sf missing lets the commit through', r.deny === null, JSON.stringify(r));
has('sf missing says the manifest was not checked', r.warn, NOT_CHECKED, 'cannot run sf');
r = hook(repo, 'git commit -m "x"', { extraEnv: { HEAN_MANIFEST_CHECK_DEADLINE_MS: '1000', FAKE_SF_SLEEP_MS: '3000' } });
check('a slow rebuild lets the commit through', r.deny === null, JSON.stringify(r));
has('a slow rebuild names the deadline', r.warn, NOT_CHECKED, 'took longer than 1 second');
r = hook(repo, 'git add "$FILES" && git commit -m "x"');
check('staging the text cannot name lets the commit through', r.deny === null, JSON.stringify(r));
has('staging the text cannot name is not guessed', r.warn, NOT_CHECKED);
r = hook(repo, `git add -p ${CLASSES} && git commit -m "x"`);
has('picked hunks are not guessed', r.warn, NOT_CHECKED);
check('no manifest is written when the check cannot run', manifest() === committed);

console.log('Where the commit runs');
r = hook(repo, 'git commit -m "x"', { cwd: join(repo, 'force-app') });
has('a commit from a subfolder names the repository in the command', r.deny, ADD);
r = hook(repo, `git -C ${repo} commit -m "x"`, { cwd: sandbox });
has('git -C from another folder names the repository in the command', r.deny, ADD);
run(sandbox, commandsOf(r.deny)[0]);
r = hook(repo, `git -C ${repo} commit -m "x"`, { cwd: sandbox });
check('the printed command works from another folder', silent(r), JSON.stringify(r));
unstageManifest();
r = hook(repo, `cd ${repo} && git commit -m "x" -- ${CLASSES}/F.cls`, { cwd: sandbox });
const retryElsewhere = `cd '${repo}' && git commit -m x -- ${CLASSES}/F.cls '${join(repo, M)}'`;
check('a commit by path from another folder retries with cd',
      commandsOf(r.deny)[1] === retryElsewhere, JSON.stringify(commandsOf(r.deny)));
run(sandbox, commandsOf(r.deny)[0]);
r = hook(repo, retryElsewhere, { cwd: sandbox });
check('the printed commit by path works from another folder', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--', M);
rmSync(join(repo, M));
r = hook(repo, `git -c core.quotepath=off --work-tree=${repo} commit -m x -- ${CLASSES}/F.cls`);
const retryGlobal = `git -c core.quotepath=off --work-tree=${repo} commit -m x -- ${CLASSES}/F.cls '${join(repo, M)}'`;
check('a commit by path retries with the original -c and --work-tree',
      commandsOf(r.deny)[1] === retryGlobal, JSON.stringify(commandsOf(r.deny)));
run(repo, commandsOf(r.deny)[0]);
r = hook(repo, retryGlobal);
check('the printed commit by path with -c and --work-tree is allowed', silent(r), JSON.stringify(r));
run(repo, retryGlobal);
check('the printed commit by path with -c and --work-tree records the rebuilt manifest',
      git(repo, 'show', `HEAD:${M}`) === scratch().trim());
check('nothing is written under the real configuration folder',
      !existsSync(join(homedir(), '.claude', 'hean-harness', 'manifest-check', dirname(SCRATCH).split('/').pop())));

console.log('Terminal commits through the git pre-commit hook');
execFileSync(process.execPath, [join(dirname(HOOKS), 'scripts', 'install-manifest-check.mjs')], { env, stdio: 'ignore' });
const term = makeRepo('terminal', 'work-GH-2_story');
const TM = '.claude/manifest/GH-2.xml';
const TERM_SCRATCH = join(CONFIG, 'hean-harness', 'manifest-check',
                          createHash('sha1').update(term).digest('hex').slice(0, 12), 'GH-2.xml');
const TERM_ADD = `git -C '${term}' add ${TM}`;
write(term, '.githooks/pre-commit', readFileSync(join(dirname(HOOKS), 'assets', 'githooks', 'pre-commit'), 'utf8'));
chmodSync(join(term, '.githooks', 'pre-commit'), 0o755);
git(term, 'config', 'core.hooksPath', '.githooks');
// the PATH without sf has no gpg either, and a machine may sign every commit
git(term, 'config', 'commit.gpgsign', 'false');
// a terminal commit: this test may itself run under Claude Code, which sets CLAUDE_CODE_CHILD_SESSION
const termEnv = { ...env };
delete termEnv.CLAUDE_CODE_CHILD_SESSION;
const commit = (args, extraEnv = {}) =>
  spawnSync('git', ['-C', term, 'commit', '-q', ...args], { env: { ...termEnv, ...extraEnv }, encoding: 'utf8' });
const head = () => git(term, 'rev-parse', 'HEAD');

addClass(term, 'B');
git(term, 'add', CLASSES);
const before = head();
let c = commit(['-m', 'B']);
check('a terminal commit with a missing manifest is refused',
      c.status !== 0 && head() === before && c.stderr.includes(OUT_OF_DATE) &&
        c.stderr.includes(`cp '${TERM_SCRATCH}' '${join(term, TM)}'`) && c.stderr.includes(TERM_ADD), c.stderr);
check('the git hook writes nothing into the repository', !existsSync(join(term, TM)) &&
        git(term, 'status', '--porcelain') === `A  ${CLASSES}/B.cls\nA  ${CLASSES}/B.cls-meta.xml`, git(term, 'status', '--porcelain'));
check('the git hook writes the rebuilt manifest outside the repository',
      readFileSync(TERM_SCRATCH, 'utf8').includes('<members>B</members>'));
has('the git hook says to commit again', c.stderr, 'then commit again');
check('the git hook prints one command', commandsOf(c.stderr).length === 1, JSON.stringify(commandsOf(c.stderr)));
run(sandbox, commandsOf(c.stderr)[0]);
check('the retried terminal commit goes through', commit(['-m', 'B']).status === 0);
write(term, `${CLASSES}/A.cls`, 'public class A { Integer k; }\n');
c = commit(['-am', 'A']);
check('commit -a is checked against the index git builds', c.status !== 0 && c.stderr.includes('ApexClass: A'), c.stderr);
run(sandbox, commandsOf(c.stderr)[0]);
check('commit -a goes through after the printed command', commit(['-am', 'A']).status === 0);
addClass(term, 'C');
git(term, 'add', CLASSES);
const cPaths = [`${CLASSES}/C.cls`, `${CLASSES}/C.cls-meta.xml`];
c = commit(['-m', 'C', '--', ...cPaths]);
check('a commit by path is checked against its own index', c.status !== 0 && c.stderr.includes('ApexClass: C'), c.stderr);
has('a refused commit by path says to name the manifest', c.stderr, `needs ${TM} among them`);
run(sandbox, commandsOf(c.stderr)[0]);
check('a commit by path naming the manifest goes through', commit(['-m', 'C', '--', ...cPaths, TM]).status === 0);
git(term, 'rm', '-q', `${CLASSES}/C.cls`, `${CLASSES}/C.cls-meta.xml`, `${CLASSES}/B.cls`, `${CLASSES}/B.cls-meta.xml`);
git(term, 'checkout', '-q', 'HEAD~2', '--', `${CLASSES}/A.cls`);
c = commit(['-m', 'Back to the base']);
check('a terminal commit with nothing left to list is refused with git rm -f',
      c.status !== 0 && c.stderr.includes('nothing left to list') &&
        commandsOf(c.stderr)[0] === `git -C '${term}' rm -f ${TM}`, c.stderr);
git(term, 'reset', '-q', '--hard');
addClass(term, 'D');
git(term, 'add', CLASSES);
c = commit(['-m', 'D'], { PATH: NO_SF_PATH });
check('a terminal commit goes through when sf is missing', c.status === 0 && c.stderr.includes(NOT_CHECKED), c.stderr);
addClass(term, 'E');
git(term, 'add', CLASSES);
const copyDir = join(CONFIG, 'hean-harness', 'hooks');
renameSync(copyDir, `${copyDir}.away`);
c = commit(['-m', 'E']);
check('the git hook does nothing once the check is gone', c.status === 0 && c.stderr === '', c.stderr);
renameSync(`${copyDir}.away`, copyDir);
addClass(term, 'G');
git(term, 'add', CLASSES);
c = commit(['-m', 'G'], { HOME: sandbox, CLAUDE_CONFIG_DIR: '~/config' });
check('the git hook finds the check under a CLAUDE_CONFIG_DIR given as ~/…',
      c.status !== 0 && c.stderr.includes(OUT_OF_DATE) && c.stderr.includes(`cp '${TERM_SCRATCH}'`), c.stderr);
const beforeG = head();
c = commit(['-m', 'G'], { CLAUDE_CODE_CHILD_SESSION: '1' });
check('the git hook skips a commit Claude Code runs, which its own hook has checked',
      c.status === 0 && c.stderr === '' && head() !== beforeG, c.stderr);
addClass(term, 'H');
git(term, 'add', CLASSES);
const copiedCheck = join(copyDir, 'scripts', 'lib', 'manifest-check.mjs');
const goodCheck = readFileSync(copiedCheck, 'utf8');
writeFileSync(copiedCheck, `import './a-library-the-copy-lacks.mjs';\n${goodCheck}`);
const beforeH = head();
c = commit(['-m', 'H']);
check('a fixed-path copy that fails to load lets the commit through', c.status === 0 && head() !== beforeH, c.stderr);
writeFileSync(copiedCheck, goodCheck);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
