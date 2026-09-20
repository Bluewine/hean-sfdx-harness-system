#!/usr/bin/env node
/**
 * Reports on the things this environment needs, and installs the one that can
 * be installed without asking for administrator rights.
 */

import { init } from './lib/manifest.mjs';
import { recordExternal } from './lib/install.mjs';
import { allChecks, reportChecks, checkSuperpowers, currentRepo,
         present, run, SUPERPOWERS, javaFix, pythonFix } from './lib/environment.mjs';

const doInstall = process.argv.includes('--install');
const log = (...a) => console.log(...a);

function main() {
  const checks = allChecks(currentRepo());
  console.log('Environment');
  const missing = reportChecks(checks, log);
  log('');

  if (!doInstall) {
    log(missing === 0
      ? 'Everything needed is in place.'
      : `${missing} thing${missing > 1 ? 's need' : ' needs'} attention. Re-run with --install to install what can be installed automatically.`);
    return;
  }

  // superpowers is the only one installable without administrator rights
  const sp = checkSuperpowers();
  if (!sp.ok && present('claude')) {
    init('0.1.0');
    const verb = sp.state === 'disabled' ? 'enable' : 'install';
    log(`Running: claude plugin ${verb} ${SUPERPOWERS}`);
    log(run('claude', ['plugin', verb, SUPERPOWERS]).trim());
    recordExternal(SUPERPOWERS, `claude plugin uninstall ${SUPERPOWERS}`);
    log('Recorded, so uninstall will tell you how to undo it.');
  }

  const manual = checks.filter(c => !c.result.ok && !c.result.skipped && c.name !== 'superpowers');
  if (manual.length) {
    log('');
    log('These are not installed automatically, because they need administrator rights or');
    log('depend on your setup. Run them yourself:');
    for (const c of manual) log(`  ${c.fix}`);
  }
}

main();
