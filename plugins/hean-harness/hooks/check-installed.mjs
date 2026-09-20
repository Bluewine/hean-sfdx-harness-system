#!/usr/bin/env node
/**
 * Says something at the start of a session when this environment is not set
 * up, or when the alias that loads the rules has gone.
 *
 * Reads only. A hook that wrote to a shell startup file would append to it
 * on every session, so this one reports and the user decides.
 *
 * Never fails a session: any error is swallowed and it exits 0.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  const { load, MANIFEST, STATE_DIR, markers } = await import('../scripts/lib/manifest.mjs');
  const { claudeCommand } = await import('../scripts/lib/shell.mjs');

  if (!existsSync(MANIFEST)) {
    console.log('The hean-harness environment is not set up on this machine, so its rules, agents,');
    console.log('skills and memories are not loaded. Run /hean-harness:setup to install them.');
    process.exit(0);
  }

  // Is the alias still in the startup file it was written to?
  const m = load();
  const alias = m.changes.find(c =>
    c.type === 'marker-block' && /\.(zshrc|bashrc|bash_profile|profile)$/.test(c.target));

  let missing = false;
  if (!alias) {
    missing = true;   // setup ran but never managed to write an alias
  } else if (existsSync(alias.target)) {
    const { open } = markers(alias.marker, alias.style);
    missing = !readFileSync(alias.target, 'utf8').includes(open);
  } else {
    missing = true;
  }

  if (missing) {
    console.log('The hean-harness rules are installed but no alias is loading them, so a plain');
    console.log('"claude" starts without them. Start Claude Code with this instead:');
    console.log('');
    console.log(`  ${claudeCommand(join(STATE_DIR, 'global-system-prompt.txt'))}`);
    console.log('');
    console.log('Or run /hean-harness:setup again to put the alias back.');
  }
} catch {
  // never let this stop a session
}
process.exit(0);
