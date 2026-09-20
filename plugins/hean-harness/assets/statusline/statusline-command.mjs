#!/usr/bin/env node
/**
 * The status line: folder, git branch, Salesforce org, context use, token
 * counts, model, session name.
 *
 * Node rather than shell, because the shell version needed jq to read the JSON
 * on standard input, bc to divide, and awk to round. Each of those is a program
 * a Salesforce developer may not have, and a missing one produced a blank
 * status line with no explanation. Node is already present: the sf CLI is a
 * Node program.
 *
 * Reads one JSON object on standard input and prints one line.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { input = {}; }

const get = (path, fallback) => {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), input);
  return v === undefined || v === null || v === '' ? fallback : v;
};
const num = (path) => {
  const v = Number(get(path, 0));
  return Number.isFinite(v) ? v : 0;
};

const cwd          = String(get('workspace.current_dir', get('cwd', '')));
const dir          = cwd ? basename(cwd) : '';
const model        = String(get('model.display_name', ''));
const worktree     = String(get('workspace.git_worktree', ''));
const sessionName  = String(get('session_name', ''));
const usedRaw      = get('context_window.used_percentage', '');
const totalIn      = num('context_window.total_input_tokens');
const totalOut     = num('context_window.total_output_tokens');
const curOutput    = num('context_window.current_usage.output_tokens');
const ctxWindow    = num('context_window.context_window_size');
const sessionId    = String(get('session_id', 'default'));

// ── Per-cycle accumulation ───────────────────────────────────────────────────
// A cycle is: the user sends a message, Claude works, Claude stops. The state
// file carries the counts across invocations because each run sees only a
// snapshot: baseline_in baseline_out prev_total_in prev_total_out prev_cur_out
const stateDir = join(process.env.TMPDIR || tmpdir() || '/tmp', 'claude-statusline');
const stateFile = join(stateDir, `turn-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.state`);

let [baselineIn, baselineOut, prevTotalIn, prevTotalOut, prevCurOut] = [0, 0, 0, 0, 0];
if (existsSync(stateFile)) {
  const parts = readFileSync(stateFile, 'utf8').trim().split(/\s+/).map(n => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  });
  [baselineIn, baselineOut, prevTotalIn, prevTotalOut, prevCurOut] =
    [0, 1, 2, 3, 4].map(i => parts[i] ?? 0);
}

// A new cycle begins when the totals go backwards, which means the session was
// reset, or when the last call produced no output and this one does.
if (prevTotalIn > totalIn || prevTotalOut > totalOut) {
  baselineIn = prevTotalIn; baselineOut = prevTotalOut;
} else if (prevCurOut === 0 && curOutput > 0) {
  baselineIn = prevTotalIn; baselineOut = prevTotalOut;
}

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${baselineIn} ${baselineOut} ${totalIn} ${totalOut} ${curOutput}\n`);
} catch { /* a status line must never fail the session */ }

const cycleIn = Math.max(0, totalIn - baselineIn);
const cycleOut = Math.max(0, totalOut - baselineOut);

// ── Colour ───────────────────────────────────────────────────────────────────
const C = (code, text) => `\u001b[${code}m${text}\u001b[0m`;

// ── Salesforce org ───────────────────────────────────────────────────────────
function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

let sfOrgSegment = '';
if (cwd) {
  const root = gitOutput(['-C', cwd, 'rev-parse', '--show-toplevel']);
  let org = '';
  if (root) {
    for (const [file, key] of [['.sf/config.json', 'target-org'],
                               ['.sfdx/sfdx-config.json', 'defaultusername']]) {
      if (org) break;
      const p = join(root, file);
      if (!existsSync(p)) continue;
      try { org = String(JSON.parse(readFileSync(p, 'utf8'))[key] ?? ''); } catch { org = ''; }
    }
  }
  if (org) sfOrgSegment = ` ${C(35, `sf:(${org})`)}`;
}

// ── Git branch ───────────────────────────────────────────────────────────────
let gitSegment = '';
if (worktree) {
  gitSegment = ` ${C(36, `git:(${worktree})`)}`;
} else if (cwd && gitOutput(['-C', cwd, 'rev-parse', '--is-inside-work-tree']) === 'true') {
  // --no-optional-locks belongs before the subcommand, not after it. Passed
  // here, rev-parse treats it as a revision and echoes it back, which the shell
  // version hid by piping through grep. rev-parse takes no locks anyway.
  const branch = gitOutput(['-C', cwd, 'symbolic-ref', '--short', 'HEAD'])
              || gitOutput(['-C', cwd, 'rev-parse', '--short', 'HEAD']);
  if (branch) gitSegment = ` ${C(36, `git:(${branch})`)}`;
}

// ── Numbers ──────────────────────────────────────────────────────────────────
// Thousands are truncated, not rounded: 1999 reads 1.9k. The shell version
// divided with bc, whose scale truncates, and this keeps the same output.
const fmtNum = (n) => (n >= 1000 ? `${(Math.floor(n / 100) / 10).toFixed(1)}k` : String(n));

// ── Context usage ────────────────────────────────────────────────────────────
let ctxSegment = '';
if (usedRaw !== '' && usedRaw !== undefined) {
  const used = Number(usedRaw);
  if (Number.isFinite(used)) {
    let ctxAb = '';
    if (ctxWindow > 0) {
      const usedTokens = Math.round((used / 100) * ctxWindow);
      ctxAb = ` ${C(37, `(${fmtNum(usedTokens)}/${fmtNum(ctxWindow)})`)}`;
    }
    ctxSegment = ` ${C(33, `ctx:${Math.round(used)}%`)}${ctxAb}`;
  }
}

let reqSegment = '';
if (totalIn > 0) {
  const sep = ` ${C(90, '│')} `;
  reqSegment = `${sep}${C(94, `↑${fmtNum(cycleIn)}`)} ${C(92, `↓${fmtNum(cycleOut)}`)} ` +
               `${C(93, `Σ${fmtNum(totalIn + totalOut)}`)}`;
}

const sessionSegment = sessionName ? ` ${C(35, `[${sessionName}]`)}` : '';

process.stdout.write(
  `${C(32, '➜')}  ${C('1;36', dir)}${gitSegment}${sfOrgSegment}${ctxSegment}${reqSegment}` +
  `  ${C(90, model)}${sessionSegment}\n`);
