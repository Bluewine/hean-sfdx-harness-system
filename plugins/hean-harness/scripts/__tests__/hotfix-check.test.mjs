#!/usr/bin/env node
/**
 * What hotfix-check decides for each release/master/integration shape, requested type and hotfix branch state.
 *
 * Every case runs the script in a throwaway clone of a throwaway bare origin; no client repository is touched.
 *
 * Run: node scripts/__tests__/hotfix-check.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(dirname(SCRIPTS), 'skills', 'hotfix', 'scripts', 'hotfix-check.mjs');
const lib = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hean-hotfix-check-')));
let n = 0;

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/**
 * versions: { master, release, integration } package.json versions (a missing key omits the branch's package.json).
 * hotfix: optional { branch, bump: boolean, id, version?, pushed? (default true), localBump?, merged?, empty?, swap?,
 *   backMerged?, intoIntegration? } created from release; when `bump` is false and `empty` is not set, the branch gets
 *   the swap commit `@{ID}: Point QA swimlane at hotfix branch` (left out when `swap` is false) and a fix commit;
 *   `version` is the bump commit's version (default release + 1); `pushed: false` keeps the branch local;
 *   `localBump` adds an unpushed bump commit on top of the pushed branch;
 *   `merged` fast-forwards release to the hotfix branch, pushes release and deletes the hotfix branch everywhere;
 *   `backMerged` then adds the reset commit `@{ID}: Back-merge and config reset` to integration;
 *   `intoIntegration` merges the pushed hotfix branch into integration and keeps the branch.
 * story: optional work ID whose ordinary commit `@{story}: Add the dedupe check` sits on master, release and
 *   integration, as when a hotfix reuses the work ID of a story already through the release train.
 */
function fixture(versions, hotfix = null, story = null) {
  const dir = join(root, `case-${++n}`);
  const origin = join(dir, 'origin.git'), clone = join(dir, 'clone');
  mkdirSync(dir);
  git(dir, 'init', '--bare', '-q', '-b', 'master', origin);
  git(dir, 'clone', '-q', origin, clone);
  const write = (v, subject) => {
    if (v !== undefined) writeFileSync(join(clone, 'package.json'), JSON.stringify({ name: 'x', version: v }));
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '--allow-empty', '-m', subject);
  };
  git(clone, 'checkout', '-q', '-b', 'master');
  write(versions.master, 'master');
  if (story) write(undefined, `@${story}: Add the dedupe check`);
  git(clone, 'push', '-q', 'origin', 'master');
  for (const b of ['release', 'integration']) {
    git(clone, 'checkout', '-q', '-b', b, 'master');
    if ('master' in versions && b in versions) write(versions[b], b);
    else if (!(b in versions)) { git(clone, 'rm', '-q', '-f', 'package.json'); git(clone, 'commit', '-q', '-m', `${b} without package.json`); }
    git(clone, 'push', '-q', 'origin', b);
  }
  if (hotfix) {
    const v = hotfix.version ?? lib.bumpVersion(versions.release);
    const bumpCommit = () => write(v, `@${hotfix.id}: Update Release Version to v${v}`);
    git(clone, 'checkout', '-q', '-b', hotfix.branch, 'release');
    if (hotfix.bump) bumpCommit();
    else if (!hotfix.empty) {
      if (hotfix.swap !== false) write(undefined, `@${hotfix.id}: Point QA swimlane at hotfix branch`);
      write(undefined, `@${hotfix.id}: Fix something`);
    }
    if (hotfix.pushed !== false) git(clone, 'push', '-q', 'origin', hotfix.branch);
    if (hotfix.localBump) bumpCommit();
    if (hotfix.merged) {
      git(clone, 'checkout', '-q', 'release');
      git(clone, 'merge', '-q', '--ff-only', hotfix.branch);
      git(clone, 'push', '-q', 'origin', 'release');
      git(clone, 'push', '-q', 'origin', '--delete', hotfix.branch);
      git(clone, 'branch', '-q', '-D', hotfix.branch);
    }
    if (hotfix.backMerged || hotfix.intoIntegration) {
      git(clone, 'checkout', '-q', 'integration');
      if (hotfix.backMerged) write(undefined, `@${hotfix.id}: Back-merge and config reset`);
      else git(clone, 'merge', '-q', '--no-ff', '-s', 'ours', '-m', 'merge hotfix', hotfix.branch);
      git(clone, 'push', '-q', 'origin', 'integration');
    }
  }
  git(clone, 'fetch', '-q', 'origin');
  return clone;
}

