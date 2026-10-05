/**
 * The pure parts of the Apex coverage report: reading the class list, merging
 * per-test line data, formatting ranges and rendering the report. Nothing here
 * calls `sf` or touches the org.
 *
 * Line data comes from ApexCodeCoverage rows of the listed test classes only.
 * The aggregate coverage the CLI prints covers every test run in the org, so
 * it can show a class as covered by a test the caller never listed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Exit codes of the script. */
export const EXIT = { OK: 0, ERROR: 1, BELOW: 2, FAILED: 3 };

/** The two sections of apex-classes.txt: { test: [...], tested: [...] }. Blank lines and # lines are ignored. */
export function parseClassList(text) {
  const out = { test: [], tested: [] };
  let section = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[(test|tested)\]$/i);
    if (header) { section = header[1].toLowerCase(); continue; }
    if (section && !out[section].some(n => n.toLowerCase() === line.toLowerCase())) out[section].push(line);
  }
  return out;
}

/** Collapses sorted-or-not line numbers into ranges: [1,2,3,7,9,10] -> "1-3, 7, 9-10"; [] -> "". */
export function formatRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * Per class, the union of lines across every row: { covered, uncovered, total }.
 * A line covered by any test is covered, so it never counts as uncovered.
 * Classes with no row are absent from the result. Keys are lowercase class
 * names, because SOQL matches names case-insensitively and the org may spell
 * a name differently from the [tested] list.
 */
export function mergeCoverage(rows) {
  const byClass = new Map();
  for (const row of rows) {
    const name = row.ApexClassOrTrigger?.Name?.toLowerCase();
    if (!name) continue;
    const entry = byClass.get(name) ?? { covered: new Set(), uncovered: new Set() };
    for (const n of row.Coverage?.coveredLines ?? []) entry.covered.add(n);
    for (const n of row.Coverage?.uncoveredLines ?? []) entry.uncovered.add(n);
    byClass.set(name, entry);
  }
  const merged = {};
  for (const [name, { covered, uncovered }] of byClass) {
    const open = [...uncovered].filter(n => !covered.has(n));
    merged[name] = { covered: [...covered], uncovered: open, total: covered.size + open.length };
  }
  return merged;
}

/** The first <Class>.cls or <Class>.trigger under the package directories, repo-relative, or null. */
export function findSource(repoRoot, packageDirs, name) {
  const wanted = new Set([`${name}.cls`, `${name}.trigger`].map(n => n.toLowerCase()));
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isFile() && wanted.has(e.name.toLowerCase())) return join(dir, e.name);
    }
    for (const e of entries) {
      if (e.isDirectory()) { const hit = walk(join(dir, e.name)); if (hit) return hit; }
    }
    return null;
  };
  for (const pkg of packageDirs) {
    const hit = walk(join(repoRoot, pkg));
    if (hit) return relative(repoRoot, hit);
  }
  return null;
}

