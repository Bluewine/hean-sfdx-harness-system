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

import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync, renameSync } from 'node:fs';
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

export function line1({ dir, branch, worktree, org, usedPct, ctxWindow, turn }) {
  let s = `${C(32, '➜')} `;
  if (dir) s += ` ${C('1;36', `📁 ${dir}`)}`;
  if (branch) s += ` ${C(36, `🌿 ${branch}${worktree ? ` (${worktree})` : ''}`)}`;
  if (org) s += ` ${C(35, `☁️ ${org}`)}`;
  if (Number.isFinite(usedPct)) {
    s += ` ${C(33, `📊 ${Math.round(usedPct)}%`)}`;
    if (ctxWindow > 0) s += ` ${C(37, `(${fmtNum(Math.round((usedPct / 100) * ctxWindow))}/${fmtNum(ctxWindow)})`)}`;
  }
  if (turn) s += ` ${SEP} ${C(94, `↑${fmtNum(turn.up)}`)} ${C(92, `↓${fmtNum(turn.down)}`)}`;
  return s;
}

// ── Line 2 ──────────────────────────────────────────────────────────────────

export function commitsText(preference) {
  if (!preference) return 'commits: not set';
  return preference.commits === 'yes' ? 'commits: per task' : 'commits: none';
}

// The chain a change travels through; research is listed apart, after it.
const ROLE_ORDER = { development: 0, pipeline: 1, production: 2, research: 3 };
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

// The stage an org stands for. A pipeline org is named after the branch that
// feeds it, so the line reads as the path a change takes.
function stageLabel(record) {
  if (record.role === 'development') return 'dev';
  if (record.role === 'production') return 'prod';
  if (record.role !== 'pipeline') return record.role;
  const branch = String(record.branch ?? '');
  return ['build', 'qa', 'uat'][branchRank(branch)] ?? (branch || 'pipeline');
}

// The branch shown in brackets. The development org and the org fed by work-*
// branches take the session's branch while it is a work branch, since that is
// the branch deploying there now.
function shownBranch(record, current) {
  const onWork = String(current ?? '').startsWith('work-');
  if (record.role === 'development') return onWork ? current : '';
  if (record.role === 'pipeline' && branchRank(record.branch) === 0) return onWork ? current : record.branch;
  return record.branch ?? '';
}

// One org as the status line draws it; paint false gives the same text without colour codes.
function orgEntry(r, login, current, paint = true) {
  const p = paint ? C : (_, text) => text;
  const icon = r.role === 'pipeline' ? (PIPELINE_ICON[branchRank(r.branch)] ?? '🚚') : (ROLE_ICON[r.role] ?? '❔');
  const who = login(r.username) ? (r.alias || r.username) : '-';
  const branch = shownBranch(r, current);
  const lock = r.deploy === true ? '🔓' : '🔒';
  return `${icon} ${p(35, `${stageLabel(r)}:${who}`)}${lock}${branch ? p(35, `[${branch}]`) : ''}`;
}

/** Every saved org, one plain row each, in the order the status line reads them: the strip above the prompt lists these. */
export function orgRows(records, login = username => orgOf(username), current = '') {
  return orderOrgs(records).map(r => orgEntry(r, login, current, false));
}

/** How many saved orgs that are no deploy target are logged in. */
export function otherConnected(records, login = username => orgOf(username)) {
  return records.filter(r => r.deploy !== true && login(r.username)).length;
}

// Row 2 shows only the orgs agents may deploy to, then a count of the other
// connected orgs. The full list is in the strip above the prompt, which the
// statusline-meter mod draws from the file writeOrgList writes.
export function orgsText(records, login = username => orgOf(username), current = '') {
  if (records.length === 0) return '🔌 no org roles saved · /hean-harness:org-roles';
  if (!records.some(r => login(r.username))) return '🔌 no org connected';
  const deploy = orderOrgs(records).filter(r => r.deploy === true);
  const chain = deploy.filter(r => r.role !== 'research').map(r => orgEntry(r, login, current)).join(' → ');
  const research = deploy.filter(r => r.role === 'research').map(r => orgEntry(r, login, current)).join(' · ');
  const shown = [chain, research].filter(Boolean).join(` ${SEP} `) || 'no deploy org';
  const n = otherConnected(records, login);
  return `${shown} · +${n} connected ${n === 1 ? 'org' : 'orgs'}`;
}

export function line2(preference, records, login, current) {
  const commit = `💾 ${commitsText(preference)}`;
  return records == null ? commit : `${commit} ${SEP} ${orgsText(records, login, current)}`;
}

// ── Line 3 ──────────────────────────────────────────────────────────────────

export function line3({ model, effort, costUsd, sessionName }, meter) {
  const name = sessionName ? `${C(35, `🏷️ ${sessionName}`)} ${SEP} ` : '';
  const left = [model && `🧠 ${model}`, effort && `⚡ ${effort}`].filter(Boolean).join(' · ');
  const tokens = meter ? `🚕 ${fmtNum(meter.new)} new + ${fmtNum(meter.cached)} cached` : '🚕 –';
  const cost = Number.isFinite(costUsd) ? ` · ≈$${costUsd.toFixed(2)}` : '';
  return `${name}${left ? `${left} ${SEP} ` : ''}${tokens}${cost}`;
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
 * Write the full org list and the count of other connected orgs for the strip
 * the statusline-meter mod draws above the prompt. The mod has no Node APIs and
 * cannot run sf, so it reads this file. It sits beside the meter files, named
 * <session>.orgs.json, so prepareMeterDir prunes it with them.
 */
export function writeOrgList(sessionId, orgs, more, dir = METER_DIR) {
  if (!SESSION_ID.test(String(sessionId)) || String(sessionId).startsWith('.')) return;
  const target = join(dir, `${sessionId}.orgs.json`);
  const temp = join(dir, `${sessionId}.orgs.${process.pid}.tmp.json`);
  try {
    writeFileSync(temp, JSON.stringify({ orgs, more, updatedAt: Date.now() }));
    renameSync(temp, target);
  } catch {
    try { rmSync(temp, { force: true }); } catch { /* nothing more to do */ }
  }
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
