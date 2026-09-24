#!/usr/bin/env node
/**
 * Reports on the things this environment needs, and installs what can
 * be installed without asking for administrator rights.
 *
 * Only plugins are installed here: superpowers, and the ego-browser skill unless
 * ego lite's onboarding already wrote it. Java, the sf CLI, the code analyzer,
 * python and the ego lite browser each need administrator rights, a download
 * or a choice about versions, so those are reported with the command or link
 * that fixes them and left to the reader.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { init } from './lib/manifest.mjs';
import { recordExternal, installRepoMcpFile } from './lib/install.mjs';
import { allChecks, reportChecks, checkSuperpowers, checkEgoSkills, checkEgoLite, currentRepo,
         present, run, marketplacePresent, egoBrowserFromSkillsTool,
         SUPERPOWERS_PLUGIN, EGO_PLUGIN, EGO_LITE_URL } from './lib/environment.mjs';
import { findLinear, addLinear, removeCommand, LINEAR_NAME } from './lib/mcp.mjs';

const argv = process.argv.slice(2);
const doInstall = argv.includes('--install');
const editMcp = argv.includes('--edit-mcp');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

/**
 * Put a plugin in place.
 *
 * Two commands, because a plugin cannot be installed before the marketplace
 * carrying it has been added, and a fresh Claude Code configuration has none.
 * Each command is safe to repeat: the marketplace reports it is already on
 * disk, and the install reports the plugin is already installed.
 */
function installPlugin(p, r) {
  if (!present('claude')) {
    log(`The claude command is not on PATH, so ${p.id} cannot be installed from here.`);
    log(`Install it yourself with: claude plugin install ${p.id}`);
    return false;
  }

  init();

  if (r.state === 'disabled') {
    log(`Running: claude plugin enable ${p.id}`);
    log(run('claude', ['plugin', 'enable', p.id]).trim());
    return true;
  }

  if (!marketplacePresent(p.marketplace)) {
    log(`Running: claude plugin marketplace add ${p.source}`);
    log(run('claude', ['plugin', 'marketplace', 'add', p.source]).trim());
    // ours to undo only because it was not there before
    recordExternal(`marketplace:${p.marketplace}`,
                   `claude plugin marketplace remove ${p.marketplace}`);
  }

  log(`Running: claude plugin install ${p.id}`);
  log(run('claude', ['plugin', 'install', p.id]).trim());
  recordExternal(p.id, `claude plugin uninstall ${p.id}`);
  return true;
}

/**
 * Bring an installed plugin up to date.
 *
 * Setup is rerun after a plugin release, and without this the plugins it
 * installed would otherwise stay at the version first installed.
 */
function updatePlugin(p) {
  if (!present('claude')) {
    log(`The claude command is not on PATH, so ${p.id} cannot be updated from here.`);
    log(`Update it yourself with: claude plugin update ${p.id}`);
    return;
  }

  log(`Running: claude plugin marketplace update ${p.marketplace}`);
  log(run('claude', ['plugin', 'marketplace', 'update', p.marketplace]).trim());

  log(`Running: claude plugin update ${p.id}`);
  log(run('claude', ['plugin', 'update', p.id]).trim());
}

/**
 * Bring the `skills` command-line tool's copy of the ego-browser skill up to date.
 *
 * `claude plugin update` has nothing to do here — the `skills` tool, not a
 * plugin, put this copy in place — so `skills update` is what keeps it current.
 */
function updateEgoBrowserSkillsTool() {
  if (!present('npx')) {
    log('The npx command is not on PATH, so the ego-browser skill cannot be updated from here.');
    log('Update it yourself with: npx -y skills update ego-browser -g -y');
    return;
  }

  log('Running: npx -y skills update ego-browser -g -y');
  log(run('npx', ['-y', 'skills', 'update', 'ego-browser', '-g', '-y']).trim());
}

/** The ego lite browser is each user's own install; say where to get it when it is missing. */
function recommendEgoLite() {
  if (!checkEgoLite().recommend) return;
  log('Recommended: install the ego lite browser yourself from ' + EGO_LITE_URL);
  log('The ego-browser skill drives it for browser tasks. ego lite is free and macOS only.');
  log('');
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

  init();
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
  const ego = checkEgoSkills();

  if (!doInstall) {
    const pending = [];
    if (!sp.ok) pending.push('the superpowers plugin');
    if (!ego.ok) pending.push('the ego-browser skill');
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
    const updating = [];
    if (sp.ok) updating.push('the superpowers plugin');
    if (ego.ok && (!ego.onboarding || egoBrowserFromSkillsTool())) updating.push('the ego-browser skill');
    if (updating.length) {
      const list = updating.length > 1 ? `${updating.slice(0, -1).join(', ')} and ${updating.at(-1)}` : updating[0];
      log(`Setup updates ${list} when it runs for real.`);
      log('');
    }
    recommendEgoLite();
    log(missing === 0
      ? 'Everything needed is in place.'
      : `${missing} thing${missing > 1 ? 's need' : ' needs'} attention. Re-run with --install to install what can be installed automatically.`);
    return;
  }

  if (repo) { init(); installRepoMcpFile(repo); }

  const restartForUpdate = label =>
    log(`${label} loads at the start of a session, so restart Claude Code for the update to take effect.`);

  for (const [p, r, label] of [[SUPERPOWERS_PLUGIN, sp, 'Superpowers'], [EGO_PLUGIN, ego, 'The ego-browser skill']]) {
    if (r.ok) {
      if (r.onboarding) {
        if (egoBrowserFromSkillsTool()) {
          updateEgoBrowserSkillsTool();
          restartForUpdate(label);
        } else {
          // ego lite's own onboarding copy, not a plugin or the skills tool — left alone
          log(`${label} was not installed by a plugin or the skills tool, so setup does not update it.`);
        }
        log('');
        continue;
      }
      updatePlugin(p);
      restartForUpdate(label);
      log('');
      continue;
    }
    if (installPlugin(p, r)) {
      log('Recorded, so uninstall will tell you how to undo it.');
      // the plugin's own skills and hooks are read when a session starts, so
      // this session does not have them however well the install went
      log(`${label} loads at the start of a session, so restart Claude Code before using it.`);
    }
    log('');
  }

  recommendEgoLite();

  if (installLinear(repo)) {
    log('Recorded, so uninstall will tell you how to undo it.');
    log('It is declared but not yet authenticated. Run /mcp in a session and sign in to Linear.');
    log('');
  }

  const manual = checks.filter(c => !c.result.ok && !c.result.skipped
                                    && c.name !== 'superpowers' && c.name !== 'ego skills'
                                    && c.name !== 'Linear'
                                    && c.name !== 'node modules');
  if (manual.length) {
    log('These are not installed automatically, because they need administrator rights or');
    log('depend on your setup. Run them yourself:');
    for (const c of manual) log(`  ${c.fix}`);
  }
}

main();
