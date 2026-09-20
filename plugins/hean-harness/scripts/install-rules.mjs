#!/usr/bin/env node
/**
 * Installs the rules, each at the scope it belongs to.
 *
 *   assets/rules/user/     ->  ~/.claude/rules/          every repository
 *   assets/rules/project/  ->  <repo>/.claude/rules/     this repository only
 *   assets/claude-md/      ->  a block in ~/.claude/CLAUDE.md
 *
 * The split matters. User-scope rules are about writing and apply anywhere.
 * Project-scope rules are Salesforce conventions, and installing those at user
 * scope would load them when someone opens an unrelated repository.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { init } from './lib/manifest.mjs';
import { installFile, installBlock, installDir } from './lib/install.mjs';
import { MARKER } from './lib/shell.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const USER_SRC = join(PLUGIN_ROOT, 'assets', 'rules', 'user');
const PROJ_SRC = join(PLUGIN_ROOT, 'assets', 'rules', 'project');
const BLOCK_SRC = join(PLUGIN_ROOT, 'assets', 'claude-md', 'block.md');

const CLAUDE_DIR = join(homedir(), '.claude');
const USER_DEST = join(CLAUDE_DIR, 'rules');
const CLAUDE_MD = join(CLAUDE_DIR, 'CLAUDE.md');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

/**
 * Which repository the project rules go into.
 *
 * Falling back to whichever repository the working directory happens to sit in
 * writes someone else's files. So the fallback is reported, not silent, and
 * --repo is passed whenever the caller knows the answer.
 */
function findRepo() {
  if (repoArg >= 0 && argv[repoArg + 1]) return { path: argv[repoArg + 1], explicit: true };
  try {
    return { path: execFileSync('git', ['rev-parse', '--show-toplevel'],
             { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(), explicit: false };
  } catch { return { path: process.cwd(), explicit: false }; }
}

const mdFiles = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];

/** Does this rule load in every session, or only when a matching file is touched? */
function isScoped(file) {
  return readFileSync(file, 'utf8').split('\n').slice(0, 6).some(l => l.startsWith('paths:'));
}

function report(label, files, src, dest) {
  const always = files.filter(f => !isScoped(join(src, f))).length;
  log(`${label.padEnd(15)} ${files.length} files -> ${dest}`);
  log(`${''.padEnd(15)} ${files.length - always} load only when a matching file is touched, ${always} in every session`);
  for (const f of files) {
    log(`${''.padEnd(15)}   ${existsSync(join(dest, f)) ? 'replaces' : 'new     '}  ${f}`);
  }
}

function main() {
  const found = findRepo();
  const repo = found.path;
  const projDest = join(repo, '.claude', 'rules');
  log(`Repository      ${repo}${found.explicit ? '' : '   (worked out from the working directory)'}`);
  const userFiles = mdFiles(USER_SRC);
  const projFiles = mdFiles(PROJ_SRC);

  if (!userFiles.length && !projFiles.length) {
    console.error(`Cannot find the rules that ship with this plugin: ${USER_SRC}`);
    process.exit(1);
  }

  report('Writing rules', userFiles, USER_SRC, USER_DEST);
  log('');
  report('Project rules', projFiles, PROJ_SRC, projDest);
  log('');
  log(`Block           into ${CLAUDE_MD}${existsSync(CLAUDE_MD) ? '' : '  (will be created)'}`);
  log('');

  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init('0.1.0');

  installDir(USER_DEST);
  for (const f of userFiles) installFile(join(USER_SRC, f), join(USER_DEST, f));
  log(`Installed ${userFiles.length} writing rules for every repository`);

  installDir(projDest);
  for (const f of projFiles) installFile(join(PROJ_SRC, f), join(projDest, f));
  log(`Installed ${projFiles.length} Salesforce rules into this repository`);

  if (existsSync(BLOCK_SRC)) {
    const body = readFileSync(BLOCK_SRC, 'utf8').trimEnd();
    const r = installBlock(CLAUDE_MD, MARKER, body, 'html');
    log(r.existed ? `Added the block to ${CLAUDE_MD}, leaving your own content alone`
                  : `Created ${CLAUDE_MD} with the block`);
  }
  log('');
  log('These apply from your next session.');
}

main();
