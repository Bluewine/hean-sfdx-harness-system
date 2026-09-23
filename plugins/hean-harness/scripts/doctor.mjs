#!/usr/bin/env node
/**
 * Reports what is installed and what no longer matches.
 *
 * Three kinds of problem are worth telling apart:
 *   missing   recorded as installed, but the file is not there any more
 *   changed   the file is there but differs from the copy this plugin ships
 *   absent    a managed block was recorded but is no longer in the file
 *
 * "changed" is not always a fault. Someone may have edited a rule on purpose.
 * The report says what differs and lets the reader decide.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { load, MANIFEST, markers } from './lib/manifest.mjs';
import { allChecks, reportChecks, currentRepo } from './lib/environment.mjs';
import { claudeCommand } from './lib/shell.mjs';
import { repoRoot, missingLines, IGNORE_LINES } from './lib/gitignore.mjs';
import { STATE_DIR } from './lib/manifest.mjs';
import { getGitConfig } from './lib/install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const log = (...a) => console.log(...a);
const short = p => p.replace(homedir(), '~');
const sum = f => createHash('sha1').update(readFileSync(f)).digest('hex');

/** The file inside this plugin that an installed copy came from. */
function shippedCopy(change) {
  if (!change.source) return null;
  const p = join(PLUGIN_ROOT, change.source);
  return existsSync(p) ? p : null;
}

function checkChange(c) {
  switch (c.type) {
    case 'file-copy': {
      if (!existsSync(c.target)) return { state: 'missing', note: 'recorded as installed, but not there' };
      const src = shippedCopy(c);
      if (src && sum(src) !== sum(c.target)) return { state: 'changed', note: 'differs from the copy this plugin ships' };
      return { state: 'ok' };
    }
    case 'marker-block': {
      if (!existsSync(c.target)) return { state: 'missing', note: 'the file it was added to is gone' };
      const { open } = markers(c.marker, c.style);
      return readFileSync(c.target, 'utf8').includes(open)
        ? { state: 'ok' }
        : { state: 'absent', note: 'the block was removed from this file' };
    }
    case 'json-key': {
      if (!existsSync(c.target)) return { state: 'missing', note: 'the JSON file it was written to is gone' };
      return { state: 'ok' };
    }
    case 'dir-create':
      return existsSync(c.target) ? { state: 'ok' } : { state: 'missing', note: 'the folder is gone' };
    case 'git-config': {
      if (!existsSync(c.target)) return { state: 'missing', note: 'the repository is gone' };
      const now = getGitConfig(c.target, c.key);
      return now === c.value ? { state: 'ok' }
        : { state: 'changed', note: `${c.key} is ${now ?? 'unset'}, setup set ${c.value}` };
    }
    case 'external':
      return { state: 'external', note: c.undoHint };
    default:
      return { state: 'ok' };
  }
}

function main() {
  const m = load();
  const installed = existsSync(MANIFEST);
  let aliasState = null;

  log('hean-harness doctor');
  log('');
  log('Installation');
  if (!installed) {
    log('  not installed — no record of setup having run on this machine');
    log(`  run the setup skill to install it`);
    log('');
  } else {
    log(`  version       ${m.version ?? 'unknown'}`);
    log(`  installed     ${m.installedAt ? m.installedAt.slice(0, 10) : 'unknown'}`);
    log(`  record        ${short(MANIFEST)}`);
    log(`  changes       ${m.changes.length}`);
    log('');

    const tally = {};
    const problems = [];
    for (const c of m.changes) {
      const r = checkChange(c);
      tally[r.state] = (tally[r.state] ?? 0) + 1;
      if (r.state !== 'ok') problems.push({ c, r });
      // the alias lives in a managed block in a shell startup file
      if (c.type === 'marker-block' && /\.(zshrc|bashrc|bash_profile|profile)$/.test(c.target)) {
        aliasState = r.state;
      }
    }

    log('Installed items');
    for (const [state, n] of Object.entries(tally).sort()) log(`  ${String(n).padStart(4)}  ${state}`);
    if (problems.length) {
      log('');
      log('Needing attention');
      for (const { c, r } of problems.slice(0, 20)) {
        log(`  ${r.state.padEnd(9)} ${short(c.target)}`);
        log(`  ${''.padEnd(9)} ${r.note}`);
      }
      if (problems.length > 20) log(`  ... and ${problems.length - 20} more`);
    }
    log('');
  }

  // files setup writes on each clone must stay out of git
  const repo = currentRepo() ?? repoRoot();
  const gi = missingLines(repo);
  log('Ignored paths');
  for (const l of IGNORE_LINES) {
    log(`  ${gi.missing.includes(l) ? 'not there' : 'present  '}  ${l}`);
  }
  log(`  ${short(gi.file)}`);
  if (gi.missing.length) {
    log('  A file written on each clone would be committed. Run the setup skill again to add the missing lines.');
  }
  log('');

  log('Environment');
  const envBad = reportChecks(allChecks(currentRepo()), log);
  log('');

  log('Summary');
  if (!installed) log('  Not installed.');
  else log(`  ${m.changes.length} changes recorded.`);
  log(envBad === 0 ? '  Everything the environment needs is in place.'
                   : `  ${envBad} environment item${envBad > 1 ? "s" : ""} need${envBad > 1 ? "" : "s"} attention.`);

  // Without the alias, typing "claude" starts a session with no rules loaded,
  // so give the command that works without it rather than only naming the fault.
  if (installed && aliasState !== 'ok') {
    log('');
    log(aliasState === null
      ? '  No alias was installed, so plain "claude" starts without the rules.'
      : '  The alias is no longer in your shell startup file, so plain "claude" starts without the rules.');
    log('  Start Claude Code with this instead, or run setup again to put the alias back:');
    log('');
    log(`    ${claudeCommand(join(STATE_DIR, 'global-system-prompt.txt'))}`);
  }
}

main();
