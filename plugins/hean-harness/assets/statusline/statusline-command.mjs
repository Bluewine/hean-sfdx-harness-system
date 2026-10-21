#!/usr/bin/env node
/**
 * The status line: three lines.
 *
 *   1. path from ~, branch (and worktree), default org, context, the current turn's tokens
 *   2. the saved commit preference, then the orgs agents may deploy to and a count of the other connected orgs
 *      (the full list goes to a file the statusline-meter mod reads to draw the strip above the prompt)
 *   3. session name, model and effort, then the session's tokens and dollars
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

import { line1, line2, line3, homePath, readMeter, prepareMeterDir, orgRows, otherConnected, writeOrgList } from '../../scripts/lib/statusline.mjs';
import { readPreference } from '../../scripts/lib/commit-lifecycle.mjs';
import { readRoles, projectRoot, defaultOrg, orgOf } from '../../scripts/lib/org-roles.mjs';

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
  } catch (error) {
    // rev-parse prints every answer it could give before it fails on an unborn branch.
    return String(error?.stdout ?? '').trim();
  }
}

const cwd = String(get('workspace.current_dir', get('cwd', '')));
const sessionId = String(get('session_id', ''));

// ── Git ──────────────────────────────────────────────────────────────────────
let root = '', branch = '', worktree = '';
// One call answers every question: inside a work tree, top folder, git directory,
// shared git directory, branch. On an unborn branch it fails at the last answer, "HEAD".
const [inside, top, gitDir, common, ref] = cwd
  ? git(['-C', cwd, 'rev-parse', '--is-inside-work-tree', '--show-toplevel',
         '--path-format=absolute', '--git-dir', '--path-format=absolute', '--git-common-dir',
         '--abbrev-ref', 'HEAD']).split('\n')
  : [];
if (inside === 'true') {
  root = top ?? '';
  // "HEAD" means a detached HEAD, or a branch with no commit yet.
  branch = ref === 'HEAD'
    ? git(['-C', cwd, 'symbolic-ref', '--short', 'HEAD']) || git(['-C', cwd, 'rev-parse', '--short', 'HEAD'])
    : ref ?? '';
  // A linked worktree has a git directory of its own, apart from the shared one.
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
    turn: meter?.turn ?? null
  }), ''),
  safe(() => {
    const preference = safe(() => readPreference(), null);
    const roles = root ? Object.values(safe(() => readRoles(root), {})) : [];
    const showOrgs = root && (roles.length > 0 || projectRoot(cwd) !== null);
    // Each org's login is read once for row 2 and the strip's file both.
    const seen = new Map();
    const login = username => {
      if (!seen.has(username)) seen.set(username, safe(() => orgOf(username), null));
      return seen.get(username);
    };
    safe(() => writeOrgList(sessionId, orgRows(roles, login, branch), otherConnected(roles, login)));
    return line2(preference, showOrgs ? roles : null, login, branch);
  }, ''),
  safe(() => line3({
    model: String(get('model.display_name', '')),
    effort: String(get('effort.level', '')),
    costUsd: Number(get('cost.total_cost_usd', NaN)),
    sessionName: String(get('session_name', ''))
  }, meter), '')
].filter(Boolean);

process.stdout.write(`${lines.join('\n')}\n`);
