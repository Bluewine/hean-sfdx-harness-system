#!/usr/bin/env node
/**
 * What hotfix-check decides for each release/master/integration shape, requested type and hotfix branch state.
 *
 * No client repository is touched, and nothing is signed with the user's key:
 *  - HOME is a throwaway folder, the system git config is off, and every case repository has commit.gpgsign and
 *    tag.gpgsign switched off;
 *  - every fixture is modelled in JavaScript and written by one `git fast-import` into a shared object store; each
 *    case repository is a copy of one `git init` template with alternates and a packed-refs file written directly
 *    (the --fetch case also gets a copy that serves as its origin);
 *  - the script runs in this process (fresh module import per run), and its read-only git calls are remembered per
 *    repository; a `git fetch` clears that repository's memory.
 *
 * Run: node scripts/__tests__/hotfix-check.test.mjs
 */

import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = realpathSync(join(dirname(SCRIPTS), 'skills', 'hotfix', 'scripts', 'hotfix-check.mjs'));
const lib = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-hotfix-check-')));
// Removed on every exit, including a crash.
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const HOME = join(root, 'home'); mkdirSync(HOME);
process.env.HOME = HOME;
writeFileSync(join(HOME, '.gitconfig'), '[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');
process.env.XDG_CONFIG_HOME = join(HOME, 'xdg');
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|CONFIG_)/.test(k)) delete process.env[k];
const CLT = '/Library/Developer/CommandLineTools/usr/bin';
if (process.platform === 'darwin' && existsSync(join(CLT, 'git'))) process.env.PATH = `${CLT}:${process.env.PATH}`;

