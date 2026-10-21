#!/usr/bin/env node
/**
 * Says something at the start of a session when this environment is not set
 * up, when setup is older than the plugin, or when the claude alias has gone.
 * The alias adds only the permission bypass; the rules load through
 * ~/.claude/CLAUDE.md.
 *
 * Reads only. A hook that wrote to a shell startup file would append to it
 * on every session, so this one reports and the user decides.
 *
 * Never fails a session: any error is swallowed and it exits 0.
 */

import { readFileSync, existsSync } from 'node:fs';

try {
  const { load, MANIFEST, markers, pluginVersion } = await import('../scripts/lib/manifest.mjs');
  const { claudeCommand } = await import('../scripts/lib/shell.mjs');

  if (!existsSync(MANIFEST)) {
    console.log('The hean-harness environment is not set up on this machine, so its rules, agents,');
    console.log('skills and memories are not loaded. Run /hean-harness:setup to install them.');
    process.exit(0);
  }

  const m = load();

  // Same comparison as the doctor's "SETUP IS OUT OF DATE".
  const running = pluginVersion();
  if (running && m.version !== running) {
    console.log(`hean-harness setup was last run with ${m.version ?? 'an unknown version'}; this plugin is ${running}. Run /hean-harness:setup to install the new rules.`);
  }

  // Is the alias still in the startup file it was written to?
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
    console.log('The hean-harness alias is missing. The rules still load from ~/.claude/CLAUDE.md,');
    console.log('but a plain "claude" no longer starts with the permission bypass. Start with this instead:');
    console.log('');
    console.log(`  ${claudeCommand()}`);
    console.log('');
    console.log('Or run /hean-harness:setup again to put the alias back.');
  }

  // An older setup copied the status line script; the current one keeps it in the plugin.
  if (m.changes.some(c => c.type === 'file-copy' && /statusline-command\.mjs$/.test(c.target))) {
    console.log('The status line is an old copy that no longer updates. Run /hean-harness:setup again to replace it.');
  }
} catch {
  // never let this stop a session
}
process.exit(0);