const run = (cwd, ...args) => {
  const r = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
};
const verdict = out => out.split('\n').at(-1);
const head = out => out.split('\n').slice(0, 3);
const threeFirst = (out, m, r, i) => {
  const h = head(out);
  return h[0] === `master: ${m}` && h[1] === `release: ${r}` && h[2] === `integration: ${i}`;
};

console.log('release ahead of master');
{
  const c = fixture({ master: '0.1.17', release: '0.1.18', integration: '0.1.19' });
  for (const args of [[], ['uat']]) {
    const r = run(c, ...args);
    check(`ahead + ${args[0] ?? 'none'}: exit 0, UAT-only, no bump`, r.code === 0 && /^GO: UAT-only hotfix\. No version bump\.$/.test(verdict(r.out)), r.out);
    check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.18', '0.1.19'), r.out);
  }
  const r = run(c, 'prod');
  check('ahead + prod: exit 2 BLOCKED text', r.code === 2 && verdict(r.out) ===
    'BLOCKED: Production hotfix not allowed. release 0.1.18 is ahead of master 0.1.17: release holds changes not yet approved and signed off for production.', r.out);
  check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.18', '0.1.19'), r.out);
}

console.log('release equals master (real-world shape)');
{
  const c = fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.18' });
  for (const args of [[], ['prod']]) {
    const r = run(c, ...args);
    check(`equal + ${args[0] ?? 'none'}: exit 3 with both bump versions`, r.code === 3 &&
      verdict(r.out) === 'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', r.out);
    check('  three versions first', threeFirst(r.out, '0.1.17', '0.1.17', '0.1.18'), r.out);
  }
  const r = run(c, 'uat');
  check('equal + uat: exit 2 BLOCKED UAT-only text', r.code === 2 && verdict(r.out) ===
    'BLOCKED: UAT-only hotfix not possible. release 0.1.17 equals master 0.1.17: release is already in production, so this hotfix must go to UAT and Production with a version bump. Rerun with `prod` or with no type.', r.out);
  const low = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }));
  check('equal, integration not above: exit 1 ERROR', low.code === 1 && /^ERROR:/.test(verdict(low.out)), low.out);
}

console.log('errors');
{
  const behind = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }));
  check('release behind master: exit 1 ERROR', behind.code === 1 && /^ERROR:.*behind/.test(verdict(behind.out)), behind.out);
  check('  three versions first', threeFirst(behind.out, '0.1.18', '0.1.17', '0.1.19'), behind.out);
  const missing = run(fixture({ master: '0.1.17', integration: '0.1.18' }));
  check('missing package.json on release: exit 1 ERROR', missing.code === 1 && /^ERROR:/.test(verdict(missing.out)), missing.out);
  check('  three versions first, unreadable shown', threeFirst(missing.out, '0.1.17', 'unreadable', '0.1.18'), missing.out);
  const c = fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.18' });
  for (const args of [['bogus'], ['uat', 'prod'], ['abc-1'], ['ABC-1', 'DEF-2']]) {
    const r = run(c, ...args);
    check(`invalid argument ${JSON.stringify(args)}: exit 1, versions first`, r.code === 1 && /^ERROR: invalid argument/.test(verdict(r.out)) &&
      threeFirst(r.out, '0.1.17', '0.1.17', '0.1.18'), r.out);
  }
  const ok = run(c, 'W-22028215');
  check('GUS work ID accepted', ok.code === 3, ok.out);
  const suffix = run(c, 'uat', 'ABC-123-UK');
  check('suffixed work ID accepted', suffix.code === 2, suffix.out);
}

