# Three-Line Status Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-line status line into three lines — location and turn, commit preference and orgs, model and session meter — with a Claude Code mod supplying the token counts.

**Architecture:** The `statusLine` setting holds an inline Node launcher that finds the plugin's current version folder through `installed_plugins.json` and runs `assets/statusline/statusline-command.mjs` from there, so the script imports the plugin's libraries directly. The lines are built by pure functions in `scripts/lib/statusline.mjs`. A mod, `hooks/statusline-meter.mjs`, adds up the API-reported usage of every turn and request and writes it to `~/.claude/hean-harness/meter/<session-id>.json`, which the script reads.

**Tech Stack:** Node ES modules (no dependencies), Claude Code mods API (`turn.start`, `turn.step`, `turn.complete`, `$.fs`, `$.env`, `$.session.id`), `claude plugin test` for the mod, plain-Node `*.test.mjs` scripts for everything else.

**Spec:** `docs/superpowers/specs/2026-10-12-statusline-three-lines-design.md`

## Global Constraints

- Mods need Claude Code 2.1.287 or later; every other part works without the mod.
- The status line always exits 0 and always prints; a failing part is left out or shows its marker.
- No file is copied out of the plugin folder; the script imports `scripts/lib/*` from the plugin folder.
- `statusLine` value: `{ "type": "command", "command": <launcher>, "refreshInterval": 5 }`.
- Fallback line: `⚠ hean-harness status line: plugin not found — run /hean-harness:setup`.
- Meter file: `<claudeDir>/hean-harness/meter/<session-id>.json` holding `{ new, cached, turn: { up, down }, updatedAt }`.
- `new = input_tokens + cache_creation_input_tokens + output_tokens`; `cached = cache_read_input_tokens`; turn `up = input + cache_creation + cache_read`, `down = output`.
- Numbers: below 1,000 as is, then `k` and `M` with one decimal, truncated.
- Dollars: `≈$` + `cost.total_cost_usd` with two decimals; left out when absent.
- Commit subjects: `@HEAN-1: <Capitalised imperative summary>`, at most 77 characters.
- Tests follow `scripts/__tests__/*.test.mjs`: plain Node, a `check(label, ok, detail)` helper, sandbox home, `process.exit(failures ? 1 : 0)`.

## Review Focus

