/**
 * The repository's naming answer for Apex classes and Lightning Web Components:
 * whether a prefix or suffix is used, and which. Saved under `naming` in the
 * main checkout's .claude/hean-harness.json, so every worktree shares it.
 *
 * The two naming rules point the agent to this answer, and the naming-check
 * hook refuses a new class or component whose name does not match it.
 *
 * Validation is this plugin's conservative rule. Salesforce limits an Apex
 * class name to 40 characters and documents LWC folder names (begins
 * lowercase; letters, digits, underscore; no hyphen, no "__", no trailing "_");
 * no Salesforce page states the Apex identifier characters.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSettings, writeSetting, settingsFile } from './settings.mjs';
import { packageDirectories } from './apex-coverage.mjs';

export const TYPES = ['apex', 'lwc'];
const LABEL = { apex: 'Apex', lwc: 'LWC' };
const SHARE = 0.6;
const MIN_COUNT = 3;
const MAX_APEX_TOKENS = 20;

/** The saved answers by type, or {} when none are saved or the file is unreadable. */
export function readNaming(repo) {
  const n = readSettings(repo).naming;
  return n && typeof n === 'object' && !Array.isArray(n) ? n : {};
}

/** Why this answer cannot be saved, or null when it can. */
export function validate(type, answer) {
  if (!TYPES.includes(type)) return `the type must be apex or lwc, not "${type}"`;
  if (!answer || typeof answer.use !== 'boolean') return 'the answer needs use: true or false';
  if (!answer.use) return null;
  const prefix = answer.prefix ?? '';
  const suffix = answer.suffix ?? '';
  if (!prefix && !suffix) return 'a prefix or a suffix is needed when use is yes';
  if (type === 'apex') {
    if (prefix && (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix) || prefix.includes('__'))) {
      return `the Apex prefix "${prefix}" must start with a letter and use only letters, digits and single underscores`;
    }
    if (suffix && (!/^[A-Za-z0-9_]+$/.test(suffix) || suffix.includes('__') || suffix.endsWith('_'))) {
      return `the Apex suffix "${suffix}" must use only letters, digits and single underscores, and not end with "_"`;
    }
    if (prefix.length + suffix.length > MAX_APEX_TOKENS) {
      return `the Apex prefix and suffix together are ${prefix.length + suffix.length} characters; keep them to ${MAX_APEX_TOKENS} so class names stay under the 40-character limit`;
    }
    if (suffix.endsWith('Test')) return `the suffix "${suffix}" must not end with "Test"; a test name ends in Test after the suffix`;
    return null;
  }
  if (suffix.endsWith('Test')) return `the suffix "${suffix}" must not end with "Test"; a test name ends in Test after the suffix`;
  if (prefix && !/^[a-z][a-z0-9]*$/.test(prefix)) {
    return `the LWC prefix "${prefix}" must start with a lowercase letter and use only lowercase letters and digits`;
  }
  if (suffix && !/^[A-Z0-9][A-Za-z0-9]*$/.test(suffix)) {
    return `the LWC suffix "${suffix}" must start with an uppercase letter or a digit and use only letters and digits`;
  }
  return null;
}

/** Saves one type's answer; throws when it is not valid. */
export function saveNaming(repo, type, answer) {
  const reason = validate(type, answer);
  if (reason) throw new Error(reason);
  const file = settingsFile(repo);
  if (existsSync(file)) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`the settings file ${file} cannot be read as JSON; fix or remove it first, nothing was saved`);
    }
  }
  const clean = answer.use ? { use: true, prefix: answer.prefix ?? '', suffix: answer.suffix ?? '' } : { use: false };
  writeSetting(repo, 'naming', { ...readNaming(repo), [type]: clean });
}

/**
 * Whether a name matches the answer. The name may end in one `Test`; the
 * suffix comes before it. Case is exact.
 */
