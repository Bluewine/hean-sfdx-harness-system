#!/usr/bin/env node
/**
 * Runs every installer, in order.
 *
 * The setup skill calls this one script rather than naming each installer,
 * so adding an installer here is enough — the skill does not need editing and
 * cannot fall out of step with what exists.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { STATE_DIR } from './lib/manifest.mjs';
import { claudeCommand } from './lib/shell.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const repo = repoArg >= 0 ? argv[repoArg + 1] : null;

/**
 * Each step, in the order it runs.
 *
 * `keepGoing` marks a step whose failure must not stop the rest. The system
 * prompt step exits 2 when the shell is one it will not write to, and the
 * rules and memories still belong on the machine in that case.
 *
 * `installsOnRealRun` marks a step that takes `--install` rather than
 * `--dry-run`. The environment step reports either way; only that flag makes it
 * put superpowers in place, and leaving it off is why superpowers was reported
 * as missing on every run and never installed.
 */
const STEPS = [
  { name: 'Environment',   script: 'check-environment.mjs',     noDryFlag: true, installsOnRealRun: true },
  { name: 'Rules and alias', script: 'install-system-prompt.mjs', keepGoing: true },
  { name: 'Rule files',    script: 'install-rules.mjs',        wantsRepo: true },
  { name: 'Memories',      script: 'install-memories.mjs',       wantsRepo: true },
  { name: 'Status line',   script: 'install-statusline.mjs' },
  { name: 'Ignored paths', script: 'init-gitignore.mjs',       wantsRepo: true }
];

const line = '─'.repeat(64);
const results = [];

for (const step of STEPS) {
  const args = [join(HERE, step.script)];
  if (dryRun && !step.noDryFlag) args.push('--dry-run');
  if (!dryRun && step.installsOnRealRun) args.push('--install');
  if (step.wantsRepo && repo) args.push('--repo', repo);

  console.log(`\n${line}\n  ${step.name}\n${line}`);
  const r = spawnSync('node', args, { stdio: 'inherit' });
  const code = r.status ?? 1;
  results.push({ name: step.name, code });

  if (code !== 0 && !step.keepGoing) {
    console.log(`\n${step.name} failed. Stopping here so nothing half-done is left behind.`);
    break;
  }
}

console.log(`\n${line}\n  Summary\n${line}`);
for (const r of results) {
  const note = r.code === 0 ? 'done'
    : r.code === 2 ? 'the alias was not written — see below'
    : `failed (exit ${r.code})`;
  console.log(`  ${r.name.padEnd(18)} ${note}`);
}

if (dryRun) {
  console.log('\nDry run. Nothing was changed.');
} else if (results.some(r => r.code === 2)) {
  // The alias could not be written, so "claude" on its own will not load the
  // rules. Repeat the command to type instead, rather than leaving it buried
  // further up the output.
  console.log('\nEverything else is installed. The alias is the only part missing, so');
  console.log('start Claude Code with this command instead of plain "claude":');
  console.log('');
  console.log(`  ${claudeCommand(join(STATE_DIR, 'global-system-prompt.txt'))}`);
  console.log('');
  console.log('The step above also shows the line to add if you would rather set it up once.');
} else {
  console.log('\nReload your shell with the command shown above, or open a new terminal.');
}