/** The package directory paths from sfdx-project.json; ['force-app'] when unreadable or empty. */
export function packageDirectories(repoRoot) {
  const file = join(repoRoot, 'sfdx-project.json');
  try {
    const paths = JSON.parse(readFileSync(file, 'utf8')).packageDirectories?.map(d => d.path).filter(Boolean);
    if (paths?.length) return paths;
  } catch { /* fall through to the default */ }
  return ['force-app'];
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const padLeft = (s, n) => ' '.repeat(Math.max(0, n - s.length)) + s;

/**
 * The failed-tests block lines for every test whose Outcome is not Pass,
 * with at most 5 stack lines each.
 */
function failureLines(tests) {
  const out = [];
  for (const t of tests.filter(t => t.Outcome !== 'Pass')) {
    const name = t.FullName ?? `${t.ApexClass?.Name}.${t.MethodName}`;
    out.push(`  ${name} — ${t.Message || t.Outcome}`);
    for (const l of String(t.StackTrace ?? '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5)) out.push(`    at ${l}`);
  }
  return out;
}

/**
 * Renders the whole report and decides the exit code.
 *
 * input: { org, tests, tested, merged, sourceOf }
 *   tests    result.tests[] from the CLI
 *   listed   class names from [test]; each one absent from tests[] gets a warning line
 *   tested   class names from [tested]
 *   merged   mergeCoverage() output
 *   sourceOf name -> repo-relative path or null
 * Returns { text, code }.
 */
export function renderReport({ org, tests, listed = [], tested, merged, sourceOf }) {
  const out = [];
  const classes = new Set(tests.map(t => t.ApexClass?.Name).filter(Boolean));
  const failedCount = tests.filter(t => t.Outcome !== 'Pass').length;
  out.push(`Apex coverage — org ${org} (development)`);
  out.push(`Tests run: ${plural(classes.size, 'class', 'classes')}, ${plural(tests.length, 'method', 'methods')} — ` +
           `${tests.length - failedCount} passed, ${failedCount} failed`);
  const ran = new Set(tests.map(t => t.ApexClass?.Name?.toLowerCase()).filter(Boolean));
  for (const name of listed.filter(n => !ran.has(n.toLowerCase()))) {
    out.push(`WARNING: test class ${name} was not run — check the name or that it is deployed`);
  }
  out.push('');

  if (failedCount) {
    out.push('FAILED TESTS (coverage below is incomplete until these pass)');
    out.push(...failureLines(tests));
    out.push('');
  }

  const rows = [...tested].sort().map(name => {
    const m = merged[name.toLowerCase()];
    if (!m) return { name, pct: 0, pctText: '0.0%', lines: '—', uncovered: 'no coverage: no listed test runs this class', below: true, missing: true };
    const pct = m.total === 0 ? 100 : (m.covered.length / m.total) * 100;
    return { name, pct, pctText: `${pct.toFixed(1)}%`, lines: `${m.covered.length}/${m.total}`,
             uncovered: m.uncovered.length ? formatRanges(m.uncovered) : '—', below: m.uncovered.length > 0, missing: false };
  });
  const w = {
    name: Math.max('Class'.length, ...rows.map(r => r.name.length)),
    pct: Math.max('Coverage'.length, ...rows.map(r => r.pctText.length)),
    lines: Math.max('Lines'.length, ...rows.map(r => r.lines.length))
  };
  // With failed tests and no rows at all, a table of "no coverage" rows would only repeat the failure.
  if (!(failedCount && !Object.keys(merged).length)) {
    out.push(`${pad('Class', w.name)}   ${pad('Coverage', w.pct)}   ${pad('Lines', w.lines)}   Uncovered lines`);
    for (const r of rows) out.push(`${pad(r.name, w.name)}   ${padLeft(r.pctText, w.pct)}   ${pad(r.lines, w.lines)}   ${r.uncovered}`);
    out.push('');
  }

  const below = rows.filter(r => r.below);
  let code;
  if (failedCount) {
    out.push(`RESULT: TESTS FAILED — fix ${plural(failedCount, 'failing test', 'failing tests')}, then rerun`);
    code = EXIT.FAILED;
  } else if (below.length) {
    out.push(`RESULT: BELOW 100% — ${below.length} of ${rows.length} classes need tests`);
    code = EXIT.BELOW;
  } else {
    out.push(`RESULT: 100% — all ${rows.length} classes fully covered`);
    code = EXIT.OK;
  }
  if (!failedCount) {
    for (const r of below) {
      if (r.missing) { out.push(`  ${r.name}: no listed test reaches it; add a test class or list one under [test]`); continue; }
      const src = sourceOf(r.name);
      out.push(`  ${r.name}: cover lines ${r.uncovered}${src ? ` (${src})` : ''}`);
    }
  }
  return { text: out.join('\n'), code };
}

export const errorReport = reason => `RESULT: ERROR — ${reason}`;
