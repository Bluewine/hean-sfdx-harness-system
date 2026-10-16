#!/usr/bin/env node
/**
 * Decide which hotfix type is possible from the package.json versions on origin/master, origin/release and
 * origin/integration, and whether a requested type is allowed.
 *
 * Usage: hotfix-check.mjs [uat|prod] [<WORK-ID>] [--fetch]
 * Exit:  0 GO UAT-only, 3 GO UAT + Production, 2 BLOCKED, 1 ERROR.
 * Read-only: the only git call that writes is `git fetch --prune origin`, run when --fetch is passed.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORK_ID = /^([A-Z]+-[0-9]+(-[A-Z]{2})?|W-[0-9]+)$/;
const VERSION = /^[0-9]+(\.[0-9]+)*$/;

/** Numeric segment-by-segment compare: negative, 0 or positive. Throws on a non-numeric version. */
export function compareVersions(a, b) {
  for (const v of [a, b]) if (typeof v !== 'string' || !VERSION.test(v)) throw new Error(`cannot compare version "${v}"`);
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The version with its last numeric segment + 1. */
export function bumpVersion(v) {
  if (typeof v !== 'string' || !VERSION.test(v)) throw new Error(`cannot bump version "${v}"`);
  const p = v.split('.');
  p[p.length - 1] = String(Number(p[p.length - 1]) + 1);
  return p.join('.');
}

/**
 * Pure decision.
 * input: { master, release, integration (version strings or null when unreadable), requested ('uat'|'prod'|null),
 *          midflight (null when no work ID was passed, else
 *            { id, hasBump, hotfixVersion (version on the hotfix ref, or from the bump subject), bumpSubjectVersion,
 *              hasSwap (the swap commit on the hotfix refs or release), backMerged (the reset commit on integration) }),
 *          strayBranches (hotfix branch names found when no work ID was passed) }
 * Returns { code, lines } where lines start with the three versions and end with one GO/BLOCKED/ERROR line.
 */
export function decide({ master, release, integration, requested = null, midflight = null, strayBranches = [] }) {
  const show = v => v ?? 'unreadable';
  const lines = [`master: ${show(master)}`, `release: ${show(release)}`, `integration: ${show(integration)}`];
  const done = (code, verdict) => ({ code, lines: [...lines, verdict] });
  const error = msg => done(1, `ERROR: ${msg}`);

  if (strayBranches.length) return error(`hotfix branches exist (${strayBranches.join(', ')}); rerun with the work ID`);

  let cmp;
  try { cmp = compareVersions(release, master); compareVersions(integration, integration); }
  catch (e) { return error(`${e.message}; the versions of master, release and integration must all be readable and numeric. Stop.`); }

  if (cmp < 0) return error(`release ${release} is behind master ${master}. Stop.`);

  // true = UAT + Production, false = UAT only. A UAT + Production run commits the bump before the swap commit, so a
  // swap commit without a bump means UAT only, even after release later catches up with master.
  const prod = midflight?.hasBump ? true : midflight?.hasSwap ? false : cmp === 0;

  if (prod && requested === 'uat') {
    if (midflight?.hasBump) {
      return done(2, `BLOCKED: UAT-only hotfix not possible. The hotfix carries the version bump commit @${midflight.id}: Update Release Version to v${midflight.bumpSubjectVersion}, so this hotfix is UAT + Production.`);
    }
    return done(2, `BLOCKED: UAT-only hotfix not possible. release ${release} equals master ${master}: release is already in production, so this hotfix must go to UAT and Production with a version bump. Rerun with \`prod\` or with no type.`);
  }
  if (!prod && requested === 'prod') {
    if (cmp === 0) { // only a swap commit without a bump makes an equal release UAT only
      return done(2, 'BLOCKED: Production hotfix not possible. The hotfix has its QA swap commit but no version bump commit, so this hotfix is UAT only.');
    }
    return done(2, `BLOCKED: Production hotfix not allowed. release ${release} is ahead of master ${master}: release holds changes not yet approved and signed off for production.`);
  }
  if (!prod) return done(0, midflight?.backMerged ? 'GO: UAT-only hotfix. Back-merge done.' : 'GO: UAT-only hotfix. No version bump.');
  if (midflight?.backMerged) return done(3, 'GO: UAT + Production hotfix. Back-merge done; no bump left.');

  const bumped = midflight?.hasBump;
  const hotfix = bumped ? midflight.hotfixVersion : bumpVersion(release);
  let back;
  try { back = bumpVersion(integration); compareVersions(hotfix, hotfix); }
  catch (e) { return error(`${e.message}; the hotfix version must be readable and numeric. Stop.`); }
  if (compareVersions(back, hotfix) <= 0) {
    return error(`back-merge version ${back} would not be above the hotfix version ${hotfix} (integration ${integration}); merge the integration version bump (version-bump) first, then rerun.`);
  }
  if (bumped) {
    return done(3, `GO: UAT + Production hotfix. Version bump required; the hotfix bump to ${hotfix} is already committed on the hotfix branch; back-merge bump ${integration} -> ${back}.`);
  }
  return done(3, `GO: UAT + Production hotfix. Version bump required: hotfix bump ${release} -> ${hotfix}, back-merge bump ${integration} -> ${back}.`);
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr || r.error?.message || '').trim() };
}

