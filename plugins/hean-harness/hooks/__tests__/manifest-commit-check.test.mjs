#!/usr/bin/env node
/**
 * Which commits the per-story manifest check lets through, which it refuses,
 * and what it leaves on disk.
 *
 * No org is called. PATH starts with a fake `sf` that maps classes/*.cls to
 * ApexClass and flows/*.flow-meta.xml to Flow and writes the package.xml that
 * branch-manifest reads; FAKE_SF_SLEEP_MS makes it slow. Each repository is a
 * throwaway SFDX repository. CLAUDE_CONFIG_DIR is a throwaway folder, so the
 * rebuilt manifests the hook writes outside the repository land there. git
 * reads a throwaway global configuration and no system one, so no commit is
 * signed with the machine's key.
 *
 * How it stays fast:
 * - Claude Code checks call the hook's exported commitCheck() in this
 *   process; only the slow-rebuild check, whose deadline the hook reads when
 *   it loads, runs the hook as a `node` process.
 * - Repositories are copies of two template folders the main thread builds
 *   once: class A on integration, and the state "Current" leaves, written with
 *   plain git commands. A check at the end of "Current" makes sure that state
 *   is the one the hook built.
 * - The groups run at the same time in worker threads, each with its own
 *   configuration folder, because the terminal groups break and move the
 *   fixed copies of the checks.
 * - On macOS the fake sf is a compiled C program when the Command Line Tools
 *   compiler is there, built while the templates are; otherwise the node
 *   script.
 * - On macOS, git runs from /Library/Developer/CommandLineTools/usr/bin when
 *   it is there, which starts faster than the /usr/bin/git shim.
 *
 * Run: node hooks/__tests__/manifest-commit-check.test.mjs
 */

import cp, { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync,
         renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, Worker, workerData, parentPort } from 'node:worker_threads';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'manifest-commit-check.mjs');
const INSTALL = join(dirname(HOOKS), 'skills', 'setup', 'scripts', 'install-manifest-check.mjs');
const PRE_COMMIT = join(dirname(HOOKS), 'assets', 'githooks', 'pre-commit');
const CLT = '/Library/Developer/CommandLineTools/usr/bin';
const SDK = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';

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

// The same fake sf as a C program, which starts several times faster than node on macOS; built when the compiler is there.
const FAKE_SF_C = String.raw`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int byName(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

/* The component name in .../<folder>/<name><suffix>, or NULL. */
static char *component(const char *p, const char *folder, const char *const *suffixes) {
  const char *base = strrchr(p, '/');
  size_t flen = strlen(folder);
  if (!base || (size_t)(base - p) < flen + 1 || strncmp(base - flen, folder, flen) || base[-(long)flen - 1] != '/') return NULL;
  base++;
  size_t blen = strlen(base);
  for (int i = 0; suffixes[i]; i++) {
    size_t slen = strlen(suffixes[i]);
    if (blen > slen && !strcmp(base + blen - slen, suffixes[i])) return strndup(base, blen - slen);
  }
  return NULL;
}

static void block(FILE *f, const char *type, char **members, int n) {
  if (!n) return;
  qsort(members, n, sizeof *members, byName);
  fputs("    <types>\n", f);
  for (int i = 0; i < n; i++)
    if (!i || strcmp(members[i], members[i - 1])) fprintf(f, "        <members>%s</members>\n", members[i]);
  fprintf(f, "        <name>%s</name>\n    </types>\n", type);
}

int main(int argc, char **argv) {
  const char *sleep = getenv("FAKE_SF_SLEEP_MS");
  long ms = sleep ? atol(sleep) : 0;
  if (ms > 0) { struct timespec t = { ms / 1000, (ms % 1000) * 1000000L }; nanosleep(&t, NULL); }
  static const char *const cls[] = { ".cls-meta.xml", ".cls", NULL }, *const flw[] = { ".flow-meta.xml", NULL };
  char **apex = calloc(argc, sizeof *apex), **flows = calloc(argc, sizeof *flows);
  int na = 0, nf = 0;
  const char *outDir = NULL, *name = NULL;
  for (int i = 1; i + 1 < argc; i++) {
    if (!outDir && !strcmp(argv[i], "--output-dir")) outDir = argv[i + 1];
    if (!name && !strcmp(argv[i], "--name")) name = argv[i + 1];
  }
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--source-dir") || i + 1 >= argc) continue;
    const char *p = argv[++i];
    char *hit;
    if ((hit = component(p, "classes", cls))) { apex[na++] = hit; continue; }
    if ((hit = component(p, "flows", flw))) { flows[nf++] = hit; continue; }
    char cwd[4096];
    printf("{\"status\":1,\"message\":\"%s%s%s: Could not infer a metadata type\"}\n",
           p[0] == '/' ? "" : getcwd(cwd, sizeof cwd), p[0] == '/' ? "" : "/", p);
    return 1;
  }
  char path[8192];
  snprintf(path, sizeof path, "%s", outDir);
  for (char *s = path + 1; *s; s++) if (*s == '/') { *s = 0; mkdir(path, 0777); *s = '/'; }
  mkdir(path, 0777);
  snprintf(path, sizeof path, "%s/%s", outDir, name);
  FILE *f = fopen(path, "w");
  if (!f) { perror(path); return 1; }
  fputs("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n", f);
  block(f, "ApexClass", apex, na);
  block(f, "Flow", flows, nf);
  fputs("    <version>67.0</version>\n</Package>\n", f);
  fclose(f);
  puts("{\"status\":0}");
  return 0;
}
`;

