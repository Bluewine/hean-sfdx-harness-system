#!/usr/bin/env node
/**
 * Setup step: the repository's Apex and LWC naming answer.
 *
 * With --naming-apex / --naming-lwc (use=no, or use=yes,prefix=X,suffix=Y) it
 * saves the answer. A saved answer is reused. When a type has no answer, it
 * prints "!! ASK — NAMING NOT CHOSEN" with the suggestion the existing names
 * give, so the setup skill can ask.
 */

import { projectRoot } from './lib/org-roles.mjs';
import { TYPES, readNaming, saveNaming, validate, describe, suggest } from './lib/naming.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = argv.indexOf('--repo');
const log = (...a) => console.log(...a);

function parseSpec(spec) {
  const fields = Object.fromEntries(String(spec).split(',').map(p => p.split('=')).map(([k, v = '']) => [k.trim(), v.trim()]));
  const unknown = Object.keys(fields).filter(k => !['use', 'prefix', 'suffix'].includes(k));
  if (unknown.length) throw new Error(`unknown key ${unknown.map(k => `"${k}"`).join(', ')} in "${spec}"; use only use, prefix, suffix`);
  if (!['yes', 'no'].includes(fields.use)) throw new Error(`use must be yes or no in "${spec}"`);
  return fields.use === 'yes' ? { use: true, prefix: fields.prefix ?? '', suffix: fields.suffix ?? '' } : { use: false };
}

function main() {
  const start = repoArg >= 0 ? argv[repoArg + 1] : process.cwd();
  const repo = projectRoot(start);
  if (!repo) { log('Not an SFDX project; no naming answer to save.'); return; }

  for (const type of TYPES) {
    const i = argv.indexOf(`--naming-${type}`);
    if (i < 0) continue;
    let answer;
    try { answer = parseSpec(argv[i + 1]); } catch (e) { log(`ERROR: ${e.message}`); process.exit(1); }
    const reason = validate(type, answer);
    if (reason) { log(`ERROR: ${reason}`); process.exit(1); }
    if (dryRun) { log(`Would save  ${describe(type, answer)}`); continue; }
    try { saveNaming(repo, type, answer); } catch (e) { log(`ERROR: ${e.message}`); process.exit(1); }
    log(`Saved  ${describe(type, answer)}`);
  }

  const saved = readNaming(repo);
  const missing = TYPES.filter(t => !saved[t]);
  for (const t of TYPES) if (saved[t]) log(describe(t, saved[t]));
  if (!missing.length) return;
  const s = suggest(repo);
  log('!! ASK — NAMING NOT CHOSEN for this repository.');
  for (const t of missing) {
    const { prefix, suffix, total } = s[t];
    const tokens = [prefix && `prefix=${prefix.token}`, suffix && `suffix=${suffix.token}`].filter(Boolean).join(',');
    log(`!! ${t}: suggested ${tokens ? `use=yes,${tokens}` : 'use=no'} (from ${total} existing names). ` +
        `Run setup with --naming-${t} use=no or --naming-${t} use=yes,prefix=X,suffix=Y.`);
  }
}

main();