const realSpawnSync = cp.spawnSync;
const gitRaw = (cwd, args, input) => {
  const r = realSpawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// ---- fixture model -------------------------------------------------------------------------------------------
let stream = '';
let mark = 0;
let when = 1700000000;
const blobs = new Map();
const blob = text => {
  if (!blobs.has(text)) { mark++; stream += `blob\nmark :${mark}\ndata ${Buffer.byteLength(text)}\n${text}\n`; blobs.set(text, mark); }
  return blobs.get(text);
};
const pkg = v => JSON.stringify({ name: 'x', version: v });
/** One commit; file: undefined = tree unchanged, null = delete package.json, string = package.json content. */
const commitObj = (parents, msg, file) => {
  const fm = typeof file === 'string' ? blob(file) : null;
  mark++;
  const m = mark;
  stream += `commit refs/fixture/tmp\nmark :${m}\ncommitter T <t@example.com> ${when++} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\n`;
  stream += parents.length ? `from :${parents[0]}\n` : 'from 0000000000000000000000000000000000000000\n';
  for (const p of parents.slice(1)) stream += `merge :${p}\n`;
  if (fm) stream += `M 100644 :${fm} package.json\n`;
  else if (file === null) stream += 'D package.json\n';
  stream += '\n';
  return m;
};

const fixtures = [];
let n = 0;
/**
 * versions: { master, release, integration } package.json versions (a missing key omits the branch's package.json).
 * hotfix: optional { branch, bump, id, version?, pushed?, localBump?, merged?, empty?, swap?, backMerged?,
 *   intoIntegration? } created from release; see the cases for each shape.
 * story: optional work ID whose ordinary commit sits on master, release and integration.
 * after: optional list of { branch, subject, push } extra empty commits, or { pruneOnOrigin: branch } to delete the
 *   branch on origin and locally while keeping its stale remote-tracking ref.
 * Fixtures with identical parameters and no `after` share one repository.
 */
const same = new Map();
function fixture(versions, hotfix = null, story = null, after = null) {
  const key = after ? null : JSON.stringify([versions, hotfix, story]);
  if (key && same.has(key)) return same.get(key);
  const local = {}, origin = {};
  let tracking;
  const write = (branch, v, subject) => { local[branch] = commitObj(local[branch] ? [local[branch]] : [], subject, v === undefined ? undefined : pkg(v)); };
  write('master', versions.master, 'master');
  if (story) write('master', undefined, `@${story}: Add the dedupe check`);
  origin.master = local.master;
  for (const b of ['release', 'integration']) {
    local[b] = local.master;
    if ('master' in versions && b in versions) write(b, versions[b], b);
    else if (!(b in versions)) local[b] = commitObj([local[b]], `${b} without package.json`, null);
    origin[b] = local[b];
  }
  if (hotfix) {
    const v = hotfix.version ?? lib.bumpVersion(versions.release);
    const hb = hotfix.branch;
    const bumpCommit = () => write(hb, v, `@${hotfix.id}: Update Release Version to v${v}`);
    local[hb] = local.release;
    if (hotfix.bump) bumpCommit();
    else if (!hotfix.empty) {
      if (hotfix.swap !== false) write(hb, undefined, `@${hotfix.id}: Point QA swimlane at hotfix branch`);
      write(hb, undefined, `@${hotfix.id}: Fix something`);
    }
    if (hotfix.pushed !== false) origin[hb] = local[hb];
    if (hotfix.localBump) bumpCommit();
    if (hotfix.merged) {
      local.release = local[hb];
      origin.release = local.release;
      delete origin[hb];
      delete local[hb];
    }
    if (hotfix.backMerged) { write('integration', undefined, `@${hotfix.id}: Back-merge and config reset`); origin.integration = local.integration; }
    else if (hotfix.intoIntegration) {
      local.integration = commitObj([local.integration, local[hb]], 'merge hotfix', undefined);
      origin.integration = local.integration;
    }
  }
  tracking = { ...origin };
  // after: [{ branch, subject, push }] extra empty commits; { pruneOnOrigin: branch } deletes the branch on origin
  // and locally but keeps the stale remote-tracking ref, as the original's pruned case does.
  let needsOrigin = false;
  for (const op of after ?? []) {
    if (op.subject) { write(op.branch, undefined, op.subject); if (op.push) { origin[op.branch] = local[op.branch]; tracking[op.branch] = local[op.branch]; } }
    if (op.pruneOnOrigin) { delete origin[op.pruneOnOrigin]; delete local[op.pruneOnOrigin]; needsOrigin = true; }
  }
  const dir = join(root, `case-${++n}`);
  fixtures.push({ dir, local, tracking, origin, needsOrigin });
  if (key) same.set(key, join(dir, 'clone'));
  return join(dir, 'clone');
}

// ---- cases: declared first (fixtures only), run after the one fast-import ------------------------------------
const cases = [];
const run = (cwd, ...args) => { const c = { cwd, args }; cases.push(c); return c; };

const EQ = { master: '0.1.17', release: '0.1.17', integration: '0.1.18' };
const AHEAD = { master: '0.1.17', release: '0.1.18', integration: '0.1.19' };
const id = 'ABC-123';
const hf = (extra = {}) => ({ branch: `work-${id}-HF`, bump: true, id, ...extra });
const C = {};
{
  const c = fixture(AHEAD);
  C.aheadNone = run(c); C.aheadUat = run(c, 'uat'); C.aheadProd = run(c, 'prod');
}
{
  const c = fixture(EQ);
  C.eqNone = run(c); C.eqProd = run(c, 'prod'); C.eqUat = run(c, 'uat');
  C.eqLow = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }));
}
{
  C.behind = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }));
  C.missing = run(fixture({ master: '0.1.17', integration: '0.1.18' }));
  const c = fixture(EQ);
  C.invalid = [['bogus'], ['uat', 'prod'], ['abc-1'], ['ABC-1', 'DEF-2']].map(a => [a, run(c, ...a)]);
  C.gus = run(c, 'W-22028215');
  C.suffix = run(c, 'uat', 'ABC-123-UK');
}
{
  C.bumpAhead = run(fixture(AHEAD, hf()), id);
  C.bumpEq = run(fixture(EQ, hf()), id);
  C.bumpLow = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }, hf()), id);
  C.old = run(fixture(EQ, { ...hf(), branch: `hotfix-${id}` }), id);
  C.behindBump = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }, hf()), id);
  C.behindNo = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }, hf({ bump: false })), id);
  C.prodOnUat = run(fixture(AHEAD, hf()), 'uat', id);
  C.ahead = run(fixture(AHEAD, hf({ bump: false })), id);
  C.prodNo = run(fixture(AHEAD, hf({ bump: false })), 'prod', id);
  C.eq = run(fixture(EQ, hf({ bump: false })), id);
  C.eqUat2 = run(fixture(EQ, hf({ bump: false })), 'uat', id);
  C.eqProd2 = run(fixture(EQ, hf({ bump: false })), 'prod', id);
  C.eqMerged = run(fixture(EQ, hf({ bump: false, merged: true })), id);
  C.empty = run(fixture(EQ, hf({ bump: false, empty: true })), id);
  C.bmProd = run(fixture(EQ, hf({ merged: true, backMerged: true })), id);
  C.bmUat = run(fixture(AHEAD, hf({ bump: false, merged: true, backMerged: true })), id);
  C.merged = run(fixture(EQ, hf({ merged: true })), id);
  C.mergedLow = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }, hf({ merged: true })), id);
  C.other = run(fixture(EQ, { branch: 'work-DEF-9-HF', bump: false, id: 'DEF-9' }), id);
  C.c2 = run(fixture(AHEAD, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1' }, null,
    [{ branch: 'work-ABC-1-HF', subject: '@ABC-12: Update Release Version to v0.1.19', push: true }]), 'ABC-1');
  C.ce = run(fixture(EQ, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1' }, null,
    [{ branch: 'work-ABC-1-HF', subject: '@ABC-12: Update Release Version to v0.1.18', push: true }]), 'ABC-1');
  C.cs = run(fixture(EQ, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1', empty: true }, null,
    [{ branch: 'work-ABC-1-HF', subject: '@ABC-12: Point QA swimlane at hotfix branch', push: true }]), 'ABC-1');
  C.win = run(fixture(AHEAD, hf({ bump: false, localBump: true })), id);
  C.localOnly = run(fixture(AHEAD, hf({ pushed: false })), id);
  C.stray = run(fixture(AHEAD, hf()));
  C.strayLegacy = run(fixture(AHEAD, { ...hf(), branch: `hotfix-${id}` }));
  C.finished = run(fixture(AHEAD, hf({ bump: false, intoIntegration: true })));
  const pruned = fixture(AHEAD, hf({ bump: false }), null, [{ pruneOnOrigin: `work-${id}-HF` }]);
  C.before = run(pruned); C.after = run(pruned, '--fetch');
}
{
  C.sEq = run(fixture(EQ, null, id), id);
  C.sEqUat = run(fixture(EQ, null, id), 'uat', id);
  C.sAhead = run(fixture(AHEAD, null, id), id);
  C.fixOnly = run(fixture(EQ, { branch: `work-${id}-HF`, bump: false, id, swap: false }, id), id);
  C.swapEq = run(fixture(EQ, { branch: `work-${id}-HF`, bump: false, id }, id), id);
  C.bm = run(fixture(EQ, { branch: `work-${id}-HF`, bump: false, id, merged: true, backMerged: true }, id), id);
  C.nb = run(fixture(EQ, { branch: `work-${id}-HF`, bump: false, id, merged: true }, null,
    [{ branch: 'integration', subject: `@${id}: Add the follow-up check`, push: true }]), id);
  C.lo = run(fixture(EQ, { branch: `work-${id}-HF`, bump: false, id, merged: true }, null,
    [{ branch: 'integration', subject: `@${id}: back-merge and config reset`, push: true }]), id);
}