// Read-only git questions the hook asks inside this process, answered again from memory while every file git
// reads to answer them is unchanged: HEAD, the refs, packed-refs, the reflogs, every .gitignore and
// info/exclude. The key holds the command, its folder, its input, the GIT_DIR variables and, for the one
// question that names the index (rev-parse --git-path index), GIT_INDEX_FILE; any change to one of
// those files, a commit or a reset among them, makes git run again. Hooks in their own process (the terminal
// commits, the slow-rebuild check) always run git.
const MEMOIZED = [['rev-parse', '--show-toplevel'], ['rev-parse', '--symbolic-full-name'], ['check-ignore', '-q'],
                  ['reflog', 'show'], ['cat-file', '--batch-check=%(objecttype)'], ['merge-base', 'HEAD']];
const memo = new Map();
/** Every file under dir, with its content, in a fixed order; skips the folders git keeps objects and hooks in. */
const contents = (dir, skip = new Set()) => {
  const out = [];
  const walk = d => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (skip.has(name)) continue;
      const st = lstatSync(p, { throwIfNoEntry: false });
      // a ref git wrote as a symbolic link (core.preferSymlinkRefs) counts by its target
      if (st?.isSymbolicLink()) out.push(p, `-> ${readlinkSync(p)}`);
      else if (st?.isDirectory()) walk(p);
      else if (st) out.push(p, readFileSync(p, 'utf8'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};
/** What git reads to answer the questions above, for the repository holding dir; null outside a test repository. */
const gitState = dir => {
  let top = dir;
  while (top !== dirname(top) && !existsSync(join(top, '.git'))) top = dirname(top);
  const g = join(top, '.git');
  if (!existsSync(g) || !statSync(g).isDirectory()) return null;
  const ignores = contents(top, new Set(['.git'])).filter((p, i, a) => i % 2 === 0 && p.endsWith('.gitignore')).map(p => [p, readFileSync(p, 'utf8')]);
  const file = p => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);
  return JSON.stringify([top, file(join(g, 'HEAD')), file(join(g, 'packed-refs')), file(join(g, 'info', 'exclude')),
                         contents(join(g, 'refs')), contents(join(g, 'logs')), ignores]);
};
const memoKey = (args, dir, input, env = process.env) => {
  if (!MEMOIZED.some(([a, b]) => args[0] === a && args[1] === b)) return null;
  const state = gitState(dir);
  const index = args.includes('index') ? env.GIT_INDEX_FILE ?? null : null;
  return state && JSON.stringify([args, dir, input ?? null, index, env.GIT_DIR ?? null, env.GIT_WORK_TREE ?? null,
                                  env.GIT_COMMON_DIR ?? null, state]);
};
const realExec = cp.execFileSync, realSpawn = cp.spawnSync;
cp.execFileSync = function (file, args = [], opts = {}) {
  const key = file === 'git' && args[0] === '-C' && memoKey(args.slice(2), args[1], opts.input, opts.env);
  if (!key) return realExec.call(this, file, args, opts);
  if (!memo.has(key)) { try { memo.set(key, { out: realExec.call(this, file, args, opts) }); } catch (e) { memo.set(key, { err: e }); } }
  const m = memo.get(key);
  if (m.err) throw m.err;
  return m.out;
};
cp.spawnSync = function (file, args = [], opts = {}) {
  const key = file === 'git' && opts.cwd && memoKey(args, opts.cwd, opts.input, opts.env);
  if (!key) return realSpawn.call(this, file, args, opts);
  if (!memo.has(key)) { const r = realSpawn.call(this, file, args, opts); if (r.error) return r; memo.set(key, r); }
  return memo.get(key);
};
syncBuiltinESMExports();

/** The throwaway folder, the fake sf, and the environment every group starts from; built once by the main thread. */
function makeSandbox() {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'manifest-check-')));
  const bin = join(sandbox, 'bin');
  const noSf = join(sandbox, 'no-sf');
  mkdirSync(bin);
  mkdirSync(noSf);
  // compiled while the main thread builds the templates; the node script when it cannot be. The file is in
  // place before any group starts and never replaced, because a shebang script is opened twice when it starts
  const useScript = () => { writeFileSync(join(bin, 'sf'), FAKE_SF); chmodSync(join(bin, 'sf'), 0o755); };
  let sfReady = Promise.resolve().then(useScript);
  if (existsSync(join(CLT, 'cc')) && existsSync(SDK)) {
    writeFileSync(join(sandbox, 'sf.c'), FAKE_SF_C);
    sfReady = new Promise(done => spawn(join(CLT, 'cc'), ['-O1', '-w', '-isysroot', SDK, '-o', join(bin, 'sf'), join(sandbox, 'sf.c')],
      { stdio: 'ignore' }).on('exit', code => done(code === 0)).on('error', () => done(false))).then(ok => ok || useScript());
  }
  // a PATH with git and node but no sf; the Command Line Tools folder supplies git when it holds it
  const clt = existsSync(join(CLT, 'git')) ? `${CLT}:` : '';
  if (!clt) symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(noSf, 'git'));
  symlinkSync(process.execPath, join(noSf, 'node'));
  // no machine settings, so no commit is signed; and no maintenance process after every commit
  const globalConfig = join(sandbox, 'gitconfig');
  writeFileSync(globalConfig, '[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[maintenance]\n\tauto = false\n');
  const env = { ...process.env, PATH: `${bin}:${clt}${process.env.PATH}`, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
  delete env.CLAUDE_CONFIG_DIR;
  return { sandbox, noSfPath: `${noSf}:${clt}/usr/bin:/bin`, env, sfReady };
}

