#!/usr/bin/env node
/**
 * Installs memories for the repository the developer is working in.
 *
 *   general/   ->  ~/.claude/projects/<encoded repo path>/memory/   every repository
 *   project/   ->  the same folder                                  only with sfdx-project.json
 *   agent/     ->  <repo>/.claude/agent-memory/<plugin>-<agent>/    only with sfdx-project.json
 *
 * project/ holds the Salesforce memories and agent/ those of the Salesforce
 * agents. Neither applies in a repository that is not an SFDX project, so
 * there they are skipped, and the ones an earlier run installed are removed:
 * the clear step before this deletes their files, the project index loses
 * their lines below, and each agent index is reverted here.
 *
 * Claude Code names the project folder after the repository's absolute path,
 * with every "/" and "." turned into "-". Verified against existing folders.
 *
 * MEMORY.md is an index the developer may already have, so it is never
 * replaced: setup adds or updates one line per memory it installs, generated from
 * that memory's frontmatter, and leaves every other line alone.
 */

import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, sep } from 'node:path';

import { init, load, revert } from '../../../scripts/lib/manifest.mjs';
import { installFile, installIndexLines, installDir } from '../../../scripts/lib/install.mjs';
import { INDEX } from '../../../scripts/lib/memory-index.mjs';
import { claudeDir, isSfdxRepo } from '../../../scripts/lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(dirname(dirname(HERE)));
const GENERAL_SRC = join(PLUGIN_ROOT, 'assets', 'memories', 'general');
const PROJECT_SRC = join(PLUGIN_ROOT, 'assets', 'memories', 'project');
const AGENT_SRC   = join(PLUGIN_ROOT, 'assets', 'memories', 'agent');
const PLUGIN_NAME = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).name;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

/** Claude Code's folder name for a repository. */
export function encodeProjectPath(absPath) {
  return absPath.replace(/[/.]/g, '-');
}

/**
 * Claude Code names a plugin agent `<plugin>:<agent>` and reads its project
 * memory from that name with every other character turned into "-". A folder
 * named after the agent alone is never read.
 */
export function agentMemoryFolder(pluginName, agentName) {
  return `${pluginName}:${agentName}`.replace(/[^a-zA-Z0-9\-_]/g, '-') || 'unknown';
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

/**
 * Revert the agent memory indexes and folders an earlier setup recorded under
 * this repository. The clear step keeps index lines for the install ahead to
 * replace in place, but no agent index is written in a repository without
 * sfdx-project.json, so their lines would keep pointing at deleted files.
 * Returns how many indexes were reverted.
 */
function clearAgentIndexes(agentMemDir) {
  const under = c => c.target === agentMemDir || c.target.startsWith(agentMemDir + sep);
  const ours = c => (c.type === 'index-lines' || c.type === 'dir-create') && under(c);
  const recorded = load().changes.filter(ours);
  if (!recorded.length) return 0;
  const failed = revert({ only: ours }).filter(r => !r.ok && !r.kept);
  for (const r of failed) log(`Could not clear ${r.target}: ${r.note}`);
  return recorded.filter(c => c.type === 'index-lines').length;
}

function main() {
  const repo = findRepo();
  const projectMemDir = join(claudeDir(), 'projects', encodeProjectPath(repo), 'memory');
  const agentMemDir = join(repo, '.claude', 'agent-memory');

  const sfdx = isSfdxRepo(repo);
  // the general memories apply in every repository, the Salesforce ones only in an SFDX project
  const sources = [...mdFiles(GENERAL_SRC).map(f => join(GENERAL_SRC, f)),
                   ...(sfdx ? mdFiles(PROJECT_SRC).map(f => join(PROJECT_SRC, f)) : [])];
  const allAgents = existsSync(AGENT_SRC)
    ? readdirSync(AGENT_SRC).filter(a => statSync(join(AGENT_SRC, a)).isDirectory()).sort()
    : [];
  const agents = sfdx ? allAgents : [];
  const agentCount = agents.reduce(
    (n, a) => n + mdFiles(join(AGENT_SRC, a)).length, 0);

  log(`Repository         ${repo}`);
  log(`Project memories   ${sources.length} files -> ${projectMemDir}`);
  log(`Memory index       ${sources.length} lines in ${join(projectMemDir, INDEX)}`);
  log(`Agent memories     ${agentCount} files across ${agents.length} agents -> ${agentMemDir}`);
  for (const a of agents) log(`                     ${a}: ${mdFiles(join(AGENT_SRC, a)).length} files -> ${agentMemoryFolder(PLUGIN_NAME, a)}`);
  if (!sfdx) log('Salesforce memories skipped — this repository has no sfdx-project.json, so they do not apply');
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();

  installDir(projectMemDir);
  for (const s of sources) installFile(s, join(projectMemDir, basename(s)));
  log(`Installed ${sources.length} project memories`);

  // drops the lines of the Salesforce memories an earlier run installed and this one skips
  installIndexLines(join(projectMemDir, INDEX), sources);
  log(`Indexed ${sources.length} project memories`);

  for (const a of agents) {
    const dest = join(agentMemDir, agentMemoryFolder(PLUGIN_NAME, a));
    installDir(agentMemDir);
    installDir(dest);
    const files = mdFiles(join(AGENT_SRC, a));
    for (const f of files) installFile(join(AGENT_SRC, a, f), join(dest, f));
    // the same lines as the project index, so a team's own entries stay
    installIndexLines(join(dest, INDEX), files.map(f => join(AGENT_SRC, a, f)));
  }
  if (sfdx) log(`Installed ${agentCount} agent memories into the repository`);
  else {
    const removed = clearAgentIndexes(agentMemDir);
    log(`Installed no agent memories; skipped the Salesforce memories — this repository has no sfdx-project.json` +
        (removed ? `, and removed the ${removed} agent memory indexes an earlier setup left` : ''));
  }
  log('');
  log('These apply from your next session in this repository.');
}

main();