// ---- build: one git init (template), one fast-import, then file copies --------------------------------------
const TPL = join(root, 'template');
gitRaw(root, ['init', '-q', '-b', 'master', TPL]);
writeFileSync(join(TPL, '.git', 'config'), readFileSync(join(TPL, '.git', 'config'), 'utf8') +
  '[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');
const STORE = join(root, 'store.git');
gitRaw(root, ['init', '-q', '--bare', STORE]);
const MARKS = join(root, 'marks');
gitRaw(STORE, ['fast-import', '--quiet', `--export-marks=${MARKS}`], stream + 'reset refs/fixture/tmp\n\n');
const sha = Object.fromEntries(readFileSync(MARKS, 'utf8').trim().split('\n').map(l => l.split(' ')).map(([m, s]) => [m.slice(1), s]));
const packed = refs => '# pack-refs with: peeled fully-peeled sorted \n' +
  Object.entries(refs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([r, m]) => `${sha[m]} ${r}\n`).join('');
const repoAt = (dir, refs, remoteUrl = null) => {
  cpSync(TPL, dir, { recursive: true });
  writeFileSync(join(dir, '.git', 'objects', 'info', 'alternates'), `${join(STORE, 'objects')}\n`);
  writeFileSync(join(dir, '.git', 'packed-refs'), packed(refs));
  if (remoteUrl) writeFileSync(join(dir, '.git', 'config'), readFileSync(join(dir, '.git', 'config'), 'utf8') +
    `[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
};
for (const f of fixtures) {
  mkdirSync(f.dir);
  const refs = {};
  for (const [b, m] of Object.entries(f.local)) refs[`refs/heads/${b}`] = m;
  for (const [b, m] of Object.entries(f.tracking)) refs[`refs/remotes/origin/${b}`] = m;
  let url = null;
  if (f.needsOrigin) {
    url = join(f.dir, 'origin');
    repoAt(url, Object.fromEntries(Object.entries(f.origin).map(([b, m]) => [`refs/heads/${b}`, m])));
  }
  repoAt(join(f.dir, 'clone'), refs, url);
}

// ---- run the script in this process --------------------------------------------------------------------------
const memo = new Map();
cp.spawnSync = function (cmd, args, opts) {
  if (cmd !== 'git') return realSpawnSync.call(this, cmd, args, opts);
  const cwd = process.cwd();
  if (args[0] === 'fetch') { for (const k of memo.keys()) if (k.startsWith(cwd + '\0')) memo.delete(k); return realSpawnSync.call(this, cmd, args, opts); }
  const key = `${cwd}\0${args.join('\0')}`;
  if (!memo.has(key)) { memo.set(key, realSpawnSync.call(this, cmd, args, opts)); }
  return memo.get(key);
};
syncBuiltinESMExports();
let runs = 0;
const failuresAtRun = [];
class Exit { constructor(code) { this.code = code; } }
for (const c of cases) {
  const out = [];
  const saved = { log: console.log, exit: process.exit, argv: process.argv, cwd: process.cwd() };
  process.chdir(c.cwd);
  process.argv = [process.execPath, SCRIPT, ...c.args];
  console.log = (...x) => out.push(x.join(' '));
  process.exit = code => { throw new Exit(code); };
  let code = 0;
  try { await import(`${pathToFileURL(SCRIPT).href}?run=${++runs}`); }
  catch (e) {
    if (e instanceof Exit) code = e.code;
    else { code = null; out.push(`script threw: ${e?.stack ?? e}`); failuresAtRun.push(`script threw for ${JSON.stringify(c.args)} in ${c.cwd}: ${e?.message ?? e}`); }
  }
  finally { console.log = saved.log; process.exit = saved.exit; process.argv = saved.argv; process.chdir(saved.cwd); }
  c.code = code; c.out = out.join('\n').trim();
}
cp.spawnSync = realSpawnSync;
syncBuiltinESMExports();
for (const m of failuresAtRun) check(m, false);

const verdict = out => out.split('\n').at(-1);
const head = out => out.split('\n').slice(0, 3);
const threeFirst = (out, m, r, i) => {
  const h = head(out);
  return h[0] === `master: ${m}` && h[1] === `release: ${r}` && h[2] === `integration: ${i}`;
};

console.log('release ahead of master');
for (const [arg, r] of [['none', C.aheadNone], ['uat', C.aheadUat]]) {
  check(`ahead + ${arg}: exit 0, UAT-only, no bump`, r.code === 0 && /^GO: UAT-only hotfix\. No version bump\.$/.test(verdict(r.out)), r.out);
  check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.18', '0.1.19'), r.out);
}
{
  const r = C.aheadProd;
  check('ahead + prod: exit 2 BLOCKED text', r.code === 2 && verdict(r.out) ===
    'BLOCKED: Production hotfix not allowed. release 0.1.18 is ahead of master 0.1.17: release holds changes not yet approved and signed off for production.', r.out);
  check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.18', '0.1.19'), r.out);
}

console.log('release equals master (real-world shape)');
for (const [arg, r] of [['none', C.eqNone], ['prod', C.eqProd]]) {
  check(`equal + ${arg}: exit 3 with both bump versions`, r.code === 3 &&
    verdict(r.out) === 'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', r.out);
  check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.17', '0.1.18'), r.out);
}
check('equal + uat: exit 2 BLOCKED UAT-only text', C.eqUat.code === 2 && verdict(C.eqUat.out) ===
  'BLOCKED: UAT-only hotfix not possible. release 0.1.17 equals master 0.1.17: release is already in production, so this hotfix must go to UAT and Production with a version bump. Rerun with `prod` or with no type.', C.eqUat.out);
check('equal, integration not above: exit 1 ERROR', C.eqLow.code === 1 && /^ERROR:/.test(verdict(C.eqLow.out)), C.eqLow.out);

console.log('errors');
check('release behind master: exit 1 ERROR', C.behind.code === 1 && /^ERROR:.*behind/.test(verdict(C.behind.out)), C.behind.out);
check('  three versions first', threeFirst(C.behind.out, '0.1.18', '0.1.17', '0.1.19'), C.behind.out);
check('missing package.json on release: exit 1 ERROR', C.missing.code === 1 && /^ERROR:/.test(verdict(C.missing.out)), C.missing.out);
check('  three versions first, unreadable shown', threeFirst(C.missing.out, '0.1.17', 'unreadable', '0.1.18'), C.missing.out);
for (const [args, r] of C.invalid) {
  check(`invalid argument ${JSON.stringify(args)}: exit 1, versions first`, r.code === 1 && /^ERROR: invalid argument/.test(verdict(r.out)) &&
    threeFirst(r.out, '0.1.17', '0.1.17', '0.1.18'), r.out);
}
check('GUS work ID accepted', C.gus.code === 3, C.gus.out);
check('suffixed work ID accepted', C.suffix.code === 2, C.suffix.out);

console.log('hotfix branch already exists');
check('bump commit, release ahead: exit 3 with back-merge version', C.bumpAhead.code === 3 && verdict(C.bumpAhead.out) ===
  'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.19 is already committed on the hotfix branch; back-merge bump 0.1.19 -> 0.1.20.', C.bumpAhead.out);
check('bump commit, equal: exit 3 with back-merge version', C.bumpEq.code === 3 && verdict(C.bumpEq.out) ===
  'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.18 is already committed on the hotfix branch; back-merge bump 0.1.18 -> 0.1.19.', C.bumpEq.out);
check('bump commit, integration + 1 not above hotfix version: exit 1 saying what to do', C.bumpLow.code === 1 && /^ERROR: back-merge version 0\.1\.18 would not be above.*; merge the integration version bump \(version-bump\) first, then rerun\.$/.test(verdict(C.bumpLow.out)), C.bumpLow.out);
check('bump commit on legacy hotfix- branch: exit 3', C.old.code === 3, C.old.out);
check('bump commit, release behind master: exit 1', C.behindBump.code === 1 && /^ERROR:.*behind/.test(verdict(C.behindBump.out)), C.behindBump.out);
check('no bump commit, release behind master: exit 1', C.behindNo.code === 1 && /^ERROR:.*behind/.test(verdict(C.behindNo.out)), C.behindNo.out);
check('bump commit + uat request: exit 2 mid-flight text', C.prodOnUat.code === 2 && verdict(C.prodOnUat.out) ===
  'BLOCKED: UAT-only hotfix not possible. The hotfix carries the version bump commit @ABC-123: Update Release Version to v0.1.19, so this hotfix is UAT + Production.', C.prodOnUat.out);
check('hotfix branch, no bump commit, release ahead: exit 0', C.ahead.code === 0 && /^GO: UAT-only/.test(verdict(C.ahead.out)), C.ahead.out);
check('no bump commit, release ahead + prod: start-rule BLOCKED', C.prodNo.code === 2 && verdict(C.prodNo.out) ===
  'BLOCKED: Production hotfix not allowed. release 0.1.18 is ahead of master 0.1.17: release holds changes not yet approved and signed off for production.', C.prodNo.out);
check('swap commit, no bump commit, equal: exit 0 UAT-only, no bump', C.eq.code === 0 &&
  verdict(C.eq.out) === 'GO: UAT-only hotfix. No version bump.', C.eq.out);
check('swap commit, no bump commit, equal + uat: exit 0', C.eqUat2.code === 0, C.eqUat2.out);
check('swap commit, no bump commit, equal + prod: exit 2 mid-flight text', C.eqProd2.code === 2 && verdict(C.eqProd2.out) ===
  'BLOCKED: Production hotfix not possible. The hotfix has its QA swap commit but no version bump commit, so this hotfix is UAT only.', C.eqProd2.out);
check('swap commit only in origin/release, equal: exit 0 UAT-only', C.eqMerged.code === 0 && /^GO: UAT-only/.test(verdict(C.eqMerged.out)), C.eqMerged.out);
check('hotfix branch with no @ID commit, equal: exit 3 with hotfix bump still to commit', C.empty.code === 3 && verdict(C.empty.out) ===
  'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', C.empty.out);
check('bump commit, back-merge done: exit 3, no bump left', C.bmProd.code === 3 &&
  verdict(C.bmProd.out) === 'GO: UAT + Production hotfix. Back-merge done; no bump left.', C.bmProd.out);
check('no bump commit, back-merge done: exit 0', C.bmUat.code === 0 && verdict(C.bmUat.out) === 'GO: UAT-only hotfix. Back-merge done.', C.bmUat.out);
check('bump commit only in origin/release, branches deleted: exit 3 with back-merge version', C.merged.code === 3 && verdict(C.merged.out) ===
  'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.18 is already committed on the hotfix branch; back-merge bump 0.1.18 -> 0.1.19.', C.merged.out);
check('  release version shown is the merged one', threeFirst(C.merged.out, '0.1.17', '0.1.18', '0.1.18'), C.merged.out);
check('bump commit only in release, integration + 1 not above: exit 1', C.mergedLow.code === 1 && /^ERROR: back-merge version/.test(verdict(C.mergedLow.out)), C.mergedLow.out);
check('other work ID branch ignored: exit 3 fresh bump', C.other.code === 3 && /hotfix bump 0\.1\.17 -> 0\.1\.18/.test(verdict(C.other.out)), C.other.out);
check('ABC-1 ignores an ABC-12 bump commit: exit 0', C.c2.code === 0, C.c2.out);
check('ABC-1 swap commit + ABC-12 bump commit, equal: exit 0 UAT-only', C.ce.code === 0 && /^GO: UAT-only/.test(verdict(C.ce.out)), C.ce.out);
check('ABC-1 ignores an ABC-12 swap commit, equal: exit 3', C.cs.code === 3, C.cs.out);
check('origin ref without bump wins over local unpushed bump: exit 0', C.win.code === 0, C.win.out);
check('bump commit found only on a local branch: exit 3', C.localOnly.code === 3, C.localOnly.out);
check('no work ID with a hotfix branch: exit 1 naming it', C.stray.code === 1 && threeFirst(C.stray.out, '0.1.17', '0.1.18', '0.1.19') &&
  verdict(C.stray.out) === 'ERROR: hotfix branches exist (work-ABC-123-HF); rerun with the work ID', C.stray.out);
check('no work ID with a legacy hotfix branch: exit 1 naming it', C.strayLegacy.code === 1 && /hotfix-ABC-123\)/.test(verdict(C.strayLegacy.out)), C.strayLegacy.out);
check('no work ID, finished hotfix branch merged into integration: normal verdict', C.finished.code === 0 &&
  /^GO: UAT-only/.test(verdict(C.finished.out)), C.finished.out);
check('stale remote-tracking hotfix ref: exit 1 without --fetch, exit 0 with it', C.before.code === 1 && C.after.code === 0 &&
  /^GO: UAT-only/.test(verdict(C.after.out)), `${C.before.out} | ${C.after.out}`);

console.log('hotfix reuses the work ID of a story already through the train');
check('story commits everywhere, no markers, equal: exit 3 with both bumps, back-merge not done', C.sEq.code === 3 && verdict(C.sEq.out) ===
  'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', C.sEq.out);
check('story commits everywhere, no markers, equal + uat: exit 2 start-rule BLOCKED', C.sEqUat.code === 2 &&
  /^BLOCKED: UAT-only hotfix not possible\. release 0\.1\.17 equals master/.test(verdict(C.sEqUat.out)), C.sEqUat.out);
check('story commits everywhere, no markers, release ahead: exit 0, no bump, back-merge not done', C.sAhead.code === 0 &&
  verdict(C.sAhead.out) === 'GO: UAT-only hotfix. No version bump.', C.sAhead.out);
check('hotfix branch with a fix commit but no swap commit, equal: exit 3', C.fixOnly.code === 3 &&
  /hotfix bump 0\.1\.17 -> 0\.1\.18/.test(verdict(C.fixOnly.out)), C.fixOnly.out);
check('story commits + swap commit without bump, equal: exit 0 UAT-only', C.swapEq.code === 0 &&
  verdict(C.swapEq.out) === 'GO: UAT-only hotfix. No version bump.', C.swapEq.out);
check('story commits + reset commit on integration: back-merge done', C.bm.code === 0 &&
  verdict(C.bm.out) === 'GO: UAT-only hotfix. Back-merge done.', C.bm.out);
check('ordinary @ID commit on integration without the reset commit: back-merge not done', C.nb.code === 0 &&
  verdict(C.nb.out) === 'GO: UAT-only hotfix. No version bump.', C.nb.out);
check('lowercase reset commit on integration: back-merge done', C.lo.code === 0 && verdict(C.lo.out) === 'GO: UAT-only hotfix. Back-merge done.', C.lo.out);

console.log('version compare');
{
  check('0.1.9 < 0.1.10', lib.compareVersions('0.1.9', '0.1.10') < 0);
  check('0.1.10 > 0.1.9', lib.compareVersions('0.1.10', '0.1.9') > 0);
  check('1.0 equals 1.0.0', lib.compareVersions('1.0', '1.0.0') === 0);
  check('non-numeric throws', (() => { try { lib.compareVersions('0.1.x', '0.1.1'); return false; } catch { return true; } })());
  check('bump 0.1.9 -> 0.1.10', lib.bumpVersion('0.1.9') === '0.1.10');
  const r = lib.decide({ master: '0.1.9', release: '0.1.10', integration: '0.1.11' });
  check('decide treats 0.1.10 as ahead of 0.1.9', r.code === 0, r.lines.join('|'));
  const e = lib.decide({ master: '0.1.x', release: '0.1.1', integration: '0.1.1' });
  check('decide: non-numeric version is ERROR', e.code === 1 && e.lines.length === 4);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
