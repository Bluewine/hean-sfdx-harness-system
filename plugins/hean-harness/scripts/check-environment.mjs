#!/usr/bin/env node
/**
 * Reports on the things this environment needs, and installs the one that can
 * be installed without asking for administrator rights.
 *
 * Only superpowers is installed here. Java, the sf CLI, the code analyzer and
 * python each need administrator rights or a choice about versions, so those
 * are reported with the command that fixes them and left to the reader.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { recordExternal, installRepoMcpFile } from './lib/install.mjs';
import { allChecks, reportChecks, checkSuperpowers, currentRepo,
         present, run, marketplacePresent,
         SUPERPOWERS, SUPERPOWERS_MARKETPLACE, SUPERPOWERS_SOURCE } from './lib/environment.mjs';
import { findLinear, addLinear, removeCommand, LINEAR_NAME } from './lib/mcp.mjs';

const argv = process.argv.slice(2);
const doInstall = argv.includes('--install');
const editMcp = argv.includes('--edit-mcp');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

/**
 * Put superpowers in place.
 *
 * Two commands, because a plugin cannot be installed before the marketplace
 * carrying it has been added, and a fresh Claude Code configuration has none.
 * Each command is safe to repeat: the marketplace reports it is already on
 * disk, and the install reports the plugin is already installed.
 */
function installSuperpowers(sp) {
  if (!present('claude')) {
    log('The claude command is not on PATH, so superpowers cannot be installed from here.');
    log(`Install it yourself with: claude plugin install ${SUPERPOWERS}`);
    return false;
  }

  init('0.1.0');

  if (sp.state === 'disabled') {
    log(`Running: claude plugin enable ${SUPERPOWERS}`);
    log(run('claude', ['plugin', 'enable', SUPERPOWERS]).trim());
    return true;
  }

  if (!marketplacePresent()) {
    log(`Running: claude plugin marketplace add ${SUPERPOWERS_SOURCE}`);
    log(run('claude', ['plugin', 'marketplace', 'add', SUPERPOWERS_SOURCE]).trim());
    // ours to undo only because it was not there before
    recordExternal(`marketplace:${SUPERPOWERS_MARKETPLACE}`,
                   `claude plugin marketplace remove ${SUPERPOWERS_MARKETPLACE}`);
  }

  log(`Running: claude plugin install ${SUPERPOWERS}`);
  log(run('claude', ['plugin', 'install', SUPERPOWERS]).trim());
  recordExternal(SUPERPOWERS, `claude plugin uninstall ${SUPERPOWERS}`);
  return true;
}

/**
 * Point this repository at Linear, but only when nothing already does.
 *
 * The check is what makes this safe to run again: `claude mcp add` fails
 * outright on a name that is already there, and a second server at the same URL
 * would have to be authenticated separately from the first.
 */
function installLinear(repo) {
  if (!repo) {
    log('Not in a repository, so there is nowhere to add a Linear server.');
    return false;
  }
  if (!present('claude')) {
    log('The claude command is not on PATH, so the Linear server cannot be added from here.');
    return false;
  }

  const existing = findLinear(repo);
  if (existing.length) {
    log(`Linear is already reachable through ${existing[0].name}, in ${existing[0].where}.`);
    log('Left as it is — a second server at the same address would need authenticating on its own.');
    return false;
  }
  if (mcpKept(repo)) { keptNotice(repo); return false; }

  init('0.1.0');
  log(`Running: claude mcp add --transport http --scope project ${LINEAR_NAME} ...`);
  const r = addLinear(repo);
  log(r.output);
  if (!r.ok) return false;

  // written into the repository's own .mcp.json, which may already declare other
  // servers, so uninstall names the one key rather than the file
  recordExternal(`mcp:${LINEAR_NAME}`, removeCommand);
  return true;
}

/** An existing .mcp.json is the repository's, and is edited only when asked. */
const mcpKept = repo => !editMcp && existsSync(join(repo, '.mcp.json'));

function keptNotice(repo) {
  log('');
  log('!! KEPT — NOT CHANGED: ' + join(repo, '.mcp.json'));
  log('!! The file is already there, so the Linear server was not added to it.');
  log('!! To add it, run setup again with --edit-mcp.');
  log('');
}

function main() {
  const repo = repoArg >= 0 ? argv[repoArg + 1] : currentRepo();
  const checks = allChecks(repo);
  log('Environment');
  const missing = reportChecks(checks, log);
  log('');

  const sp = checkSuperpowers();

  if (!doInstall) {
    const pending = [];
    if (!sp.ok) pending.push('the superpowers plugin');
    if (!checks.find(c => c.name === 'Linear').result.ok) {
      if (repo && mcpKept(repo)) keptNotice(repo);
      else pending.push('a Linear MCP server');
    }
    const nm = checks.find(c => c.name === 'node modules').result;
    if (!nm.ok && !nm.skipped) pending.push('the npm packages');
    if (pending.length) {
      const list = pending.length > 1 ? `${pending.slice(0, -1).join(', ')} and ${pending.at(-1)}` : pending[0];
      log(`Setup installs ${list} when it runs for real.`);
      log('');
    }
    log(missing === 0
      ? 'Everything needed is in place.'
      : `${missing} thing${missing > 1 ? 's need' : ' needs'} attention. Re-run with --install to install what can be installed automatically.`);
    return;
  }

  if (repo) { init('0.1.0'); installRepoMcpFile(repo); }

  if (!sp.ok) {
    if (installSuperpowers(sp)) {
      log('Recorded, so uninstall will tell you how to undo it.');
      // the plugin's own skills and hooks are read when a session starts, so
      // this session does not have them however well the install went
      log('Superpowers loads at the start of a session, so restart Claude Code before using it.');
    }
    log('');
  }

  if (installLinear(repo)) {
    log('Recorded, so uninstall will tell you how to undo it.');
    log('It is declared but not yet authenticated. Run /mcp in a session and sign in to Linear.');
    log('');
  }

  const manual = checks.filter(c => !c.result.ok && !c.result.skipped
                                    && c.name !== 'superpowers' && c.name !== 'Linear'
                                    && c.name !== 'node modules');
  if (manual.length) {
    log('These are not installed automatically, because they need administrator rights or');
    log('depend on your setup. Run them yourself:');
    for (const c of manual) log(`  ${c.fix}`);
  }
}

main();