- `CLAUDE_CONFIG_DIR` set (including a `~/…` value): the mod and the script must name the same meter file, or the meter never shows. Test in Task 4.
- Usernames that are not sandbox-shaped (production `me@acme.com`, scratch `test-abc@example.com`): the environment name falls back to `prod` or the role, never `com`. Test in Task 1.
- A home or plugins folder whose path holds a space: the launcher command must still run. Test in Task 3.
- A meter file caught half-written (the mod's write is not atomic): the meter shows `🚕 –` for that run, never a crash or `NaN`. Test in Task 1.
- A detached HEAD in a worktree: line 1 shows the short commit hash where the branch would be. Test in Task 2.

---

### Task 1: Line builders library

**Files:**
- Create: `plugins/hean-harness/scripts/lib/statusline.mjs`
- Test: `plugins/hean-harness/scripts/__tests__/statusline.test.mjs`

**Interfaces:**
- Consumes: `STATE_DIR` from `scripts/lib/manifest.mjs`; `orgOf(name)` from `scripts/lib/org-roles.mjs` (returns `{ username, orgId, instanceUrl, isSandbox, isScratch }` or `null`).
- Produces:
  - `C(code: string|number, text: string): string` — ANSI colour wrapper
  - `fmtNum(n: number): string`
  - `homePath(dir: string, home?: string): string`
  - `commitsText(preference: { mode, commits } | null): string`
  - `orgsText(records: Array<{ alias, username, role, branch }>, login?: (username) => auth|null): string`
  - `line1({ dir, branch, worktree, org, usedPct, ctxWindow, turn, sessionName }): string`
  - `line2(preference, records | null, login?): string`
  - `line3({ model, effort, costUsd }, meter | null): string`
  - `METER_DIR: string` — `join(STATE_DIR, 'meter')`
  - `readMeter(sessionId: string, dir?: string): { new, cached, turn: { up, down } } | null`
  - `prepareMeterDir(dir?: string, now?: number): void`

- [ ] **Step 1: Write the failing test**

Create `plugins/hean-harness/scripts/__tests__/statusline.test.mjs`:

```js
#!/usr/bin/env node
/**
 * The three status lines: each piece from fixed inputs, the entry script with a
 * fixture on stdin, and the launcher command the statusLine setting holds.
 *
 * Runs against a throwaway home directory. Touches nothing of yours.
 *
 * Run: node scripts/__tests__/statusline.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGIN = dirname(SCRIPTS);
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'statusline-')));
const home = join(sandbox, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
// The libraries resolve the configuration folder when they load, so point it at the sandbox first.
process.env.HOME = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.SF_TARGET_ORG;
const lib = await import(join(SCRIPTS, 'lib', 'statusline.mjs'));

const strip = s => s.replace(/\u001b\[[0-9;]*m/g, '');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  // ── numbers and paths ──────────────────────────────────────────────────────
  check('numbers below 1,000 print as they are', lib.fmtNum(999) === '999' && lib.fmtNum(0) === '0');
  check('thousands are truncated, not rounded', lib.fmtNum(1999) === '1.9k', lib.fmtNum(1999));
  check('millions are truncated, not rounded', lib.fmtNum(2396257) === '2.3M', lib.fmtNum(2396257));
  check('a folder under home starts at ~', lib.homePath(join(home, 'git', 'repo'), home) === '~/git/repo');
  check('home itself is ~', lib.homePath(home, home) === '~');
  check('a folder outside home keeps its full path', lib.homePath('/opt/x', home) === '/opt/x');
  check('a sibling whose name starts with home\'s is not shortened',
        lib.homePath(`${home}other`, home) === `${home}other`);

  // ── commit preference ──────────────────────────────────────────────────────
  check('commit per task reads per task', lib.commitsText({ mode: 'main', commits: 'yes' }) === 'commits: per task');
  check('no commits reads none', lib.commitsText({ mode: 'subagent', commits: 'no' }) === 'commits: none');
  check('no saved preference reads not set', lib.commitsText(null) === 'commits: not set');

  // ── orgs ───────────────────────────────────────────────────────────────────
  const records = [
    { alias: 'hean-prod', username: 'me@acme.com', role: 'production', branch: 'master' },
    { alias: 'hean-uat', username: 'me@acme.com.uat', role: 'pipeline', branch: 'release' },
    { alias: 'hean-res', username: 'me@acme.com.res', role: 'research', branch: null },
    { alias: 'hean-qa', username: 'me@acme.com.qa', role: 'pipeline', branch: 'integration' },
    { alias: 'hean-dev', username: 'me@acme.com.dev', role: 'development', branch: null },
    { alias: 'hean-reint', username: 'me@acme.com.reint', role: 'pipeline', branch: 'work-*' }
  ];
  const loggedIn = new Set(['me@acme.com', 'me@acme.com.qa', 'me@acme.com.dev', 'me@acme.com.reint', 'me@acme.com.res']);
  const login = u => loggedIn.has(u) ? { isSandbox: u !== 'me@acme.com' } : null;
  const chain = lib.orgsText(records, login);
  check('orgs run development, pipeline by branch, research, production, with icons and aliases',
        chain === '🛠️ dev: hean-dev → 🧱 reint (work-*): hean-reint → 🧪 qa (integration): hean-qa → ' +
                  '🎭 uat (release): - → 🔭 res: hean-res → 🏦 prod: hean-prod', chain);
  const noAlias = lib.orgsText([{ alias: null, username: 'me@acme.com.dev', role: 'development', branch: null }], login);
  check('a logged-in org with no alias shows its username', noAlias === '🛠️ dev: me@acme.com.dev', noAlias);
  const others = lib.orgsText([
    { alias: 'z', username: 'me@acme.com.zz', role: 'pipeline', branch: 'zeta' },
    { alias: 'a', username: 'me@acme.com.aa', role: 'pipeline', branch: 'alpha' }
  ], () => ({ isSandbox: true }));
  check('pipeline orgs on other branches sort alphabetically and use 🚚',
        others === '🚚 aa (alpha): a → 🚚 zz (zeta): z', others);
  const scratch = lib.orgsText([{ alias: 's', username: 'test-abc@example.com', role: 'pipeline', branch: 'work-x' }],
    () => ({ isSandbox: false }));
  check('a username that is not sandbox-shaped falls back to the role name',
        scratch === '🧱 pipeline (work-x): s', scratch);
  check('no saved roles names the skill that saves them',
        lib.orgsText([], login) === '🔌 no org roles saved · /hean-harness:org-roles');
  check('saved roles with none logged in say no org is connected',
        lib.orgsText(records, () => null) === '🔌 no org connected');

  // ── lines 2 and 3 ──────────────────────────────────────────────────────────
  check('line 2 outside a project is the commit part alone',
        strip(lib.line2(null, null)) === '💾 commits: not set');
  check('line 2 joins the commit part and the orgs',
        strip(lib.line2({ mode: 'main', commits: 'yes' }, records, login)) === `💾 commits: per task │ ${chain}`);
  const l3 = strip(lib.line3({ model: 'Opus 5.5', effort: 'high', costUsd: 4.18 },
                             { new: 180412, cached: 2396257, turn: { up: 0, down: 0 } }));
  check('line 3 shows model, effort, the meter and the dollars',
        l3 === '🧠 Opus 5.5 · ⚡ high │ 🚕 180.4k new + 2.3M cached · ≈$4.18', l3);
  check('line 3 leaves effort out and shows a dash without the meter',
        strip(lib.line3({ model: 'Opus 5.5', costUsd: 0.42 }, null)) === '🧠 Opus 5.5 │ 🚕 – · ≈$0.42');
  check('line 3 leaves the dollars out when the cost is absent',
        strip(lib.line3({ model: 'Opus 5.5', costUsd: NaN }, null)) === '🧠 Opus 5.5 │ 🚕 –');

  // ── line 1 ─────────────────────────────────────────────────────────────────
  const l1 = strip(lib.line1({ dir: '~/git/repo', branch: 'work-A', worktree: 'A-wt', org: 'dev', usedPct: 12,
                               ctxWindow: 200000, turn: { up: 74210, down: 1830 }, sessionName: 's' }));
  check('line 1 in a worktree with a turn under way',
        l1 === '➜  📁 ~/git/repo 🌿 work-A (A-wt) ☁️ dev 📊 12% (24.0k/200.0k) │ ↑74.2k ↓1.8k 🏷️ s', l1);
  const l1Plain = strip(lib.line1({ dir: '~/git/repo', branch: 'main', usedPct: 12, ctxWindow: 200000 }));
  check('line 1 leaves out the worktree, org, turn and name when they have no value',
        l1Plain === '➜  📁 ~/git/repo 🌿 main 📊 12% (24.0k/200.0k)', l1Plain);

  // ── meter file ─────────────────────────────────────────────────────────────
  const meterDir = join(sandbox, 'meter');
  mkdirSync(meterDir, { recursive: true });
  writeFileSync(join(meterDir, 'good.json'), JSON.stringify({ new: 5, cached: 7, turn: { up: 3, down: 1 }, updatedAt: 1 }));
  writeFileSync(join(meterDir, 'half.json'), '{"new": 5, "cach');
  writeFileSync(join(meterDir, 'neg.json'), JSON.stringify({ new: -1, cached: 7, turn: { up: 3, down: 1 } }));
  const good = lib.readMeter('good', meterDir);
  check('a valid meter file is read', good?.new === 5 && good?.cached === 7 && good?.turn.up === 3 && good?.turn.down === 1,
        JSON.stringify(good));
  check('a half-written meter file reads as absent', lib.readMeter('half', meterDir) === null);
  check('a meter file with a negative count reads as absent', lib.readMeter('neg', meterDir) === null);
  check('a missing meter file reads as absent', lib.readMeter('none', meterDir) === null);
  check('a session id with a slash is refused', lib.readMeter('../good', meterDir) === null);

  const pruneDir = join(sandbox, 'prune');
  lib.prepareMeterDir(pruneDir);
  check('the meter folder is created', existsSync(pruneDir));
  const now = Date.now();
  const old = (now - 31 * 86_400_000) / 1000;
  writeFileSync(join(pruneDir, 'old.json'), '{}');
  writeFileSync(join(pruneDir, 'new.json'), '{}');
  utimesSync(join(pruneDir, 'old.json'), old, old);
  rmSync(join(pruneDir, '.pruned'), { force: true });
  lib.prepareMeterDir(pruneDir, now);
  check('a meter file older than 30 days is deleted', !existsSync(join(pruneDir, 'old.json')));
  check('a recent meter file is kept', existsSync(join(pruneDir, 'new.json')));
  writeFileSync(join(pruneDir, 'old2.json'), '{}');
  utimesSync(join(pruneDir, 'old2.json'), old, old);
  lib.prepareMeterDir(pruneDir, now + 1000);
  check('pruning runs at most once a day', existsSync(join(pruneDir, 'old2.json')));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: exits with an error `Cannot find module '…/scripts/lib/statusline.mjs'`.

- [ ] **Step 3: Write the library**

Create `plugins/hean-harness/scripts/lib/statusline.mjs`:

```js
/**
 * The pieces of the three status lines, apart from the entry script so a test
 * can build each one from fixed inputs.
 *
 * The entry script (assets/statusline/statusline-command.mjs) runs from the
 * plugin's current version folder, which the launcher in the statusLine setting
 * finds, so this module and the libraries it imports are always that version's.
 *
 * The token figures come from the meter file the statusline-meter mod writes:
 * only a mod receives the API's usage for each turn and request. This module
 * reads that file and never computes a token count itself.
 */

import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

import { STATE_DIR } from './manifest.mjs';
import { orgOf } from './org-roles.mjs';

export const C = (code, text) => `\u001b[${code}m${text}\u001b[0m`;
const SEP = C(90, '│');

// Truncated, not rounded: 1999 reads 1.9k, as the status line always has.
export function fmtNum(n) {
  if (n >= 1e6) return `${(Math.floor(n / 1e5) / 10).toFixed(1)}M`;
  if (n >= 1000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return String(n);
}

export function homePath(dir, home = homedir()) {
  if (dir === home) return '~';
  return dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir;
}

// ── Line 1 ──────────────────────────────────────────────────────────────────

export function line1({ dir, branch, worktree, org, usedPct, ctxWindow, turn, sessionName }) {
  let s = `${C(32, '➜')} `;
  if (dir) s += ` ${C('1;36', `📁 ${dir}`)}`;
  if (branch) s += ` ${C(36, `🌿 ${branch}${worktree ? ` (${worktree})` : ''}`)}`;
  if (org) s += ` ${C(35, `☁️ ${org}`)}`;
  if (Number.isFinite(usedPct)) {
    s += ` ${C(33, `📊 ${Math.round(usedPct)}%`)}`;
    if (ctxWindow > 0) s += ` ${C(37, `(${fmtNum(Math.round((usedPct / 100) * ctxWindow))}/${fmtNum(ctxWindow)})`)}`;
  }
  if (turn) s += ` ${SEP} ${C(94, `↑${fmtNum(turn.up)}`)} ${C(92, `↓${fmtNum(turn.down)}`)}`;
  if (sessionName) s += ` ${C(35, `🏷️ ${sessionName}`)}`;
  return s;
}

// ── Line 2 ──────────────────────────────────────────────────────────────────

export function commitsText(preference) {
  if (!preference) return 'commits: not set';
  return preference.commits === 'yes' ? 'commits: per task' : 'commits: none';
}

const ROLE_ORDER = { development: 0, pipeline: 1, research: 2, production: 3 };
const ROLE_ICON = { development: '🛠️', research: '🔭', production: '🏦' };
const PIPELINE_ICON = ['🧱', '🧪', '🎭'];

// The order a change travels through a branch-driven pipeline; 4 is any other branch.
function branchRank(branch) {
  const b = String(branch ?? '');
  if (b.startsWith('work-')) return 0;
  if (b === 'integration') return 1;
  if (b.startsWith('release')) return 2;
  if (b === 'main' || b === 'master') return 3;
  return 4;
}

function orderOrgs(records) {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const role = (ROLE_ORDER[a.r.role] ?? 4) - (ROLE_ORDER[b.r.role] ?? 4);
      if (role || a.r.role !== 'pipeline') return role || a.i - b.i;
      const rank = branchRank(a.r.branch) - branchRank(b.r.branch);
      if (rank) return rank;
      if (branchRank(a.r.branch) === 4) {
        const byName = String(a.r.branch ?? '').localeCompare(String(b.r.branch ?? ''));
        if (byName) return byName;
      }
      return a.i - b.i;
    })
    .map(x => x.r);
}

