#!/usr/bin/env node
/**
 * Claude Code replaces `$0`, `$1`, ... in a SKILL.md with the skill's
 * arguments, so an awk field written as `$1` reaches the shell as a different
 * command. Write awk fields as `$(1)`. `${...}` is not substituted and passes.
 *
 * Reads the skill files only. Touches nothing of yours.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// <plugin>/scripts/__tests__/ -> <plugin>
const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SKILLS = join(PLUGIN, 'skills');

const offenders = [];
for (const name of readdirSync(SKILLS)) {
  const file = join(SKILLS, name, 'SKILL.md');
  if (!existsSync(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/\$\d/.test(line)) offenders.push(`skills/${name}/SKILL.md:${i + 1}  ${line.trim()}`);
  });
}

console.log(`  ${offenders.length ? 'FAIL' : 'pass'}  no SKILL.md contains $ followed by a digit`);
for (const o of offenders) console.log(`        ${o}`);
console.log(`\n  ${offenders.length ? `${offenders.length} failed` : 'all checks passed'}`);
process.exit(offenders.length ? 1 : 0);
