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
 * MEMORY.md is an index the developer may already have, so it gets a managed
 * block rather than being replaced.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { installFile, installBlock, installDir } from './lib/install.mjs';
import { MARKER } from './lib/shell.mjs';
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

function mdFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];
}

function main() {
  const repo = findRepo();
  const projectMemDir = join(claudeDir(), 'projects', encodeProjectPath(repo), 'memory');
  const agentMemDir = join(repo, '.claude', 'agent-memory');

  const projectFiles = mdFiles(PROJECT_SRC).filter(f => f !== 'MEMORY.md');
  const agents = existsSync(AGENT_SRC)
    ? readdirSync(AGENT_SRC).filter(a => statSync(join(AGENT_SRC, a)).isDirectory()).sort()
    : [];
  const agentCount = agents.reduce(
    (n, a) => n + mdFiles(join(AGENT_SRC, a)).filter(f => f !== 'MEMORY.md').length, 0);

  log(`Repository         ${repo}`);
  log(`Project memories   ${projectFiles.length} files -> ${projectMemDir}`);
  log(`Memory index       block added to ${join(projectMemDir, 'MEMORY.md')}`);
  log(`Agent memories     ${agentCount} files across ${agents.length} agents -> ${agentMemDir}`);
  for (const a of agents) log(`                     ${a}: ${mdFiles(join(AGENT_SRC, a)).length} files`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');

  installDir(projectMemDir);
  for (const f of projectFiles) installFile(join(PROJECT_SRC, f), join(projectMemDir, f));
  log(`Installed ${projectFiles.length} project memories`);

  const indexSrc = join(PROJECT_SRC, 'MEMORY.md');
  if (existsSync(indexSrc)) {
    const lines = readFileSync(indexSrc, 'utf8').split('\n').filter(l => l.startsWith('- '));
    installBlock(join(projectMemDir, 'MEMORY.md'), MARKER, lines.join('\n'), 'html');
    log(`Added ${lines.length} entries to the memory index`);
  }

  for (const a of agents) {
    const dest = join(agentMemDir, a);
    installDir(agentMemDir);
    installDir(dest);
    for (const f of mdFiles(join(AGENT_SRC, a))) {
      // the index gets a block, as the project one does, so a team's own
      // entries are not replaced by ours
      if (f === 'MEMORY.md') {
        const lines = readFileSync(join(AGENT_SRC, a, f), 'utf8').split('\n').filter(l => l.startsWith('- '));
        installBlock(join(dest, f), MARKER, lines.join('\n'), 'html');
      } else {
        installFile(join(AGENT_SRC, a, f), join(dest, f));
      }
    }
  }
  log(`Installed ${agentCount} agent memories into the repository`);
  log('');
  log('These apply from your next session in this repository.');
}

main();