// A sandbox username ends in the sandbox's name: me@acme.com.reint is the
// reint sandbox. A login file says whether the org is a sandbox; without one,
// a domain of three or more labels is taken as a sandbox username.
function envName(record, auth) {
  if (record.role === 'production') return 'prod';
  const labels = (String(record.username ?? '').split('@')[1] ?? '').split('.').filter(Boolean);
  const sandbox = auth ? auth.isSandbox === true : labels.length >= 3;
  return sandbox && labels.length >= 3 ? labels[labels.length - 1] : record.role;
}

export function orgsText(records, login = username => orgOf(username)) {
  if (records.length === 0) return '🔌 no org roles saved · /hean-harness:org-roles';
  let connected = false;
  const parts = orderOrgs(records).map(r => {
    const auth = login(r.username);
    if (auth) connected = true;
    const icon = r.role === 'pipeline' ? (PIPELINE_ICON[branchRank(r.branch)] ?? '🚚') : (ROLE_ICON[r.role] ?? '❔');
    const branch = r.role === 'pipeline' && r.branch ? ` (${r.branch})` : '';
    const who = auth ? (r.alias || r.username) : '-';
    return `${icon} ${envName(r, auth)}${branch}: ${who}`;
  });
  return connected ? parts.join(' → ') : '🔌 no org connected';
}

export function line2(preference, records, login) {
  const commit = `💾 ${commitsText(preference)}`;
  return records == null ? commit : `${commit} ${SEP} ${orgsText(records, login)}`;
}

// ── Line 3 ──────────────────────────────────────────────────────────────────

export function line3({ model, effort, costUsd }, meter) {
  const left = [model && `🧠 ${model}`, effort && `⚡ ${effort}`].filter(Boolean).join(' · ');
  const tokens = meter ? `🚕 ${fmtNum(meter.new)} new + ${fmtNum(meter.cached)} cached` : '🚕 –';
  const cost = Number.isFinite(costUsd) ? ` · ≈$${costUsd.toFixed(2)}` : '';
  return `${left ? `${left} ${SEP} ` : ''}${tokens}${cost}`;
}

// ── Meter file ──────────────────────────────────────────────────────────────

export const METER_DIR = join(STATE_DIR, 'meter');
const SESSION_ID = /^[A-Za-z0-9._-]+$/;
const DAY = 86_400_000;

/** The meter the mod wrote for this session, or null when there is none or it cannot be read. */
export function readMeter(sessionId, dir = METER_DIR) {
  if (!SESSION_ID.test(String(sessionId)) || String(sessionId).startsWith('.')) return null;
  try {
    const m = JSON.parse(readFileSync(join(dir, `${sessionId}.json`), 'utf8'));
    const ok = v => Number.isFinite(v) && v >= 0;
    if (!ok(m.new) || !ok(m.cached) || !ok(m.turn?.up) || !ok(m.turn?.down)) return null;
    return { new: m.new, cached: m.cached, turn: { up: m.turn.up, down: m.turn.down } };
  } catch { return null; }
}

/**
 * Make sure the meter folder exists, and delete meter files older than 30
 * days at most once a day. The mod writes into this folder but cannot create
 * it or delete from it: the mods API's $.fs has neither.
 */
