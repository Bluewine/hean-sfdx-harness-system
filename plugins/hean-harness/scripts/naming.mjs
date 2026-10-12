#!/usr/bin/env node
/**
 * The repository's Apex and LWC naming answer.
 *
 *   naming.mjs status                                    exit 0 both answered, 2 not, 1 not an SFDX project
 *   naming.mjs suggest                                   the answer the existing names suggest
 *   naming.mjs set apex|lwc --use yes|no [--prefix X] [--suffix Y]
 *   naming.mjs expect apex|lwc <name>                    exit 0 match, 3 mismatch
 */

import { projectRoot } from './lib/org-roles.mjs';
import { TYPES, readNaming, saveNaming, matchName, suggest, describe } from './lib/naming.mjs';

const argv = process.argv.slice(2);
const fail = reason => { console.log(`ERROR: ${reason}`); process.exit(1); };

const root = projectRoot(process.cwd());
if (!root) fail('run this from inside an SFDX project (no sfdx-project.json found)');

const cmd = argv[0];
if (cmd === 'status') {
  const n = readNaming(root);
  for (const t of TYPES) console.log(describe(t, n[t]));
  process.exit(TYPES.every(t => n[t]) ? 0 : 2);
}

if (cmd === 'suggest') {
  const s = suggest(root);
  const unit = { apex: 'classes', lwc: 'components' };
  for (const t of TYPES) {
    const { total, prefix, suffix } = s[t];
    if (!prefix && !suffix) { console.log(`SUGGEST ${t} none (${total} ${unit[t]})`); continue; }
    const tokens = [prefix && `prefix=${prefix.token}`, suffix && `suffix=${suffix.token}`].filter(Boolean).join(' ');
    console.log(`SUGGEST ${t} ${tokens} (prefix on ${prefix?.count ?? 0} of ${total} ${unit[t]}, suffix on ${suffix?.count ?? 0} of ${total})`);
  }
  process.exit(0);
}

if (cmd === 'set') {
  const type = argv[1];
  if (!TYPES.includes(type)) fail('usage: naming.mjs set apex|lwc --use yes|no [--prefix X] [--suffix Y]');
  const flags = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const m = rest[i].match(/^--(use|prefix|suffix)(?:=(.*))?$/s);
    if (!m) fail(`unexpected argument ${rest[i]}`);
    let value = m[2];
    if (value === undefined) {
      value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${m[1]} needs exactly one value`);
      i++;
    }
    if (m[1] in flags) fail(`--${m[1]} needs exactly one value`);
    flags[m[1]] = value;
  }
  const use = flags.use;
  if (!['yes', 'no'].includes(use)) fail('--use takes yes or no');
  const answer = use === 'yes' ? { use: true, prefix: flags.prefix ?? '', suffix: flags.suffix ?? '' } : { use: false };
  try { saveNaming(root, type, answer); } catch (e) { fail(e.message); }
  console.log(`Saved  ${describe(type, readNaming(root)[type])}`);
  process.exit(0);
}

if (cmd === 'expect') {
  const [, type, name] = argv;
  if (!TYPES.includes(type) || !name) fail('usage: naming.mjs expect apex|lwc <name>');
  const m = matchName(type, readNaming(root)[type], name);
  if (m.ok) { console.log('OK'); process.exit(0); }
  console.log(`MISMATCH ${m.reason}; expected ${m.expected}`);
  process.exit(3);
}

fail('usage: naming.mjs status | suggest | set apex|lwc --use yes|no [--prefix X] [--suffix Y] | expect apex|lwc <name>');
