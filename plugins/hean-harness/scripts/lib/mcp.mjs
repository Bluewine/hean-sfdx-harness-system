#!/usr/bin/env node
/**
 * Finds out whether this machine can already reach Linear, before adding a
 * second way to reach it.
 *
 * Several skills resolve a work ID to a Linear issue and a sprint cycle. They
 * need an MCP server pointed at Linear, and there is more than one way for one
 * to already be there: a colleague's own entry, another plugin that ships one,
 * or a previous run of this setup. Declaring one unconditionally in the plugin
 * manifest cannot account for any of that — a manifest is read as it stands,
 * with no room for a condition — and the result is two servers at the same URL,
 * each asking to be authenticated separately.
 *
 * So the check happens here, in a script, and the server is added only when
 * nothing already points at Linear.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { userConfigFile } from './paths.mjs';

/**
 * Match on the host, never on the server's name.
 *
 * The name is whoever added it's choice — one machine calls it `linear-server`,
 * a plugin that ships one calls it `linear`, a third person calls it something
 * else entirely. The host is the thing that is actually the same.
 */
export const LINEAR_HOST = 'mcp.linear.app';
export const LINEAR_URL = 'https://mcp.linear.app/mcp';
export const LINEAR_NAME = 'linear-server';

/** Where a declaration can live, read straight from disk rather than through the CLI. */
function readJson(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; }
  catch { return null; }     // a malformed file is not a declaration
}

/**
 * Every MCP server declared anywhere that applies to this repository.
 *
 * Read from the files rather than from `claude mcp list`, which health-checks
 * every server it finds. Against a dozen servers that takes seconds, which is
 * too slow to sit inside setup, and a server that is merely unreachable would
 * look like a server that is not there.
 */
export function declaredServers(repo) {
  const out = [];
  const take = (where, servers) => {
    for (const [name, v] of Object.entries(servers ?? {})) {
      out.push({ where, name, target: v?.url ?? v?.command ?? '' });
    }
  };

  if (repo) take('the repository\'s .mcp.json', readJson(join(repo, '.mcp.json'))?.mcpServers);

  const user = readJson(userConfigFile());
  take('your global configuration', user?.mcpServers);

  // Only this repository's own entry. The others in the file belong to other
  // checkouts and have no effect here, and counting them makes a repository
  // with no Linear look as though it has one, purely because a sibling does.
  for (const [path, entry] of Object.entries(user?.projects ?? {})) {
    if (samePath(path, repo)) take('your own configuration for this repository', entry?.mcpServers);
  }
  return out;
}

/**
 * The same checkout, allowing for the path being written differently.
 *
 * A project key is whatever absolute path the session was started from, so the
 * same repository can appear under a symlinked path and a resolved one. Compare
 * what the filesystem resolves them to, and fall back to the text when a path
 * no longer exists — the file keeps entries for checkouts that have since moved.
 */
function samePath(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/** Those of them that point at Linear. */
export function findLinear(repo) {
  return declaredServers(repo).filter(s => String(s.target).includes(LINEAR_HOST));
}

/**
 * Add one, at project scope so it travels with the repository.
 *
 * Project scope writes `<repo>/.mcp.json`, which is committed, so everyone who
 * clones gets it rather than each person adding it by hand. The command merges
 * into an existing file — a repository that already declares another server
 * keeps it.
 *
 * It is not safe to call blind: adding a name that is already there fails with
 * "already exists". Call findLinear first.
 */
export function addLinear(repo) {
  const r = spawnSync('claude',
    ['mcp', 'add', '--transport', 'http', '--scope', 'project', LINEAR_NAME, LINEAR_URL],
    { cwd: repo, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return { ok: r.status === 0, output };
}

export const removeCommand = `claude mcp remove ${LINEAR_NAME} -s project`;

// ---- CLI -------------------------------------------------------------------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--repo');
  const repo = i >= 0 ? a[i + 1] : process.cwd();

  switch (a[0]) {
    case 'list':
      for (const s of declaredServers(repo)) console.log(`  ${s.name.padEnd(22)} ${s.target}\n  ${''.padEnd(22)} in ${s.where}`);
      break;
    case 'status': {
      const hits = findLinear(repo);
      if (!hits.length) { console.log(`  no server points at ${LINEAR_HOST}`); break; }
      for (const s of hits) console.log(`  ${s.name} points at Linear, declared in ${s.where}`);
      break;
    }
    case 'add': {
      const hits = findLinear(repo);
      if (hits.length) { console.log(`  already there: ${hits.map(h => h.name).join(', ')}`); break; }
      const r = addLinear(repo);
      console.log(`  ${r.output}`);
      process.exit(r.ok ? 0 : 1);
    }
    default:
      console.error(`hean-harness mcp

Usage: mcp.mjs <command> [--repo R]

  list     every MCP server declared for this repository, and where each is declared
  status   whether any of them points at Linear
  add      add one at project scope, but only when none points at Linear`);
      process.exit(a[0] ? 1 : 0);
  }
}