console.log('hotfix branch already exists');
{
  const id = 'ABC-123';
  const eqV = { master: '0.1.17', release: '0.1.17', integration: '0.1.18' };
  const aheadV = { master: '0.1.17', release: '0.1.18', integration: '0.1.19' };
  const hf = (extra = {}) => ({ branch: `work-${id}-HF`, bump: true, id, ...extra });
  // Bump commit present: UAT + Production whatever release and master are now.
  for (const [v, label, line] of [
    [aheadV, 'release ahead', 'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.19 is already committed on the hotfix branch; back-merge bump 0.1.19 -> 0.1.20.'],
    [eqV, 'equal', 'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.18 is already committed on the hotfix branch; back-merge bump 0.1.18 -> 0.1.19.']
  ]) {
    const r = run(fixture(v, hf()), id);
    check(`bump commit, ${label}: exit 3 with back-merge version`, r.code === 3 && verdict(r.out) === line, r.out);
  }
  const low = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }, hf()), id);
  check('bump commit, integration + 1 not above hotfix version: exit 1 saying what to do', low.code === 1 && /^ERROR: back-merge version 0\.1\.18 would not be above.*; merge the integration version bump \(version-bump\) first, then rerun\.$/.test(verdict(low.out)), low.out);
  const old = run(fixture(eqV, { ...hf(), branch: `hotfix-${id}` }), id);
  check('bump commit on legacy hotfix- branch: exit 3', old.code === 3, old.out);
  const behindBump = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }, hf()), id);
  check('bump commit, release behind master: exit 1', behindBump.code === 1 && /^ERROR:.*behind/.test(verdict(behindBump.out)), behindBump.out);
  const behindNo = run(fixture({ master: '0.1.18', release: '0.1.17', integration: '0.1.19' }, hf({ bump: false })), id);
  check('no bump commit, release behind master: exit 1', behindNo.code === 1 && /^ERROR:.*behind/.test(verdict(behindNo.out)), behindNo.out);
  const prodOnUat = run(fixture(aheadV, hf()), 'uat', id);
  check('bump commit + uat request: exit 2 mid-flight text', prodOnUat.code === 2 && verdict(prodOnUat.out) ===
    'BLOCKED: UAT-only hotfix not possible. The hotfix carries the version bump commit @ABC-123: Update Release Version to v0.1.19, so this hotfix is UAT + Production.', prodOnUat.out);
  const ahead = run(fixture(aheadV, hf({ bump: false })), id);
  check('hotfix branch, no bump commit, release ahead: exit 0', ahead.code === 0 && /^GO: UAT-only/.test(verdict(ahead.out)), ahead.out);
  const prodNo = run(fixture(aheadV, hf({ bump: false })), 'prod', id);
  check('no bump commit, release ahead + prod: start-rule BLOCKED', prodNo.code === 2 && verdict(prodNo.out) ===
    'BLOCKED: Production hotfix not allowed. release 0.1.18 is ahead of master 0.1.17: release holds changes not yet approved and signed off for production.', prodNo.out);
  // Swap commit without a bump: UAT only, even when release has since caught up with master.
  const eq = run(fixture(eqV, hf({ bump: false })), id);
  check('swap commit, no bump commit, equal: exit 0 UAT-only, no bump', eq.code === 0 &&
    verdict(eq.out) === 'GO: UAT-only hotfix. No version bump.', eq.out);
  const eqUat = run(fixture(eqV, hf({ bump: false })), 'uat', id);
  check('swap commit, no bump commit, equal + uat: exit 0', eqUat.code === 0, eqUat.out);
  const eqProd = run(fixture(eqV, hf({ bump: false })), 'prod', id);
  check('swap commit, no bump commit, equal + prod: exit 2 mid-flight text', eqProd.code === 2 && verdict(eqProd.out) ===
    'BLOCKED: Production hotfix not possible. The hotfix has its QA swap commit but no version bump commit, so this hotfix is UAT only.', eqProd.out);
  const eqMerged = run(fixture(eqV, hf({ bump: false, merged: true })), id);
  check('swap commit only in origin/release, equal: exit 0 UAT-only', eqMerged.code === 0 && /^GO: UAT-only/.test(verdict(eqMerged.out)), eqMerged.out);
  const empty = run(fixture(eqV, hf({ bump: false, empty: true })), id);
  check('hotfix branch with no @ID commit, equal: exit 3 with hotfix bump still to commit', empty.code === 3 && verdict(empty.out) ===
    'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', empty.out);
  // Back-merge done: the reset commit on origin/integration.
  const bmProd = run(fixture(eqV, hf({ merged: true, backMerged: true })), id);
  check('bump commit, back-merge done: exit 3, no bump left', bmProd.code === 3 &&
    verdict(bmProd.out) === 'GO: UAT + Production hotfix. Back-merge done; no bump left.', bmProd.out);
  const bmUat = run(fixture(aheadV, hf({ bump: false, merged: true, backMerged: true })), id);
  check('no bump commit, back-merge done: exit 0', bmUat.code === 0 && verdict(bmUat.out) === 'GO: UAT-only hotfix. Back-merge done.', bmUat.out);
  const merged = run(fixture(eqV, hf({ merged: true })), id);
  check('bump commit only in origin/release, branches deleted: exit 3 with back-merge version', merged.code === 3 && verdict(merged.out) ===
    'GO: UAT + Production hotfix. Version bump required; the hotfix bump to 0.1.18 is already committed on the hotfix branch; back-merge bump 0.1.18 -> 0.1.19.', merged.out);
  check('  release version shown is the merged one', threeFirst(merged.out, '0.1.17', '0.1.18', '0.1.18'), merged.out);
  const mergedLow = run(fixture({ master: '0.1.17', release: '0.1.17', integration: '0.1.17' }, hf({ merged: true })), id);
  check('bump commit only in release, integration + 1 not above: exit 1', mergedLow.code === 1 && /^ERROR: back-merge version/.test(verdict(mergedLow.out)), mergedLow.out);
  const other = run(fixture(eqV, { branch: 'work-DEF-9-HF', bump: false, id: 'DEF-9' }), id);
  check('other work ID branch ignored: exit 3 fresh bump', other.code === 3 && /hotfix bump 0\.1\.17 -> 0\.1\.18/.test(verdict(other.out)), other.out);
  // Prefix collision: ABC-1 must not match the bump commit of ABC-12.
  const collide = run(fixture(aheadV, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1' }), 'ABC-1');
  const collide2 = fixture(aheadV, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1' });
  git(collide2, 'commit', '-q', '--allow-empty', '-m', '@ABC-12: Update Release Version to v0.1.19');
  git(collide2, 'push', '-q', 'origin', 'work-ABC-1-HF');
  const c2 = run(collide2, 'ABC-1');
  check('ABC-1 ignores an ABC-12 bump commit: exit 0', collide.code === 0 && c2.code === 0, c2.out);
  const collideEq = fixture(eqV, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1' });
  git(collideEq, 'commit', '-q', '--allow-empty', '-m', '@ABC-12: Update Release Version to v0.1.18');
  git(collideEq, 'push', '-q', 'origin', 'work-ABC-1-HF');
  const ce = run(collideEq, 'ABC-1');
  check('ABC-1 swap commit + ABC-12 bump commit, equal: exit 0 UAT-only', ce.code === 0 && /^GO: UAT-only/.test(verdict(ce.out)), ce.out);
  const collideSwap = fixture(eqV, { branch: 'work-ABC-1-HF', bump: false, id: 'ABC-1', empty: true });
  git(collideSwap, 'commit', '-q', '--allow-empty', '-m', '@ABC-12: Point QA swimlane at hotfix branch');
  git(collideSwap, 'push', '-q', 'origin', 'work-ABC-1-HF');
  const cs = run(collideSwap, 'ABC-1');
  check('ABC-1 ignores an ABC-12 swap commit, equal: exit 3', cs.code === 3, cs.out);
  // Origin ref wins over a local ref.
  const win = run(fixture(aheadV, hf({ bump: false, localBump: true })), id);
  check('origin ref without bump wins over local unpushed bump: exit 0', win.code === 0, win.out);
  const localOnly = run(fixture(aheadV, hf({ pushed: false })), id);
  check('bump commit found only on a local branch: exit 3', localOnly.code === 3, localOnly.out);
  // No work ID while a hotfix branch exists.
  const stray = run(fixture(aheadV, hf()));
  check('no work ID with a hotfix branch: exit 1 naming it', stray.code === 1 && threeFirst(stray.out, '0.1.17', '0.1.18', '0.1.19') &&
    verdict(stray.out) === 'ERROR: hotfix branches exist (work-ABC-123-HF); rerun with the work ID', stray.out);
  const strayLegacy = run(fixture(aheadV, { ...hf(), branch: `hotfix-${id}` }));
  check('no work ID with a legacy hotfix branch: exit 1 naming it', strayLegacy.code === 1 && /hotfix-ABC-123\)/.test(verdict(strayLegacy.out)), strayLegacy.out);
  const finished = run(fixture(aheadV, hf({ bump: false, intoIntegration: true })));
  check('no work ID, finished hotfix branch merged into integration: normal verdict', finished.code === 0 &&
    /^GO: UAT-only/.test(verdict(finished.out)), finished.out);
  // --fetch prunes a hotfix branch deleted on origin.
  const pruned = fixture(aheadV, hf({ bump: false }));
  git(join(dirname(pruned), 'origin.git'), 'branch', '-q', '-D', `work-${id}-HF`);
  git(pruned, 'checkout', '-q', 'master');
  git(pruned, 'branch', '-q', '-D', `work-${id}-HF`);
  const before = run(pruned);
  const after = run(pruned, '--fetch');
  check('stale remote-tracking hotfix ref: exit 1 without --fetch, exit 0 with it', before.code === 1 && after.code === 0 &&
    /^GO: UAT-only/.test(verdict(after.out)), `${before.out} | ${after.out}`);
}

console.log('hotfix reuses the work ID of a story already through the train');
{
  const id = 'ABC-123';
  const eqV = { master: '0.1.17', release: '0.1.17', integration: '0.1.18' };
  const aheadV = { master: '0.1.17', release: '0.1.18', integration: '0.1.19' };
  const eq = run(fixture(eqV, null, id), id);
  check('story commits everywhere, no markers, equal: exit 3 with both bumps, back-merge not done', eq.code === 3 && verdict(eq.out) ===
    'GO: UAT + Production hotfix. Version bump required: hotfix bump 0.1.17 -> 0.1.18, back-merge bump 0.1.18 -> 0.1.19.', eq.out);
  const eqUat = run(fixture(eqV, null, id), 'uat', id);
  check('story commits everywhere, no markers, equal + uat: exit 2 start-rule BLOCKED', eqUat.code === 2 &&
    /^BLOCKED: UAT-only hotfix not possible\. release 0\.1\.17 equals master/.test(verdict(eqUat.out)), eqUat.out);
  const ahead = run(fixture(aheadV, null, id), id);
  check('story commits everywhere, no markers, release ahead: exit 0, no bump, back-merge not done', ahead.code === 0 &&
    verdict(ahead.out) === 'GO: UAT-only hotfix. No version bump.', ahead.out);
  const fixOnly = run(fixture(eqV, { branch: `work-${id}-HF`, bump: false, id, swap: false }, id), id);
  check('hotfix branch with a fix commit but no swap commit, equal: exit 3', fixOnly.code === 3 &&
    /hotfix bump 0\.1\.17 -> 0\.1\.18/.test(verdict(fixOnly.out)), fixOnly.out);
  const swapEq = run(fixture(eqV, { branch: `work-${id}-HF`, bump: false, id }, id), id);
  check('story commits + swap commit without bump, equal: exit 0 UAT-only', swapEq.code === 0 &&
    verdict(swapEq.out) === 'GO: UAT-only hotfix. No version bump.', swapEq.out);
  const bm = run(fixture(eqV, { branch: `work-${id}-HF`, bump: false, id, merged: true, backMerged: true }, id), id);
  check('story commits + reset commit on integration: back-merge done', bm.code === 0 &&
    verdict(bm.out) === 'GO: UAT-only hotfix. Back-merge done.', bm.out);
  const notBm = fixture(eqV, { branch: `work-${id}-HF`, bump: false, id, merged: true });
  git(notBm, 'checkout', '-q', 'integration');
  git(notBm, 'commit', '-q', '--allow-empty', '-m', `@${id}: Add the follow-up check`);
  git(notBm, 'push', '-q', 'origin', 'integration');
  const nb = run(notBm, id);
  check('ordinary @ID commit on integration without the reset commit: back-merge not done', nb.code === 0 &&
    verdict(nb.out) === 'GO: UAT-only hotfix. No version bump.', nb.out);
  const lower = fixture(eqV, { branch: `work-${id}-HF`, bump: false, id, merged: true });
  git(lower, 'checkout', '-q', 'integration');
  git(lower, 'commit', '-q', '--allow-empty', '-m', `@${id}: back-merge and config reset`);
  git(lower, 'push', '-q', 'origin', 'integration');
  const lo = run(lower, id);
  check('lowercase reset commit on integration: back-merge done', lo.code === 0 && verdict(lo.out) === 'GO: UAT-only hotfix. Back-merge done.', lo.out);
}

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

rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
