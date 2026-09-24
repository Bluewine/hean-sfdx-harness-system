#!/usr/bin/env node
/**
 * Installs memories for the repository the developer is working in.
 *
 *   Project memories   ->  ~/.claude/projects/<encoded repo path>/memory/
 *   Per-agent memories ->  <repo>/.claude/agent-memory/<agent>/
 *
 * Claude Code names the project folder after the repository's absolute path,
 * with every "/" and "." turned into "-". Verified against existing folders.
 *
 * MEMORY.md is an index the developer may already have, so it is never
 * replaced: setup adds or updates one line per shipped memory, generated from
 * that memory's frontmatter, and leaves every other line alone.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installFile, installIndexLines, installDir } from './lib/install.mjs';
import { INDEX } from './lib/memory-index.mjs';
import { claudeDir } from './lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const PROJECT_SRC = join(PLUGIN_ROOT, 'assets', 'memories', 'project');
const AGENT_SRC   = join(PLUGIN_ROOT, 'assets', 'memories', 'agent');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

/** Claude Code's folder name for a repository. */
export function encodeProjectPath(absPath) {
  return absPath.replace(/[/.]/g, '-');
}

function findRepo() {
  if (repoArg >= 0 && argv[repoArg + 1]) return argv[repoArg + 1];
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

// every shipped file in a folder is a memory; the index is built from them
function mdFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md') && f !== INDEX).sort() : [];
}

function main() {
  const repo = findRepo();
  const projectMemDir = join(claudeDir(), 'projects', encodeProjectPath(repo), 'memory');
  const agentMemDir = join(repo, '.claude', 'agent-memory');

  const projectFiles = mdFiles(PROJECT_SRC);
  const agents = existsSync(AGENT_SRC)
    ? readdirSync(AGENT_SRC).filter(a => statSync(join(AGENT_SRC, a)).isDirectory()).sort()
    : [];
  const agentCount = agents.reduce(
    (n, a) => n + mdFiles(join(AGENT_SRC, a)).length, 0);

  log(`Repository         ${repo}`);
  log(`Project memories   ${projectFiles.length} files -> ${projectMemDir}`);
  log(`Memory index       ${projectFiles.length} lines in ${join(projectMemDir, INDEX)}`);
  log(`Agent memories     ${agentCount} files across ${agents.length} agents -> ${agentMemDir}`);
  for (const a of agents) log(`                     ${a}: ${mdFiles(join(AGENT_SRC, a)).length} files`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();

  installDir(projectMemDir);
  for (const f of projectFiles) installFile(join(PROJECT_SRC, f), join(projectMemDir, f));
  log(`Installed ${projectFiles.length} project memories`);

  installIndexLines(join(projectMemDir, INDEX), projectFiles.map(f => join(PROJECT_SRC, f)));
  log(`Indexed ${projectFiles.length} project memories`);

  for (const a of agents) {
    const dest = join(agentMemDir, a);
    installDir(agentMemDir);
    installDir(dest);
    const files = mdFiles(join(AGENT_SRC, a));
    for (const f of files) installFile(join(AGENT_SRC, a, f), join(dest, f));
    // the same lines as the project index, so a team's own entries stay
    installIndexLines(join(dest, INDEX), files.map(f => join(AGENT_SRC, a, f)));
  }
  log(`Installed ${agentCount} agent memories into the repository`);
  log('');
  log('These apply from your next session in this repository.');
}

main();