export function prepareMeterDir(dir = METER_DIR, now = Date.now()) {
  try {
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, '.pruned');
    if (existsSync(marker) && now - statSync(marker).mtimeMs < DAY) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = join(dir, f);
      if (now - statSync(p).mtimeMs > 30 * DAY) rmSync(p, { force: true });
    }
    writeFileSync(marker, '');
    utimesSync(marker, now / 1000, now / 1000);
  } catch { /* a status line must never fail the session */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: every line `pass`, last line `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/lib/statusline.mjs plugins/hean-harness/scripts/__tests__/statusline.test.mjs
git commit -m "@HEAN-1: Add the status line line builders"
```

### Task 2: Entry script prints the three lines

**Files:**
- Modify: `plugins/hean-harness/assets/statusline/statusline-command.mjs` (whole file is replaced: every part of it changes)
- Test: `plugins/hean-harness/scripts/__tests__/statusline.test.mjs`

**Interfaces:**
- Consumes: everything Task 1 produces; `readPreference()` from `scripts/lib/commit-lifecycle.mjs` (returns `{ mode, commits }` or `null`); `readRoles(home)`, `recordHome(root)`, `projectRoot(dir)`, `defaultOrg(root)` from `scripts/lib/org-roles.mjs`.
- Produces: `assets/statusline/statusline-command.mjs` — reads the statusLine JSON on stdin, prints three lines, exits 0. Task 3's launcher imports it.

- [ ] **Step 1: Write the failing test**

In `statusline.test.mjs`, insert this block just before the line `} finally {`:

```js
  // ── the entry script ───────────────────────────────────────────────────────
  const SCRIPT = join(PLUGIN, 'assets', 'statusline', 'statusline-command.mjs');
  const env = { ...process.env, HOME: home };
  const git = (...args) => execFileSync('git', args, { env, encoding: 'utf8', stdio: 'pipe' }).trim();
  const runScript = (input, extraEnv = {}) =>
    spawnSync('node', [SCRIPT], { env: { ...env, ...extraEnv }, input, encoding: 'utf8' });

  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  mkdirSync(join(repo, '.sf'), { recursive: true });
  git('-C', repo, 'init', '-q', '-b', 'work-ABC');
  writeFileSync(join(repo, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}');
  writeFileSync(join(repo, '.sf', 'config.json'), '{"target-org":"hean-dev"}');
  writeFileSync(join(repo, '.claude', 'hean-harness.json'), JSON.stringify({ orgs: {
    '00D1': { alias: 'hean-dev', username: 'me@acme.com.dev', role: 'development', deploy: true, branch: null },
    '00D2': { alias: 'hean-qa', username: 'me@acme.com.qa', role: 'pipeline', deploy: false, branch: 'integration' }
  } }));
  mkdirSync(join(home, '.sfdx'), { recursive: true });
  writeFileSync(join(home, '.sfdx', 'alias.json'), '{"orgs":{"hean-dev":"me@acme.com.dev"}}');
  writeFileSync(join(home, '.sfdx', 'me@acme.com.dev.json'), '{"orgId":"00D1","instanceUrl":"https://x","isSandbox":true}');
  const stateDir = join(home, '.claude', 'hean-harness');
  mkdirSync(join(stateDir, 'meter'), { recursive: true });
  writeFileSync(join(stateDir, 'implementation.json'), '{"mode":"main","commits":"yes"}');
  writeFileSync(join(stateDir, 'meter', 's1.json'), JSON.stringify({ new: 5000, cached: 20000, turn: { up: 2000, down: 300 }, updatedAt: 1 }));

  const fixture = (dir, session = 's1') => JSON.stringify({
    session_id: session, workspace: { current_dir: dir }, model: { display_name: 'Opus 5.5' },
    effort: { level: 'high' }, cost: { total_cost_usd: 1.5 },
    context_window: { used_percentage: 10, context_window_size: 1000000 }
  });

  const r = runScript(fixture(repo));
  const [s1, s2, s3] = strip(r.stdout).split('\n');
  check('the script exits 0', r.status === 0, r.stderr);
  check('line 1 shows the path from ~, the branch, the default org, the context and the turn',
        s1 === '➜  📁 ~/repo 🌿 work-ABC ☁️ hean-dev 📊 10% (100.0k/1.0M) │ ↑2.0k ↓300', s1);
  check('line 2 shows the commit preference and the project\'s orgs',
        s2 === '💾 commits: per task │ 🛠️ dev: hean-dev → 🧪 qa (integration): -', s2);
  check('line 3 shows the model, the effort, the meter and the dollars',
        s3 === '🧠 Opus 5.5 · ⚡ high │ 🚕 5.0k new + 20.0k cached · ≈$1.50', s3);

  const noMeter = strip(runScript(fixture(repo, 's2')).stdout).split('\n');
  check('without a meter file line 1 has no turn and line 3 shows a dash',
        !noMeter[0].includes('↑') && noMeter[2] === '🧠 Opus 5.5 · ⚡ high │ 🚕 – · ≈$1.50', noMeter.join(' / '));

  const plain = join(home, 'plain');
  mkdirSync(plain, { recursive: true });
  git('-C', plain, 'init', '-q', '-b', 'main');
  const plainLines = strip(runScript(fixture(plain)).stdout).split('\n');
  check('a repository that is no SFDX project and has no roles shows only the commit part',
        plainLines[1] === '💾 commits: per task', plainLines[1]);

  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(home, 'repo-wt');
  git('-C', repo, 'worktree', 'add', '-q', '-b', 'work-WT', wt);
  const wtLine = strip(runScript(fixture(wt)).stdout).split('\n')[0];
  check('in a linked worktree the branch is followed by the worktree folder name',
        wtLine.includes('📁 ~/repo-wt 🌿 work-WT (repo-wt)'), wtLine);
  const wtOrgs = strip(runScript(fixture(wt)).stdout).split('\n')[1];
  check('a linked worktree reads the main checkout\'s org roles', wtOrgs === s2, wtOrgs);
  git('-C', wt, 'checkout', '-q', '--detach');
  const sha = git('-C', wt, 'rev-parse', '--short', 'HEAD');
  const detached = strip(runScript(fixture(wt)).stdout).split('\n')[0];
  check('a detached HEAD shows the short commit hash', detached.includes(`🌿 ${sha} (repo-wt)`), detached);

  const empty = runScript('');
  check('empty input still prints and exits 0', empty.status === 0 && empty.stdout.length > 0, empty.stderr);
  rmSync(join(stateDir, 'meter'), { recursive: true, force: true });
  runScript(fixture(repo));
  check('the script creates the meter folder the mod writes into', existsSync(join(stateDir, 'meter')));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: the Task 1 checks pass; `line 1 shows the path from ~ …` and the other entry-script checks `FAIL` (the old script prints one line).

- [ ] **Step 3: Replace the entry script**

Replace the whole content of `plugins/hean-harness/assets/statusline/statusline-command.mjs` with:

```js
#!/usr/bin/env node
/**
 * The status line: three lines.
 *
 *   1. path from ~, branch (and worktree), default org, context, the current turn's tokens, session name
 *   2. the saved commit preference, then the project's orgs from development to production
 *   3. model and effort, then the session's tokens and dollars
 *
 * Node rather than shell, because the shell version needed jq, bc and awk, any
 * of which a Salesforce developer may lack, and a missing one blanked the line.
 * Node is already present: the sf CLI is a Node program.
 *
 * This file runs from the plugin's current version folder. The statusLine
 * setting holds a launcher that finds that folder (scripts/lib/statusline-launcher.mjs),
 * so the imports below are always the same version as this file.
 *
 * Reads one JSON object on standard input. Always prints and always exits 0:
 * a part that fails is left out, and the other lines still print.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

import { line1, line2, line3, homePath, readMeter, prepareMeterDir } from '../../scripts/lib/statusline.mjs';
import { readPreference } from '../../scripts/lib/commit-lifecycle.mjs';
import { readRoles, recordHome, projectRoot, defaultOrg } from '../../scripts/lib/org-roles.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { input = {}; }

const get = (path, fallback) => {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), input);
  return v === undefined || v === null || v === '' ? fallback : v;
};
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

const cwd = String(get('workspace.current_dir', get('cwd', '')));
const sessionId = String(get('session_id', ''));

// ── Git ──────────────────────────────────────────────────────────────────────
let root = '', branch = '', worktree = '';
if (cwd && git(['-C', cwd, 'rev-parse', '--is-inside-work-tree']) === 'true') {
  root = git(['-C', cwd, 'rev-parse', '--show-toplevel']);
  branch = git(['-C', cwd, 'symbolic-ref', '--short', 'HEAD']) || git(['-C', cwd, 'rev-parse', '--short', 'HEAD']);
  // A linked worktree has a git directory of its own, apart from the shared one.
  const gitDir = git(['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-dir']);
  const common = git(['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (root && gitDir && common && resolve(gitDir) !== resolve(common)) worktree = basename(root);
}

// ── Meter ────────────────────────────────────────────────────────────────────
prepareMeterDir();
const meter = readMeter(sessionId);

// ── Lines ────────────────────────────────────────────────────────────────────
const usedRaw = get('context_window.used_percentage', '');
const lines = [
  safe(() => line1({
    dir: cwd ? homePath(cwd) : '',
    branch,
    worktree,
    org: root ? (safe(() => defaultOrg(root)?.name, '') ?? '') : '',
    usedPct: usedRaw === '' ? NaN : Number(usedRaw),
    ctxWindow: Number(get('context_window.context_window_size', 0)) || 0,
    turn: meter?.turn ?? null,
    sessionName: String(get('session_name', ''))
  }), ''),
  safe(() => {
    const preference = safe(() => readPreference(), null);
    const roles = root ? Object.values(safe(() => readRoles(recordHome(root)), {})) : [];
    const showOrgs = root && (roles.length > 0 || projectRoot(cwd) !== null);
    return line2(preference, showOrgs ? roles : null);
  }, ''),
  safe(() => line3({
    model: String(get('model.display_name', '')),
    effort: String(get('effort.level', '')),
    costUsd: Number(get('cost.total_cost_usd', NaN))
  }, meter), '')
].filter(Boolean);

process.stdout.write(`${lines.join('\n')}\n`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: every line `pass`, `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/assets/statusline/statusline-command.mjs plugins/hean-harness/scripts/__tests__/statusline.test.mjs
git commit -m "@HEAN-1: Update the status line to print three lines"
```

### Task 3: Launcher setting, install and uninstall

**Files:**
- Create: `plugins/hean-harness/scripts/lib/statusline-launcher.mjs`
- Modify: `plugins/hean-harness/scripts/install-statusline.mjs` (whole file is replaced: header, imports and body all change)
- Modify: `plugins/hean-harness/scripts/lib/manifest.mjs:567-570` (uninstall clean-up)
- Test: `plugins/hean-harness/scripts/__tests__/statusline.test.mjs`, `plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`

**Interfaces:**
- Consumes: `claudeDir(env)` from `scripts/lib/paths.mjs`; `shQuote(value)` from `scripts/lib/shell.mjs`; `installJsonKey(file, key, value)` from `scripts/lib/install.mjs`; `init()`, `STATE_DIR` from `scripts/lib/manifest.mjs`; `METER_DIR` from Task 1.
- Produces:
  - `FALLBACK: string`, `SCRIPT: string` (`'assets/statusline/statusline-command.mjs'`)
  - `pluginsRoot(env?): string`
  - `pluginId(pluginRoot: string): string | null`
  - `launcherSource(root: string, id: string): string`
  - `launcherCommand(root: string, id: string): string`

- [ ] **Step 1: Write the failing tests**

In `statusline.test.mjs`, insert this block just before the line `} finally {`:

```js
  // ── the launcher ───────────────────────────────────────────────────────────
  const launcher = await import(join(SCRIPTS, 'lib', 'statusline-launcher.mjs'));
  const id = launcher.pluginId(PLUGIN);
  check('the plugin id comes from the marketplace file in a source checkout',
        id === 'hean-harness@hean-sfdx-harness-system', String(id));
  check('the plugin id comes from the path in the plugin cache',
        launcher.pluginId('/x/plugins/cache/mkt/plug/1.0.0') === 'plug@mkt');
  check('the plugins folder follows CLAUDE_CODE_PLUGIN_CACHE_DIR',
        launcher.pluginsRoot({ CLAUDE_CODE_PLUGIN_CACHE_DIR: '/p' }) === '/p');
  check('the plugins folder defaults to the configuration folder',
        launcher.pluginsRoot({}) === join(home, '.claude', 'plugins'));

  // A space in the path: the command must keep it one argument.
  const pluginsDir = join(sandbox, 'plug ins');
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [id]: [
    { scope: 'user', installPath: join(sandbox, 'gone'), version: '0.0.1', lastUpdated: '2026-01-01T00:00:00.000Z' },
    { scope: 'user', installPath: PLUGIN, version: '0.0.2', lastUpdated: '2026-10-01T00:00:00.000Z' }
  ] } }));
  const direct = runScript(fixture(repo)).stdout;
  const viaLauncher = spawnSync('bash', ['-c', launcher.launcherCommand(pluginsDir, id)],
    { env, input: fixture(repo), encoding: 'utf8' });
  check('the launcher runs the script of the most recently updated install',
        viaLauncher.status === 0 && viaLauncher.stdout === direct && direct.split('\n').length === 4,
        viaLauncher.stdout + viaLauncher.stderr);
  const lost = spawnSync('bash', ['-c', launcher.launcherCommand(join(sandbox, 'nowhere'), id)],
    { env, input: fixture(repo), encoding: 'utf8' });
  check('without installed_plugins.json the launcher prints the fallback line and exits 0',
        lost.status === 0 && lost.stdout === `${launcher.FALLBACK}\n`, lost.stdout + lost.stderr);
```

In `setup-twice.test.mjs`, after the check `'the advisor keys are set after setup'` (the block that ends with `JSON.stringify([afterFirst.env?.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL, afterFirst.advisorModel]));` following `run('setup.mjs', ['--repo', repo, '--commit-format', 'on']);`), add:

```js
  check('the status line runs the plugin\'s script through the launcher every 5 seconds',
        afterFirst.statusLine?.type === 'command' && afterFirst.statusLine?.refreshInterval === 5 &&
          String(afterFirst.statusLine?.command).includes('installed_plugins.json'),
        JSON.stringify(afterFirst.statusLine));
  check('setup copies no status line script out of the plugin',
        !existsSync(join(home, '.claude', 'hean-harness', 'statusline-command.mjs')));
```

In `setup-twice.test.mjs`, replace:

```js
  const revert = JSON.parse(run('lib/manifest.mjs', ['revert']));
```

with:

```js
  const meterDir = join(home, '.claude', 'hean-harness', 'meter');
  mkdirSync(meterDir, { recursive: true });
  writeFileSync(join(meterDir, 'some-session.json'), '{}');
  const revert = JSON.parse(run('lib/manifest.mjs', ['revert']));
  check('uninstall deletes the status line meter files', !existsSync(meterDir));
```

In `setup-twice.test.mjs`, after the `home5` block's last check (`'uninstall puts back the user\'s own task tools value'`), add:

```js
  // An install from before the launcher copied the script into the state folder.
  // Setup over it must remove that copy through the clear-previous step.
  const home6 = join(root, 'home6');
  mkdirSync(join(home6, '.claude'), { recursive: true });
  const env6 = { ...BASE_ENV, HOME: home6 };
  const oldCopy = join(home6, '.claude', 'hean-harness', 'statusline-command.mjs');
  execFileSync('node', ['--input-type=module', '-e',
    `import { init } from ${JSON.stringify(join(SCRIPTS, 'lib', 'manifest.mjs'))};` +
    `import { installFile } from ${JSON.stringify(join(SCRIPTS, 'lib', 'install.mjs'))};` +
    `init(); installFile(${JSON.stringify(join(dirname(SCRIPTS), 'assets', 'statusline', 'statusline-command.mjs'))}, ` +
    `${JSON.stringify(oldCopy)});`], { env: env6, encoding: 'utf8', stdio: 'pipe' });
  check('the older install\'s copy is in place before the upgrade', existsSync(oldCopy));
  execFileSync('node', [join(SCRIPTS, 'clear-previous-install.mjs')], { env: env6, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('node', [join(SCRIPTS, 'install-statusline.mjs')], { env: env6, encoding: 'utf8', stdio: 'pipe' });
  check('setup over an older install removes the copied status line script', !existsSync(oldCopy));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: exits with `Cannot find module '…/scripts/lib/statusline-launcher.mjs'`.

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: `FAIL  the status line runs the plugin's script through the launcher every 5 seconds`, `FAIL  setup copies no status line script out of the plugin`, `FAIL  uninstall deletes the status line meter files`, `FAIL  setup over an older install removes the copied status line script`.

- [ ] **Step 3: Write the launcher library**

Create `plugins/hean-harness/scripts/lib/statusline-launcher.mjs`:

```js
/**
 * The statusLine command: a few lines of Node held in the setting itself, which
 * find the plugin's current version folder and run its status line script.
 *
 * The plugin's folder is named after its version and moves on every update, so
 * the setting cannot name it, and a copy of the script outside the plugin could
 * not import the plugin's libraries. installed_plugins.json, in Claude Code's
 * plugins folder, records each install's installPath (plugin loading
 * reference); the plugins folder itself does not move. Setup writes that folder
 * and the plugin id into the command as text, so the command needs no path
 * logic of its own and reads the record on every run.
 *
 * When the lookup fails, the command prints FALLBACK instead of nothing: a
 * command that prints nothing leaves the status line empty with no sign why.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { claudeDir } from './paths.mjs';
import { shQuote } from './shell.mjs';

export const FALLBACK = '⚠ hean-harness status line: plugin not found — run /hean-harness:setup';
export const SCRIPT = 'assets/statusline/statusline-command.mjs';

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** Claude Code's plugins folder: CLAUDE_CODE_PLUGIN_CACHE_DIR when set, else <config>/plugins. */
export function pluginsRoot(env = process.env) {
  const override = (env.CLAUDE_CODE_PLUGIN_CACHE_DIR || '').trim();
  return override ? resolve(override) : join(claudeDir(env), 'plugins');
}

/**
 * The id installed_plugins.json files this plugin under, <name>@<marketplace>.
 * A cached install sits at cache/<marketplace>/<plugin>/<version>; a source
 * checkout has the marketplace file two folders up.
 */
export function pluginId(pluginRoot) {
  const parts = resolve(pluginRoot).split(sep);
  const i = parts.lastIndexOf('cache');
  if (i >= 0 && parts.length - i === 4) return `${parts[i + 2]}@${parts[i + 1]}`;
  const name = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))?.name;
  const market = readJson(join(dirname(dirname(resolve(pluginRoot))), '.claude-plugin', 'marketplace.json'))?.name;
  return name && market ? `${name}@${market}` : null;
}