const { sandbox, noSfPath: NO_SF_PATH, env: BASE_ENV, group: GROUP, sfReady } = isMainThread ? { ...makeSandbox(), group: 'story' } : workerData;
// the throwaway folder goes when the test ends, a failed check or a crash included
if (isMainThread) {
  process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
  // a signal ends the test through process.exit, so the handler above still runs
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, () => process.exit(code));
}
// each group has its own configuration folder; the hook reads CLAUDE_CONFIG_DIR from this thread's environment
const CONFIG = join(sandbox, `config-${GROUP}`);
mkdirSync(CONFIG, { recursive: true });
const env = { ...BASE_ENV, CLAUDE_CONFIG_DIR: CONFIG };
Object.assign(process.env, env);
const { commitCheck } = await import(HOOK);
const { notChecked } = await import(join(dirname(HOOKS), 'scripts', 'lib', 'manifest-check.mjs'));

const CLASSES = 'force-app/main/default/classes';
const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** A class; with a work ID, one whose class comment passes the Apex class header check on that story's branch. */
const addClass = (repo, name, workId) => {
  const header = workId ? `/**\n * ${name}.\n *\n * @since 2026-01-01 ${workId}\n */\n` : '';
  write(repo, `${CLASSES}/${name}.cls`, `${header}public class ${name} {}\n`);
  write(repo, `${CLASSES}/${name}.cls-meta.xml`, '<ApexClass/>\n');
};
/** Run a command a refusal printed, as Claude would type it in the given folder. */
const run = (cwd, command) => execFileSync('sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

// The repositories every group starts from, built once by the main thread and copied as plain folders.
const BASE_TEMPLATE = join(sandbox, 'template-base');
const STORY_TEMPLATE = join(sandbox, 'template-story');

/** A throwaway SFDX repository on integration: class A, notes.txt and the SFDX files, committed. */
function makeBaseTemplate() {
  const repo = BASE_TEMPLATE;
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  // every repository is a copy of this one: no signing, even where git reads the machine's own configuration
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'tag.gpgsign', 'false');
  write(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
  write(repo, '.gitignore', '.claude/*\n!.claude/manifest/\n.githooks/\n');
  write(repo, 'notes.txt', 'one\n');
  addClass(repo, 'A');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
}

/**
 * A throwaway SFDX repository: class A committed on integration, then a story branch checked out.
 * setup: false leaves out .claude/hean-harness.json, the file setup writes, as in a repository setup never ran in.
 */
function makeRepo(name, branch, { setup = true } = {}) {
  const repo = join(sandbox, name);
  cpSync(BASE_TEMPLATE, repo, { recursive: true });
  git(repo, 'checkout', '-q', '-b', branch);
  if (setup) write(repo, '.claude/hean-harness.json', '{"commitFormat":"off"}\n');
  return repo;
}

/** The hook's answer to a Bash call, as Claude Code reads it: { deny, warn }, each null when absent. */
function hook(repo, command, { cwd = repo, extraEnv = {} } = {}) {
  if ('HEAN_MANIFEST_CHECK_DEADLINE_MS' in extraEnv) return hookProcess(command, cwd, extraEnv);
  const saved = { ...process.env };
  Object.assign(process.env, extraEnv);
  let r;
  // the same answer the hook's main block prints
  try { r = commitCheck(command, cwd); } catch (e) { r = { warnings: [notChecked(e.message)] }; }
  finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  if (r.refusal) return { deny: r.refusal.text, warn: null };
  return { deny: null, warn: r.warnings.length ? r.warnings.join('\n') : null };
}

/** Run the hook as Claude Code does before a Bash call, as its own node process. */
function hookProcess(command, cwd, extraEnv) {
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
const lines = [];
const log = text => lines.push(text);
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;

const OUT_OF_DATE = 'is out of date for this commit';
const NOT_CHECKED = '!! The per-story manifest was not checked';
const M = '.claude/manifest/ABC-1.xml';
/** The story repository's paths and helpers, for the copy at repo. */
function story(repo) {
  const SCRATCH = join(CONFIG, 'hean-harness', 'manifest-check',
                       createHash('sha1').update(repo).digest('hex').slice(0, 12), 'ABC-1.xml');
  return {
    ADD: `git -C '${repo}' add ${M}`,
    RM: `git -C '${repo}' rm -f ${M}`,
    manifest: () => existsSync(join(repo, M)) ? readFileSync(join(repo, M), 'utf8') : null,
    SCRATCH,
    scratch: () => existsSync(SCRATCH) ? readFileSync(SCRATCH, 'utf8') : null,
    unstageManifest: () => { git(repo, 'reset', '-q', '--', M); git(repo, 'checkout', '--', M); }
  };
}

/** The manifest Current leaves committed: the fake sf's package.xml for class B. */
const STORY_MANIFEST = '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  '    <types>\n        <members>B</members>\n        <name>ApexClass</name>\n    </types>\n    <version>67.0</version>\n</Package>\n';

/** A story repository in the state Current leaves: B and its manifest committed, B changed, notes changed. */
function makeStoryTemplate() {
  const repo = makeRepo('template-story', 'work-ABC-1_story');
  addClass(repo, 'B');
  write(repo, M, STORY_MANIFEST);
  git(repo, 'add', CLASSES, M);
  git(repo, 'commit', '-q', '-m', 'B');
  write(repo, `${CLASSES}/B.cls`, 'public class B { Integer i; }\n');
  git(repo, 'commit', '-q', '-am', 'B again');
  write(repo, 'notes.txt', 'two\n');
  git(repo, 'commit', '-q', '-am', 'notes');
}

const storyRepo = name => {
  cpSync(STORY_TEMPLATE, join(sandbox, name), { recursive: true });
  return join(sandbox, name);
};

/** Out of date, Staged in the same call and Current, on the story repository. */
function storyStart(repo) {
  const { ADD, manifest, SCRATCH, scratch } = story(repo);
  let r;
  log('Out of date');
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

  log('Staged in the same call');
  git(repo, 'reset', '-q', '--', M);
  r = hook(repo, `git add ${M} && git commit -m "@ABC-1: Add B"`);
  check('adding the rebuilt manifest in the same call is allowed', silent(r), JSON.stringify(r));
  git(repo, 'add', M);
  git(repo, 'commit', '-q', '-m', 'B');

  log('Current');
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
  check('the later story sections start from the manifest the hook rebuilt', committed === STORY_MANIFEST, committed);
}

/** git commit -a, then Commit by path. */
function commitAAndByPath(repo, committed) {
  const { ADD, manifest, scratch, unstageManifest } = story(repo);
  let r;
  log('git commit -a');
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

  log('Commit by path');
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
}

/** Nothing left to list, then Skipped. */
function emptyAndSkipped(repo, committed) {
  const { RM, manifest } = story(repo);
  let r;
  log('Nothing left to list');
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

  log('Skipped');
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
}

/** The check cannot run, then Where the commit runs. */
function cannotRunAndWhere(repo, committed) {
  const { ADD, manifest, SCRATCH, scratch, unstageManifest } = story(repo);
  let r;
  log('The check cannot run');
  addClass(repo, 'F');
  git(repo, 'add', CLASSES);
  r = hook(repo, 'git commit -m "x"', { extraEnv: { PATH: NO_SF_PATH } });
  check('sf missing lets the commit through', r.deny === null, JSON.stringify(r));
  // sf cannot be started: the check gives the reason it always gave
  has('sf missing says the manifest was not checked', r.warn, `${NOT_CHECKED}: cannot run sf: spawnSync sf ENOENT.`);
  r = hook(repo, 'git commit -m "x"', { extraEnv: { HEAN_MANIFEST_CHECK_DEADLINE_MS: '1000', FAKE_SF_SLEEP_MS: '3000' } });
  check('a slow rebuild lets the commit through', r.deny === null, JSON.stringify(r));
  has('a slow rebuild names the deadline', r.warn, NOT_CHECKED, 'took longer than 1 second');
  r = hook(repo, 'git add "$FILES" && git commit -m "x"');
  check('staging the text cannot name lets the commit through', r.deny === null, JSON.stringify(r));
  has('staging the text cannot name is not guessed', r.warn, NOT_CHECKED);
  r = hook(repo, `git add -p ${CLASSES} && git commit -m "x"`);
  has('picked hunks are not guessed', r.warn, NOT_CHECKED);
  check('no manifest is written when the check cannot run', manifest() === committed);

  log('Where the commit runs');
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
}

// a terminal commit: this test may itself run under Claude Code, which sets CLAUDE_CODE_CHILD_SESSION
const termEnv = { ...env };
delete termEnv.CLAUDE_CODE_CHILD_SESSION;
/** A repository whose commits run the shipped git pre-commit hook, with the checks copied to this group's fixed folder. */
function hookedRepo(name, branch) {
  const repo = makeRepo(name, branch);
  write(repo, '.githooks/pre-commit', readFileSync(PRE_COMMIT, 'utf8'));
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o755);
  git(repo, 'config', 'core.hooksPath', '.githooks');
  return repo;
}
const copyDir = join(CONFIG, 'hean-harness', 'hooks');
// setup's copy of the checks, made once by the main thread; each terminal group copies it into its own folder
const INSTALLED = join(sandbox, 'config-installed', 'hean-harness', 'hooks');
const installChecks = () => cpSync(INSTALLED, copyDir, { recursive: true });
/** The commit HEAD names, read from the repository's files; from git when the branch file is not there. */
const headOf = repo => {
  const ref = /^ref: (.+)$/.exec(readFileSync(join(repo, '.git', 'HEAD'), 'utf8').trim())?.[1];
  const file = ref && join(repo, '.git', ref);
  return file && existsSync(file) ? readFileSync(file, 'utf8').trim() : git(repo, 'rev-parse', 'HEAD');
};

const TM = '.claude/manifest/GH-2.xml';
/** A story repository whose commits run the git pre-commit hook, with this group's fixed copies installed. */
function terminalRepo(name) {
  installChecks();
  const term = hookedRepo(name, 'work-GH-2_story');
  return {
    term,
    TERM_SCRATCH: join(CONFIG, 'hean-harness', 'manifest-check', createHash('sha1').update(term).digest('hex').slice(0, 12), 'GH-2.xml'),
    commit: (args, extraEnv = {}) =>
      spawnSync('git', ['-C', term, 'commit', '-q', ...args], { env: { ...termEnv, ...extraEnv }, encoding: 'utf8' }),
    head: () => headOf(term)
  };
}

/** Terminal commits through the git pre-commit hook: what it refuses and the commands it prints. */
function terminal() {
  log('Terminal commits through the git pre-commit hook');
  const { term, TERM_SCRATCH, commit, head } = terminalRepo('terminal');
  check('the fixed folder holds the file that runs the four checks in one node process',
        existsSync(join(copyDir, 'scripts', 'lib', 'pre-commit-checks.mjs')));
  const TERM_ADD = `git -C '${term}' add ${TM}`;

  addClass(term, 'B', 'GH-2');
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
  write(term, `${CLASSES}/A.cls`, '/**\n * A.\n *\n * @changes 2026-01-01 GH-2: Added a field\n */\npublic class A { Integer k; }\n');
  c = commit(['-am', 'A']);
  check('commit -a is checked against the index git builds', c.status !== 0 && c.stderr.includes('ApexClass: A'), c.stderr);
  run(sandbox, commandsOf(c.stderr)[0]);
  check('commit -a goes through after the printed command', commit(['-am', 'A']).status === 0);
  addClass(term, 'C', 'GH-2');
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
}

/** Terminal commits through the git pre-commit hook: when it lets a commit through, and where it finds the checks. */
function terminalThrough() {
  log('Terminal commits the git pre-commit hook lets through');
  const { term, TERM_SCRATCH, commit, head } = terminalRepo('terminal-through');
  let c;
  addClass(term, 'D', 'GH-2');
  git(term, 'add', CLASSES);
  c = commit(['-m', 'D'], { PATH: NO_SF_PATH });
  check('a terminal commit goes through when sf is missing', c.status === 0 && c.stderr.includes(NOT_CHECKED), c.stderr);
  addClass(term, 'E', 'GH-2');
  git(term, 'add', CLASSES);
  renameSync(copyDir, `${copyDir}.away`);
  c = commit(['-m', 'E']);
  check('the git hook does nothing once the check is gone', c.status === 0 && c.stderr === '', c.stderr);
  renameSync(`${copyDir}.away`, copyDir);
  addClass(term, 'G', 'GH-2');
  git(term, 'add', CLASSES);
  c = commit(['-m', 'G'], { HOME: sandbox, CLAUDE_CONFIG_DIR: `~/config-${GROUP}` });
  check('the git hook finds the check under a CLAUDE_CONFIG_DIR given as ~/…',
        c.status !== 0 && c.stderr.includes(OUT_OF_DATE) && c.stderr.includes(`cp '${TERM_SCRATCH}'`), c.stderr);
  const beforeG = head();
  c = commit(['-m', 'G'], { CLAUDE_CODE_CHILD_SESSION: '1' });
  check('the git hook skips a commit Claude Code runs, which its own hook has checked',
        c.status === 0 && c.stderr === '' && head() !== beforeG, c.stderr);
  // every check refuses this commit while it loads: a stale manifest, an invalid Collection Filter condition,
  // a toggle read with the package cached as installed, and a class comment without @since
  write(term, '.claude/hean-harness.json', JSON.stringify({ orgs: { [TOGGLE_ORG]: { alias: 'dev', username: 'dev@example.com.dev', role: 'development', deploy: true, branch: null } } }));
  cacheToggle(true);
  addClass(term, 'H');
  write(term, `${FLOWS}/Sample.flow-meta.xml`, filterFlow('UseActiveOnly'));
  write(term, `${FLOWS}/Toggle.flow-meta.xml`, toggleFlow('RecordAfterSave'));
  git(term, 'add', 'force-app');
  const libDir = join(copyDir, 'scripts', 'lib');
  const checks = ['manifest-check.mjs', 'flow-collection-filter.mjs', 'flow-feature-toggle.mjs', 'apex-class-header.mjs'];
  const good = checks.map(f => readFileSync(join(libDir, f), 'utf8'));
  const beforeH = head();
  checks.forEach((f, i) => writeFileSync(join(libDir, f), `import './a-library-the-copy-lacks.mjs';\n${good[i]}`));
  c = commit(['-m', 'H']);
  check('fixed-path copies of the four checks that fail to load let the commit through', c.status === 0 && head() !== beforeH, c.stderr);
  // each check that cannot be loaded runs as its own node process, whose crash names what it lacks
  has('a check copy that fails to load runs on its own and says what it lacks', c.stderr, 'a-library-the-copy-lacks.mjs');
  checks.forEach((f, i) => writeFileSync(join(libDir, f), good[i]));
  // a runner that ends any other way than its two results runs the four checks one by one, as before it existed
  addClass(term, 'I', 'GH-2');
  git(term, 'add', CLASSES);
  const runnerFile = join(libDir, 'pre-commit-checks.mjs');
  const goodRunner = readFileSync(runnerFile, 'utf8');
  writeFileSync(runnerFile, 'this is not javascript (\n');
  c = commit(['-m', 'I']);
  check('a damaged runner still runs the four checks, and the manifest check still refuses',
        c.status !== 0 && c.stderr.includes(OUT_OF_DATE) && !c.stderr.includes('SyntaxError'), c.stderr);
  writeFileSync(runnerFile, goodRunner);
  const header = join(libDir, 'apex-class-header.mjs');
  writeFileSync(header, `process.kill(process.pid, 'SIGKILL');\n${good[3]}`);
  c = commit(['-m', 'I']);
  check('a runner killed after a refusal still refuses the commit, printing the refusal once',
        c.status !== 0 && c.stderr.split(OUT_OF_DATE).length === 2, c.stderr);
  // a check that cannot load in the runner runs as its own process; killed there, the hook runs the checks
  // one by one and the shell reports the kill of that check, as it did before the runner existed
  writeFileSync(header, `if (!process.argv.includes('--git-hook')) throw new Error('loads only on its own');\nprocess.kill(process.pid, 'SIGKILL');\n${good[3]}`);
  c = commit(['-m', 'I']);
  check('a check killed in its own process makes the hook run the checks one by one',
        c.status !== 0 && c.stderr.split(OUT_OF_DATE).length === 2 && /Killed: 9 +node "\$header" --git-hook/.test(c.stderr) &&
          !c.stderr.includes('runner'), c.stderr);
  writeFileSync(header, good[3]);
}

const FLOWS = 'force-app/main/default/flows';
const filterFlow = left => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <collectionProcessors>
        <name>Sample_Filter</name>
        <elementSubtype>FilterCollectionProcessor</elementSubtype>
        <assignNextValueToReference>currentItem_Sample_Filter</assignNextValueToReference>
        <collectionProcessorType>FilterCollectionProcessor</collectionProcessorType>
        <collectionReference>Sample_Records</collectionReference>
        <conditionLogic>and</conditionLogic>
        <conditions>
            <leftValueReference>${left}</leftValueReference>
            <operator>EqualTo</operator>
            <rightValue><stringValue>Active</stringValue></rightValue>
        </conditions>
    </collectionProcessors>
</Flow>
`;
const toggleFlow = trigger => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <recordLookups>
        <name>Get_Toggle</name>
        <object>Feature_Toggle__mdt</object>
    </recordLookups>
    <start>
        <triggerType>${trigger}</triggerType>
    </start>
</Flow>
`;
const TOGGLE_ORG = '00DXX0000000001';
const toggleCache = join(CONFIG, 'hean-harness', 'feature-toggle-package', `${TOGGLE_ORG}.json`);
const cacheToggle = installed => {
  mkdirSync(dirname(toggleCache), { recursive: true });
  writeFileSync(toggleCache, JSON.stringify({ installed, checkedAt: Date.now() }));
};

/** Collection Filter, feature toggle and Apex class header checks through the git pre-commit hook. */
function flowChecks() {
  installChecks();
  log('A story branch cut from another story branch');
  // the base is read from the branch's reflog, so the commit lists only what the story added since feature-base
  const derived = makeRepo('derived', 'feature-base');
  addClass(derived, 'X');
  git(derived, 'add', CLASSES);
  git(derived, 'commit', '-q', '-m', 'X');
  git(derived, 'checkout', '-q', '-b', 'work-ABC-7_story', 'feature-base');
  addClass(derived, 'Y');
  git(derived, 'add', CLASSES);
  const fromBase = hook(derived, 'git commit -m "@ABC-7: Add Y"');
  check('a story branch cut from feature-base lists only its own changes',
        fromBase.deny?.includes('ApexClass: Y') && !fromBase.deny.includes('ApexClass: X'), JSON.stringify(fromBase));
  // origin's default branch, trunk, is not a base name the check tries on its own; with core.preferSymlinkRefs
  // git writes origin/HEAD as a symbolic link whose target does not resolve as a path
  const linked = makeRepo('symlink-refs', 'trunk-work');
  addClass(linked, 'T');
  git(linked, 'add', CLASSES);
  git(linked, 'commit', '-q', '-m', 'T');
  git(linked, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  git(linked, 'config', 'core.preferSymlinkRefs', 'true');
  git(linked, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  // cut from a detached HEAD, so the branch's reflog names no base and only origin's default finds trunk
  git(linked, 'checkout', '-q', '--detach');
  git(linked, 'checkout', '-q', '-b', 'work-ABC-8_story');
  addClass(linked, 'U');
  git(linked, 'add', CLASSES);
  const fromTrunk = hook(linked, 'git commit -m "@ABC-8: Add U"');
  check('origin\'s default branch written as a symbolic link is the base',
        lstatSync(join(linked, '.git', 'refs', 'remotes', 'origin', 'HEAD')).isSymbolicLink() &&
          fromTrunk.deny?.includes('ApexClass: U') && !fromTrunk.deny.includes('ApexClass: T'), JSON.stringify(fromTrunk));

  log('Collection Filter check through the git pre-commit hook');
  // a branch with no work id in its name, so the manifest check has nothing to list and only the flow check speaks
  const fr = hookedRepo('flows', 'scratch');
  const fcommit = (msg, extraEnv = {}) =>
    spawnSync('git', ['-C', fr, 'commit', '-q', '-m', msg], { env: { ...termEnv, ...extraEnv }, encoding: 'utf8' });
  const fhead = () => headOf(fr);
  write(fr, `${FLOWS}/Sample.flow-meta.xml`, filterFlow('UseActiveOnly'));
  git(fr, 'add', FLOWS);
  const beforeF = fhead();
  let c = fcommit('bad flow');
  check('a terminal commit of a flow with an invalid Collection Filter condition is refused',
        c.status !== 0 && fhead() === beforeF && c.stderr.includes('Flow Builder cannot display') &&
          c.stderr.includes(`${FLOWS}/Sample.flow-meta.xml: Sample_Filter: left side \`UseActiveOnly\`, expected \`currentItem_Sample_Filter\` or \`currentItem_Sample_Filter.<Field>\``), c.stderr);
  write(fr, `${CLASSES}/Z.cls`, 'public class Z {}\n');
  write(fr, `${CLASSES}/Z.cls-meta.xml`, '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion><status>Active</status></ApexClass>\n');
  git(fr, 'add', '-A');
  c = fcommit('class and bad flow');
  check('a refused flow does not depend on the manifest check passing', c.status !== 0 && c.stderr.includes('Flow Builder cannot display'), c.stderr);

  log('Feature toggle check through the git pre-commit hook');
  write(fr, '.claude/hean-harness.json', JSON.stringify({ orgs: { [TOGGLE_ORG]: { alias: 'dev', username: 'dev@example.com.dev', role: 'development', deploy: true, branch: null } } }));
  git(fr, 'reset', '-q', '--hard', 'HEAD');
  git(fr, 'clean', '-qfd', '--', 'force-app');
  write(fr, `${FLOWS}/Toggle.flow-meta.xml`, toggleFlow('RecordAfterSave'));
  git(fr, 'add', `${FLOWS}/Toggle.flow-meta.xml`);
  const beforeT = fhead();
  cacheToggle(true);
  c = fcommit('toggle read, package installed');
  check('a toggle read outside a before-save flow is refused when the package is installed',
        c.status !== 0 && fhead() === beforeT && c.stderr.includes('break the flow rule "Feature toggles in flows"') &&
          c.stderr.includes(`${FLOWS}/Toggle.flow-meta.xml: Get_Toggle: Get Records on Feature_Toggle__mdt outside a before-save flow`), c.stderr);

  log('Apex class header check through the git pre-commit hook');
  const CLS = 'force-app/main/default/classes/Fresh.cls';
  const clsText = tags => `/**\n * Does the work.\n *${tags.map(t => `\n * ${t}`).join('')}\n */\npublic with sharing class Fresh {\n}\n`;
  git(fr, 'reset', '-q', '--hard', 'HEAD');
  git(fr, 'clean', '-qfd', '--', 'force-app');
  // a back-merge branch name holds a work ID the header check reads, and the manifest check skips it
  git(fr, 'checkout', '-q', '-b', 'work-ABC-123-BM');
  write(fr, CLS, clsText(['Initial setup']));
  git(fr, 'add', CLS);
  const beforeA = fhead();
  c = fcommit('new class, bad header');
  check('a new class with no @since and "Initial setup" is refused',
        c.status !== 0 && fhead() === beforeA && c.stderr.includes('does not follow "Class header"') &&
          c.stderr.includes(`${CLS}: no "@since <date> ABC-123"`), c.stderr);
}

const GROUPS = { commitAAndByPath, emptyAndSkipped, cannotRunAndWhere };
const OWN_REPO_GROUPS = { terminal, terminalThrough, flowChecks };

if (!isMainThread) {
  try {
    if (GROUP in OWN_REPO_GROUPS) OWN_REPO_GROUPS[GROUP]();
    else GROUPS[GROUP](storyRepo(`story-${GROUP}`), STORY_MANIFEST);
  } catch (e) {
    fail++;
    log(`  FAIL  ${GROUP} stopped: ${e.stack}`);
  }
  parentPort.postMessage({ pass, fail, lines });
} else {
  const start = group => new Promise(done => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { sandbox, noSfPath: NO_SF_PATH, env: BASE_ENV, group } });
    let result = { pass: 0, fail: 1, lines: [`  FAIL  ${group} sent no result`] };
    w.on('message', m => { result = m; });
    w.on('error', e => { result = { pass: 0, fail: 1, lines: [`  FAIL  ${group} crashed: ${e.stack}`] }; });
    w.on('exit', () => done(result));
  });
  makeBaseTemplate();
  makeStoryTemplate();
  execFileSync(process.execPath, [INSTALL], { env: { ...env, CLAUDE_CONFIG_DIR: join(sandbox, 'config-installed') }, stdio: 'ignore' });
  await sfReady;
  // every group starts from its own copy of a template, so all of them start at once
  const groups = [...Object.keys(GROUPS), ...Object.keys(OWN_REPO_GROUPS)].map(g => start(g));
  try { storyStart(makeRepo('story', 'work-ABC-1_story')); } catch (e) { fail++; log(`  FAIL  story stopped: ${e.stack}`); }
  for (const r of await Promise.all(groups)) {
    pass += r.pass;
    fail += r.fail;
    lines.push(...r.lines);
  }
  console.log(lines.join('\n'));
  console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exitCode = fail ? 1 : 0;
}