function readVersion(branch) {
  const r = git(['show', `origin/${branch}:package.json`]);
  if (!r.ok) return null;
  try { const v = JSON.parse(r.out).version; return typeof v === 'string' ? v : null; } catch { return null; }
}

/** The hotfix branch refs that exist, origin first. */
function hotfixRefs(id) {
  const refs = [];
  for (const name of [`work-${id}-HF`, `hotfix-${id}`]) {
    for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
      if (git(['rev-parse', '--verify', '--quiet', ref]).ok) { refs.push(ref); break; }
    }
  }
  return refs;
}

/** Refs that can hold the bump commit: hotfix branches first, then release (origin first, then local). */
function bumpRefs(id) {
  const out = hotfixRefs(id).map(ref => ({ ref, onHotfix: true }));
  for (const ref of ['refs/remotes/origin/release', 'refs/heads/release']) {
    if (git(['rev-parse', '--verify', '--quiet', ref]).ok) { out.push({ ref, onHotfix: false }); break; }
  }
  return out;
}

const subjects = ref => git(['log', ref, '--format=%s']).out.split('\n');
/** Case-insensitive prefix match on the subject: the colon after the ID keeps ABC-1 from matching @ABC-12: … */
const startsWithCi = (subject, prefix) => subject.toLowerCase().startsWith(prefix.toLowerCase());

function readMidflight(id) {
  // Only the subjects this skill writes count. A hotfix may reuse its story's work ID, whose ordinary `@{ID}: `
  // commits already sit on release and integration, so any other `@{ID}: ` commit says nothing about the hotfix.
  const prefix = `@${id}: Update Release Version to v`;
  const swap = `@${id}: Point QA swimlane at hotfix branch`, reset = `@${id}: Back-merge and config reset`;
  let bumpSubjectVersion = null, hotfixVersion = null, hasSwap = false;
  for (const { ref, onHotfix } of bumpRefs(id)) {
    // Full history: an old bump, swap or reset commit with the same work ID counts as this hotfix's. A hotfix that
    // reuses the work ID of a version-bump commit would be misread as UAT + Production, and a second hotfix with
    // the work ID of an earlier, completed hotfix reads as that earlier hotfix: its markers already sit on release
    // and integration.
    const all = subjects(ref);
    if (all.some(x => startsWithCi(x, swap))) hasSwap = true;
    const subject = all.find(x => startsWithCi(x, prefix));
    if (!subject) continue;
    bumpSubjectVersion = subject.slice(prefix.length).trim();
    if (onHotfix) {
      try { hotfixVersion = JSON.parse(git(['show', `${ref}:package.json`]).out).version; } catch { /* use the subject */ }
    }
    if (typeof hotfixVersion !== 'string') hotfixVersion = bumpSubjectVersion;
    break;
  }
  const integration = 'refs/remotes/origin/integration';
  const backMerged = git(['rev-parse', '--verify', '--quiet', integration]).ok && subjects(integration).some(x => startsWithCi(x, reset));
  return { id, hasBump: bumpSubjectVersion !== null, hotfixVersion, bumpSubjectVersion, hasSwap, backMerged };
}

/** Names of every unfinished hotfix branch (origin and local) when no work ID is given. */
function strayHotfixBranches() {
  const r = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/work-*-HF', 'refs/remotes/origin/hotfix-*',
    'refs/heads/work-*-HF', 'refs/heads/hotfix-*']);
  const names = r.out.split('\n').filter(Boolean)
    // A branch whose tip integration already contains is a finished hotfix left behind on this machine.
    .filter(ref => !git(['merge-base', '--is-ancestor', ref, 'refs/remotes/origin/integration']).ok)
    .map(x => x.replace(/^refs\/(remotes\/origin|heads)\//, ''));
  return [...new Set(names)];
}

function readVersions() {
  return { master: readVersion('master'), release: readVersion('release'), integration: readVersion('integration') };
}

function main(argv) {
  let requested = null, id = null, fetch = false;
  const stop = msg => {
    const v = readVersions();
    console.log(decide({ ...v, strayBranches: [] }).lines.slice(0, 3).join('\n'));
    console.log(`ERROR: ${msg}`);
    process.exit(1);
  };
  const bad = arg => stop(`invalid argument "${arg}". Usage: hotfix-check.mjs [uat|prod] [<WORK-ID>] [--fetch]`);
  for (const a of argv) {
    if (a === '--fetch') fetch = true;
    else if (a === 'uat' || a === 'prod') { if (requested) bad(a); requested = a; }
    else if (WORK_ID.test(a)) { if (id) bad(a); id = a; }
    else bad(a);
  }
  if (fetch) {
    const f = git(['fetch', '--prune', 'origin']);
    if (!f.ok) stop(`git fetch --prune origin failed: ${f.err}`);
  }
  const result = decide({
    ...readVersions(), requested,
    midflight: id ? readMidflight(id) : null,
    strayBranches: id ? [] : strayHotfixBranches()
  });
  console.log(result.lines.join('\n'));
  process.exit(result.code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