export function launcherSource(root, id) {
  return [
    'import{readFileSync}from"node:fs";import{join}from"node:path";import{pathToFileURL}from"node:url";',
    'try{',
    `const list=JSON.parse(readFileSync(join(${JSON.stringify(root)},"installed_plugins.json"),"utf8")).plugins[${JSON.stringify(id)}];`,
    'const at=[...list].sort((a,b)=>String(b.lastUpdated??"").localeCompare(String(a.lastUpdated??"")))[0].installPath;',
    `await import(pathToFileURL(join(at,${JSON.stringify(SCRIPT)})).href);`,
    `}catch{process.stdout.write(${JSON.stringify(`${FALLBACK}\n`)});}`
  ].join('');
}

export const launcherCommand = (root, id) => `node --input-type=module -e ${shQuote(launcherSource(root, id))}`;
```

- [ ] **Step 4: Replace the installer**

Replace the whole content of `plugins/hean-harness/scripts/install-statusline.mjs` with:

```js
#!/usr/bin/env node
/**
 * Installs the status line — the three lines Claude Code prints at the bottom
 * of the terminal: location and turn, commit preference and orgs, model and
 * session meter.
 *
 * Nothing is copied. The setting holds a launcher that finds this plugin's
 * current version folder through installed_plugins.json on every run, so a
 * plugin update reaches the status line without running setup again, and the
 * script imports the plugin's own libraries. See lib/statusline-launcher.mjs.
 *
 * refreshInterval re-runs it every 5 seconds: Claude Code's own refreshes do
 * not fire for a change made in another session, such as a commit preference.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installJsonKey } from './lib/install.mjs';
import { claudeDir } from './lib/paths.mjs';
import { SCRIPT, pluginsRoot, pluginId, launcherCommand } from './lib/statusline-launcher.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const SOURCE = join(PLUGIN_ROOT, SCRIPT);
const SETTINGS = join(claudeDir(), 'settings.json');

const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Cannot find the status line script that ships with this plugin: ${SOURCE}`);
    process.exit(1);
  }
  const id = pluginId(PLUGIN_ROOT);
  if (!id) {
    console.error(`Cannot tell which installed plugin this is from its folder: ${PLUGIN_ROOT}`);
    process.exit(1);
  }
  const root = pluginsRoot();

  log(`Script         ${SCRIPT}, in the folder ${join(root, 'installed_plugins.json')} names for ${id}`);
  log(`Setting        statusLine in ${SETTINGS}, refreshed every 5 seconds`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  const r = installJsonKey(SETTINGS, 'statusLine',
    { type: 'command', command: launcherCommand(root, id), refreshInterval: 5 });
  log(r.hadKey
    ? 'Replaced the status line setting. Your previous one is recorded and comes back on uninstall.'
    : 'Set the status line.');

  log('');
  log('This shows up in your next session.');
}

main();
```

- [ ] **Step 5: Delete the meter files on uninstall**

In `plugins/hean-harness/scripts/lib/manifest.mjs`, replace:

```js
      // the saved implementation preference is machine-wide, not a recorded
      // change, so it must go before the emptiness check below can succeed
      rmSync(PREFERENCE_FILE, { force: true });
```

with:

```js
      // the saved implementation preference is machine-wide, not a recorded
      // change, so it must go before the emptiness check below can succeed
      rmSync(PREFERENCE_FILE, { force: true });
      // the status line meter files are generated per session, not recorded
      rmSync(join(STATE_DIR, 'meter'), { recursive: true, force: true });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs`
Expected: `all passed`, exit 0.

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: `all passed` (or the file's own success line), exit 0.

Run: `node plugins/hean-harness/scripts/__tests__/clear-previous-install.test.mjs`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/scripts/lib/statusline-launcher.mjs plugins/hean-harness/scripts/install-statusline.mjs plugins/hean-harness/scripts/lib/manifest.mjs plugins/hean-harness/scripts/__tests__/statusline.test.mjs plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs
git commit -m "@HEAN-1: Update the status line setting to a launcher"
```

### Task 4: Token meter mod

**Files:**
- Create: `plugins/hean-harness/hooks/statusline-meter.mjs`
- Create: `plugins/hean-harness/hooks/statusline-meter.test.ts`
- Modify: `plugins/hean-harness/hooks/hooks.json:1-2`

**Interfaces:**
- Consumes: mods API `$.env.get(name)`, `$.session.id()`, `$.fs.exists(path)`, `$.fs.read(path)`, `$.fs.write(path, text)`; events `session.start`, `classic.SessionStart`, `turn.start`, `turn.step`, `turn.complete`.
- Produces: `<claudeDir>/hean-harness/meter/<session-id>.json` = `{ new, cached, turn: { up, down }, updatedAt }`, which `readMeter` (Task 1) reads.

- [ ] **Step 1: Write the failing test**

Create `plugins/hean-harness/hooks/statusline-meter.test.ts`:

```ts
import { expect, mock, test } from 'claude-code/testing'

const FILE = '/home/u/.claude/hean-harness/meter/sess-1.json'
const usage = (input: number, write: number, read: number, output: number) => ({
  input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output,
  model: 'claude-test'
})

// Answers every call the mod makes; returns the files it wrote, by path.
function stub(on: any, { env = { HOME: '/home/u' }, files = new Map<string, string>(), stepUsage = null as any } = {}) {
  mock.env(on, env)
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', ($: any, e: any) => ({ value: files.has(e.path) }))
  on('fs.read', ($: any, e: any) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: stepUsage }
  })
  return files
}

async function step($: any, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1, ...extra })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
  return s.value
}

const read = (files: Map<string, string>, path = FILE) => JSON.parse(files.get(path) ?? '{}')

test('each request of the main turn adds to up and down, and a new turn starts at 0', async ($, on) => {
  const files = stub(on, { stepUsage: usage(10, 100, 1000, 50) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await step($)
  await step($, { index: 1 })
  expect(read(files).turn).toEqual({ up: 2220, down: 100 })
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(read(files).turn).toEqual({ up: 0, down: 0 })
})

test('a subagent request leaves the main turn alone', async ($, on) => {
  const files = stub(on, { stepUsage: usage(10, 100, 1000, 50) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await step($, { agentId: 'a1' })
  expect(files.has(FILE) ? read(files).turn : { up: 0, down: 0 }).toEqual({ up: 0, down: 0 })
})

test('every turn, main and subagent, adds to new and cached; a turn with no usage adds nothing', async ($, on) => {
  const files = stub(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(2, 300, 4000, 50) })
  await $.turn.complete({ turnId: 's1', answer: '', durationMs: 1, isAborted: false, agentId: 'a1', usage: usage(1, 100, 1000, 20) })
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: true, usage: null })
  const m = read(files)
  expect(m.new).toBe(473)
  expect(m.cached).toBe(5000)
})

test('a resumed session continues from the meter file it already has', async ($, on) => {
  const files = new Map([[FILE, JSON.stringify({ new: 1000, cached: 9000, turn: { up: 5, down: 6 }, updatedAt: 1 })]])
  stub(on, { files })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(0, 0, 1000, 10) })
  const m = read(files)
  expect(m.new).toBe(1010)
  expect(m.cached).toBe(10000)
})

test('CLAUDE_CONFIG_DIR moves the meter file as it moves the status line\'s', async ($, on) => {
  const files = stub(on, { env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '~/alt' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(1, 1, 1, 1) })
  expect(files.has('/home/u/alt/hean-harness/meter/sess-1.json')).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `claude plugin test plugins/hean-harness`
Expected: the run fails — either the five tests in `hooks/statusline-meter.test.ts` fail because no file is written, or the run reports that the plugin declares no hooks module. Either outcome counts as the expected failure.

- [ ] **Step 3: Write the mod**

Create `plugins/hean-harness/hooks/statusline-meter.mjs`:

```js
/**
 * Token meter for the status line: adds up the token counts the API reported
 * for every turn of the session, subagents included, and for each request of
 * the current main turn, and writes them where the status line reads them.
 *
 * A mod, because only a mod receives each turn's and each request's usage. The
 * status line row is no render site a mod can draw in, so the row stays a
 * statusLine command (assets/statusline/statusline-command.mjs) and this file
 * only supplies its numbers.
 *
 * A main turn's usage sums the main loop's responses only, and each subagent
 * run is its own turn.complete, so adding every turn.complete counts each
 * response once.
 *
 * The status line creates the meter folder and prunes it: $.fs can neither
 * create a folder nor delete a file.
 */

