import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../scripts/open-work.mjs');
const out = JSON.parse(execFileSync('node', [script], { encoding: 'utf8', maxBuffer: 1 << 28 }));

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${detail}`); failed++; }
};

const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });

check('emits rows and mentionOnly', Array.isArray(out.rows) && Array.isArray(out.mentionOnly),
  Object.keys(out).join(','));

// The defining property: nothing already merged to integration may appear. This
// is what keeps the skill disjoint from /release-pr.
const integrationIds = new Set();
for (const s of git(['log', 'origin/integration', '--format=%s']).split('\n').filter(Boolean)) {
  for (const raw of s.match(/\b[A-Z]{2,}-[0-9]+/g) ?? []) integrationIds.add(raw);
}
const merged = out.rows.filter((r) => {
  // A row may legitimately share an ID with integration (work-ID reuse); it must
  // then be flagged. What must never happen is an unflagged already-merged row.
  return integrationIds.has(r.id) && !r.alsoInIntegration;
});
check('no already-merged row escapes unflagged', merged.length === 0,
  merged.map((r) => r.id).join(', '));

// Every row must own at least one unmerged commit.
check('every row has commits', out.rows.every((r) => r.commits > 0));

// pushState must agree with its own counts — a mismatch would mislead silently.
const badState = out.rows.filter((r) => {
  const expect = r.pushed === 0 ? 'fully local'
    : r.pushed === r.commits ? 'fully pushed' : 'partially pushed';
  return r.pushState !== expect;
});
check('pushState matches pushed/commits', badState.length === 0,
  JSON.stringify(badState));

// Stash entries are not work in flight; --branches --remotes must exclude them.
const stashCount = git(['stash', 'list']).split('\n').filter(Boolean).length;
const stashIds = new Set();
if (stashCount > 0) {
  for (const s of git(['log', '--format=%s', '-g', 'refs/stash']).split('\n').filter(Boolean)) {
    for (const raw of s.match(/\b[A-Z]{2,}-[0-9]+/g) ?? []) stashIds.add(raw);
  }
}
const fromStashOnly = out.rows.filter((r) => stashIds.has(r.id) && r.commits === 0);
check('stash-only work produces no row', fromStashOnly.length === 0,
  `${stashCount} stash entr(ies) present`);

// Sort contract: team ascending, then work ID compared numerically.
const num = (id) => Number(id.slice(id.lastIndexOf('-') + 1));
const sorted = out.rows.every((r, i, a) => i === 0 || num(a[i - 1].id) <= num(r.id)
  || a[i - 1].id.slice(0, a[i - 1].id.lastIndexOf('-')) !== r.id.slice(0, r.id.lastIndexOf('-')));
check('rows sorted by work ID numerically', sorted, out.rows.map((r) => r.id).join(', '));

// Live ground truth: ABC-96's story is merged, but eight tooling commits
// reused its ID and were never pushed. It must appear, and must be flagged.
const r96 = out.rows.find((r) => r.id === 'ABC-96');
check('ABC-96 present and flagged as also-in-integration',
  !!r96 && r96.alsoInIntegration === true, JSON.stringify(r96));


// The Branch column must be populated and must be a plain branch name — a bare
// refs/ path would mean the ref normalisation was dropped.
check('every row names at least one branch',
  out.rows.every((r) => Array.isArray(r.branches) && r.branches.length > 0),
  JSON.stringify(out.rows.filter((r) => !r.branches?.length).map((r) => r.id)));
const rawRefs = out.rows.flatMap((r) => r.branches ?? []).filter((b) => b.startsWith('refs/') || b.startsWith('origin/'));
check('branches are normalised names, not refs', rawRefs.length === 0, rawRefs.join(', '));

// Local and remote copies of one branch must collapse to a single name.
const dupes = out.rows.filter((r) => new Set(r.branches).size !== r.branches.length);
check('no duplicate branch names within a row', dupes.length === 0,
  JSON.stringify(dupes.map((r) => r.id)));

// Ground truth: ABC-96's commits live on the two tooling branches, NOT on a
// work-ABC-96 branch. That mismatch is the visible tell of work-ID reuse.
const b96 = out.rows.find((r) => r.id === 'ABC-96')?.branches ?? [];
check('ABC-96 branches reveal the ID reuse',
  b96.length > 0 && !b96.some((b) => b.includes('ABC-96')), b96.join(', '));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
