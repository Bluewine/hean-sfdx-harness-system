#!/usr/bin/env node
/**
 * Reports on the things this environment needs, and installs the one that can
 * be installed without asking for administrator rights.
 *
 * Only superpowers is installed here. Java, the sf CLI, the code analyzer and
 * python each need administrator rights or a choice about versions, so those
 * are reported with the command that fixes them and left to the reader.
 */

import { init } from './lib/manifest.mjs';
import { recordExternal } from './lib/install.mjs';
import { allChecks, reportChecks, checkSuperpowers, currentRepo,
         present, run, marketplacePresent,
         SUPERPOWERS, SUPERPOWERS_MARKETPLACE, SUPERPOWERS_SOURCE } from './lib/environment.mjs';

const doInstall = process.argv.includes('--install');
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

function main() {
  const checks = allChecks(currentRepo());
  log('Environment');
  const missing = reportChecks(checks, log);
  log('');

  const sp = checkSuperpowers();

  if (!doInstall) {
    if (!sp.ok) {
      log('Superpowers is installed automatically when setup runs for real.');
      log('');
    }
    log(missing === 0
      ? 'Everything needed is in place.'
      : `${missing} thing${missing > 1 ? 's need' : ' needs'} attention. Re-run with --install to install what can be installed automatically.`);
    return;
  }

  let installed = false;
  if (!sp.ok) {
    installed = installSuperpowers(sp);
    if (installed) {
      log('Recorded, so uninstall will tell you how to undo it.');
      // the plugin's own skills and hooks are read when a session starts, so
      // this session does not have them however well the install went
      log('Superpowers loads at the start of a session, so restart Claude Code before using it.');
    }
    log('');
  }

  const manual = checks.filter(c => !c.result.ok && !c.result.skipped && c.name !== 'superpowers');
  if (manual.length) {
    log('These are not installed automatically, because they need administrator rights or');
    log('depend on your setup. Run them yourself:');
    for (const c of manual) log(`  ${c.fix}`);
  }
}

main();