const SESSION_ID = /^[A-Za-z0-9._-]+$/

let totals = fresh()
let file = null

function fresh() {
  return { new: 0, cached: 0, turn: { up: 0, down: 0 } }
}

// Claude Code's configuration folder, resolved as scripts/lib/paths.mjs
// resolves it; that module needs Node APIs, which a hooks module does not have.
async function configDir($) {
  const home = (await $.env.get('HOME')) ?? ''
  const override = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  if (!override) return `${home}/.claude`
  if (override.startsWith('~')) return `${home}/${override.slice(1).replace(/^[/\\]/, '')}`
  return /^([/\\]|[A-Za-z]:)/.test(override) ? override : `${home}/${override}`
}

async function meterFile($) {
  if (file !== null) return file
  const id = String(await $.session.id())
  file = SESSION_ID.test(id) && !id.startsWith('.') ? `${await configDir($)}/hean-harness/meter/${id}.json` : ''
  return file
}

// Start from the file this session already has, so a resumed session keeps its count.
async function load($) {
  totals = fresh()
  file = null
  try {
    const path = await meterFile($)
    if (!path || !(await $.fs.exists(path))) return
    const saved = JSON.parse(String(await $.fs.read(path)))
    const n = v => (Number.isFinite(v) && v >= 0 ? v : 0)
    totals = { new: n(saved.new), cached: n(saved.cached), turn: { up: n(saved.turn?.up), down: n(saved.turn?.down) } }
  } catch {
    totals = fresh()
  }
}