export function matchName(type, answer, name) {
  if (!answer?.use) return { ok: true };
  const prefix = answer.prefix ?? '';
  const suffix = answer.suffix ?? '';
  const isTest = name.endsWith('Test') && name.length > 4;
  const core = isTest ? name.slice(0, -4) : name;
  if (suffix && !isTest && core.endsWith(`Test${suffix}`)) {
    const moved = `${core.slice(0, -(suffix.length + 4))}${suffix}Test`;
    return { ok: false, reason: `${name} puts Test before the suffix; Test must come after the suffix`, expected: matchName(type, answer, moved).expected ?? moved };
  }
  const missing = [];
  if (prefix && !core.startsWith(prefix)) missing.push(`does not start with the prefix ${prefix}`);
  if (suffix && !core.endsWith(suffix)) missing.push(`does not end with the suffix ${suffix}${isTest ? ' before Test' : ''}`);
  if (type === 'lwc' && !prefix && /^[A-Z]/.test(core)) missing.push('must start with a lowercase letter');
  if (!missing.length) return { ok: true };
  let middle = core.replace(/_$/, '');
  const lower = middle.toLowerCase();
  for (const p of [prefix, prefix.replace(/_$/, '')]) {
    if (!p || !lower.startsWith(p.toLowerCase())) continue;
    const next = middle.charAt(p.length);
    // A prefix with no trailing "_" is stripped only at a word boundary, so "Abbey" is not cut after "Ab".
    if (!p.endsWith('_') && next && next !== '_' && next === next.toLowerCase()) continue;
    middle = middle.slice(p.length);
    break;
  }
  const lowerEnd = middle.toLowerCase();
  for (const q of [suffix, suffix.replace(/^_/, '')]) {
    if (q && lowerEnd.endsWith(q.toLowerCase())) { middle = middle.slice(0, -q.length); break; }
  }
  if (type === 'lwc' && prefix) middle = middle.charAt(0).toUpperCase() + middle.slice(1);
  if (type === 'lwc' && !prefix) middle = middle.charAt(0).toLowerCase() + middle.slice(1);
  const expected = `${prefix}${middle}${suffix}${isTest ? 'Test' : ''}`;
  return { ok: false, reason: `${name} ${missing.join(' and ')}`, expected };
}

/** Every name of one kind under the repository's package folders. */
function names(repoRoot) {
  const apex = [];
  const lwc = [];
  const walk = (dir, inClasses) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'lwc') {
          let comps = [];
          try { comps = readdirSync(p, { withFileTypes: true }); } catch { /* unreadable folder: skip */ }
          for (const c of comps) if (c.isDirectory() && !c.name.startsWith('_')) lwc.push(c.name);
          continue;
        }
        walk(p, inClasses || e.name === 'classes');
      } else if (e.name.endsWith('.cls') && inClasses) {
        apex.push(e.name.slice(0, -4));
      }
    }
  };
  for (const pkg of packageDirectories(repoRoot)) walk(join(repoRoot, pkg), false);
  return { apex, lwc };
}

/** The most common token and how many names carry it, or null below the share or below 3 names. */
function top(tokens, total) {
  const counts = new Map();
  for (const t of tokens) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = null;
  for (const [token, count] of counts) if (!best || count > best.count) best = { token, count };
  return best && total && best.count >= MIN_COUNT && best.count / total >= SHARE ? best : null;
}

const withoutTest = n => (n.endsWith('Test') && n.length > 4 ? n.slice(0, -4) : n);

/** The answer the repository's existing names suggest, per type. */
export function suggest(repoRoot) {
  const { apex, lwc } = names(repoRoot);
  const apexSuffix = n => {
    const core = withoutTest(n);
    const last = core.lastIndexOf('_');
    return last >= 0 ? core.slice(last) : null;
  };
  const lwcPrefix = n => n.match(/^[a-z][a-z0-9]*(?=[A-Z])/)?.[0] ?? null;
  const lwcSuffix = n => {
    const core = withoutTest(n);
    if (!lwcPrefix(core)) return null;
    const run = core.match(/[A-Z0-9]+$/)?.[0];
    if (run && run.length >= 2 && /[A-Z]/.test(run)) return run;
    return core.match(/[A-Z0-9][a-z0-9]*$/)?.[0] ?? null;
  };
  // A suggested token reaches shell commands in the skills, so one that fails validation is dropped.
  const valid = (type, key, best) => (best && validate(type, { use: true, [key]: best.token }) === null ? best : null);
  return {
    apex: {
      total: apex.length,
      prefix: valid('apex', 'prefix', top(apex.map(n => n.match(/^[A-Za-z][A-Za-z0-9]*_/)?.[0] ?? null), apex.length)),
      suffix: valid('apex', 'suffix', top(apex.map(apexSuffix), apex.length))
    },
    lwc: {
      total: lwc.length,
      prefix: valid('lwc', 'prefix', top(lwc.map(lwcPrefix), lwc.length)),
      suffix: valid('lwc', 'suffix', top(lwc.map(lwcSuffix), lwc.length))
    }
  };
}

/** One line for reports: "Apex: prefix ABC_, suffix _UK". */
export function describe(type, answer) {
  if (!answer) return `${LABEL[type]}: not chosen`;
  if (!answer.use) return `${LABEL[type]}: no prefix or suffix`;
  const parts = [];
  if (answer.prefix) parts.push(`prefix ${answer.prefix}`);
  if (answer.suffix) parts.push(`suffix ${answer.suffix}`);
  return `${LABEL[type]}: ${parts.join(', ')}`;
}