async function save($) {
  try {
    const path = await meterFile($)
    if (path) await $.fs.write(path, JSON.stringify({ ...totals, updatedAt: Date.now() }))
  } catch {
    // the status line keeps showing the figures it last read
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  // /clear and /branch start a new session id; /resume returns to an old one.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)
    return next(e)
  })

  // turn.start fires for the main loop only.
  on('turn.start', async ($, e, next) => {
    totals.turn = { up: 0, down: 0 }
    await save($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result?.usage
    if (!e.agentId && u) {
      totals.turn.up += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      totals.turn.down += u.output_tokens
      await save($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      totals.new += u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
      totals.cached += u.cache_read_input_tokens
      await save($)
    }
    return next(e)
  })
}
```

- [ ] **Step 4: Point hooks.json at the mod**

In `plugins/hean-harness/hooks/hooks.json`, replace the first two lines:

```json
{
  "hooks": {
```

with:

```json
{
  "modules": ["./statusline-meter.mjs"],
  "hooks": {
```

- [ ] **Step 5: Run the tests and the validator**

Run: `claude plugin test plugins/hean-harness`
Expected: `5 pass`, `0 fail`.

Run: `claude plugin validate plugins/hean-harness`
Expected: `Validation passed` (warnings allowed only if they were there before this task); the `hooks:` line lists `session.start`, `classic.SessionStart`, `turn.start`, `turn.step`, `turn.complete`; the `calls:` line lists `env.get`, `session.id`, `fs.exists`, `fs.read`, `fs.write` and nothing else.

Run: `for f in plugins/hean-harness/hooks/__tests__/*.test.mjs; do node "$f" >/dev/null || echo "FAILED $f"; done`
Expected: no `FAILED` line (the settings hooks are unaffected by the `modules` key).

- [ ] **Step 6: Commit**

```bash
git add plugins/hean-harness/hooks/statusline-meter.mjs plugins/hean-harness/hooks/statusline-meter.test.ts plugins/hean-harness/hooks/hooks.json
git commit -m "@HEAN-1: Add the status line token meter mod"
```

### Task 5: Documentation

**Files:**
- Modify: `plugins/hean-harness/skills/setup/SKILL.md:3` (frontmatter `description`)
- Modify: `docs/porting-rules.md:12-14`
- Modify: `docs/wiki-coverage.md` (Hooks table)

**Interfaces:**
- Consumes: the files Tasks 1–4 created.
- Produces: no code.

- [ ] **Step 1: Update the setup skill description**

In `plugins/hean-harness/skills/setup/SKILL.md`, replace:

```
description: Install the hean-harness environment on this machine — copies rules, memories, agents and the status line into place, adds the claude alias,
```

with:

```
description: Install the hean-harness environment on this machine — copies rules, memories and agents into place, sets the status line, adds the claude alias,
```

- [ ] **Step 2: Update the porting rule**

In `docs/porting-rules.md`, replace:

```
2. A plugin cannot carry these natively: rule files, memories, the user's `CLAUDE.md`, and the
    status line setting. Ship them as files under `assets/` and have a setup script copy them into
    place.
```

with:

```
2. A plugin cannot carry these natively: rule files, memories, the user's `CLAUDE.md`, and the
    status line setting. Ship rules, memories and `CLAUDE.md` content as files under `assets/` and
    have a setup script copy them into place. The status line setting holds a launcher that finds
    the plugin's current version folder through `installed_plugins.json`, so its script stays in
    the plugin. A mod cannot draw in the status line row; it can only supply data the script reads.
```

- [ ] **Step 3: Add the mod to the wiki coverage table**

In `docs/wiki-coverage.md`, replace:

```
| naming-check.mjs | Hooks | documented |
```

with:

```
| naming-check.mjs | Hooks | documented |
| statusline-meter.mjs | Hooks | pending |
```

Report to the main session that `.claude/rules/wiki-coverage-tracking.md` requires asking the user whether `statusline-meter.mjs` gets a dedicated entry on the Hooks wiki page; the row stays `pending` until the user answers.

- [ ] **Step 4: Check the meta-file hygiene of the edited skill**

Run: `tail -c 1 plugins/hean-harness/skills/setup/SKILL.md | xxd -p`
Expected: `0a` (one trailing newline), and `grep -n '^---$' plugins/hean-harness/skills/setup/SKILL.md` shows only lines 1 and the frontmatter's closing line.

- [ ] **Step 5: Run every test once more**

Run: `node plugins/hean-harness/scripts/__tests__/statusline.test.mjs && node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs && node plugins/hean-harness/scripts/__tests__/clear-previous-install.test.mjs && claude plugin test plugins/hean-harness`
Expected: every command exits 0.

- [ ] **Step 6: Commit**

```bash
git add plugins/hean-harness/skills/setup/SKILL.md docs/porting-rules.md docs/wiki-coverage.md
git commit -m "@HEAN-1: Update the docs for the three-line status line"
```

### Task 6: Manual verification in a real session (user)

These checks need an interactive Claude Code session on the user's machine. The main session lists them for the user and reports each result; no subagent runs them.

- [ ] **Step 1:** The user runs `/hean-harness:setup` with this branch's plugin version installed, starts a new session, and confirms three lines appear with the icons from the spec.
- [ ] **Step 2:** In that session, run one prompt that spawns a subagent and one web fetch. Compare line 3's `new + cached` with the per-model token totals `/cost` reports. Report any difference with both figures.
- [ ] **Step 3:** Compare line 3's `≈$` with the cost `/cost` reports; they must match to the cent.
- [ ] **Step 4:** Run `/clear` and confirm the meter restarts at `🚕 –` or `0 new + 0 cached`; run `/resume` on the earlier session and confirm its totals come back.
- [ ] **Step 5:** In a second session, change the commit preference with `/hean-harness:implementation-defaults`; confirm the first session's line 2 changes within 5 seconds.
- [ ] **Step 6:** Open a session in a linked worktree and confirm line 1 shows the path from `~` and the branch followed by the worktree folder name.
