#!/usr/bin/env node
/**
 * The project's own choices, kept in the repository but never committed.
 *
 *   <repo>/.claude/hean-harness.local.json
 *
 * Every setting is optional. A setting that is absent means the team did not
 * choose one, and nothing downstream asks for it or enforces it. Silence is a
 * valid answer, so "not configured" and "configured as empty" must stay
 * distinguishable — hence null rather than "".
 *
 * Local and untracked on purpose: one developer's choice of prefix is not a
 * change to the repository, and committing it would force it on everyone.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync,
         readdirSync, rmSync, rmdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const FILENAME = 'hean-harness.local.json';

/**
 * Where a setting's prose lives, when a setting needs prose at all.
 *
 * Most conventions are terms and tokens — a prefix, a pattern, a limit — and
 * those belong in the one settings file where anything can read them. A few
 * cannot be written that way: a rule with exceptions, or one whose wording
 * matters. Those get a file here, and its text is handed to the model as extra
 * instruction.
 *
 * Reach for this only when tokens genuinely cannot express the convention.
 * A file nobody needed is a file that drifts out of step with the setting
 * beside it.
 */
export const INSTRUCTIONS_DIR = join('.claude', 'hean-harness');
// What setup adds to the repository's .gitignore: this project's recorded answers,
// and every skill's output directory. A skill that writes anything writes it to
// .claude/skills/<skill-name>/output/, so one pattern covers all of them, including
// skills added later. Each of those files — a rendered PR body, a report, a
// screenshot — belongs to one run on one clone and would collide on any other.
export const IGNORE_LINES = [
  '.claude/hean-harness.local.json',
  '.claude/skills/*/output/'
];

/** Every setting this plugin understands, and what each one governs. */
export const KEYS = {
  branchNaming:    'The shape of a branch name, checked when a branch is created',
  apexClassNaming: 'Prefix and suffix for Apex class names',
  lwcNaming:       'Prefix and suffix for Lightning Web Component names',
  commitFormat:    'The shape of a commit subject line'
};

export function repoRoot(start = process.cwd()) {
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return start; }
}

export const settingsPath = repo => join(repo, '.claude', FILENAME);

export function load(repo) {
  const p = settingsPath(repo);
  if (!existsSync(p)) return { schema: 1 };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { schema: 1 }; }
}

export function save(repo, obj) {
  const p = settingsPath(repo);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ schema: 1, ...obj }, null, 2) + '\n');
  return p;
}

/** A setting counts as configured only when it holds something. */
export function isSet(repo, key) {
  const v = load(repo)[key];
  return v !== undefined && v !== null && !(typeof v === 'object' && Object.keys(v).length === 0);
}

export const get = (repo, key) => load(repo)[key] ?? null;

export const instructionsPath = (repo, file) => join(repo, INSTRUCTIONS_DIR, file);

/**
 * A setting rendered for the model: its values, then its prose if it has any.
 * Returns null when the team never recorded this setting, which is how a
 * consumer knows to enforce nothing.
 */
export function asPrompt(repo, key) {
  const v = get(repo, key);
  if (v === null) return null;

  const lines = [];
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'instructions' || val === '' || val === null) continue;
      lines.push(`- ${k}: ${val}`);
    }
  } else {
    lines.push(`- ${v}`);
  }

  if (typeof v === 'object' && v.instructions) {
    const f = instructionsPath(repo, v.instructions);
    if (existsSync(f)) {
      lines.push('', readFileSync(f, 'utf8').trim());
    } else {
      lines.push('', `(the notes file ${v.instructions} is recorded but missing)`);
    }
  }
  return lines.join('\n');
}

export function set(repo, key, value) {
  if (!(key in KEYS)) throw new Error(`Unknown setting: ${key}`);
  const s = load(repo); s[key] = value; save(repo, s); return s[key];
}

/**
 * What the team recorded, and where. Uninstall shows this before asking whether
 * to keep it, since it is their own answers rather than anything we wrote.
 */
export function describe(repo) {
  const file = settingsPath(repo);
  const notesDir = join(repo, INSTRUCTIONS_DIR);
  const s = load(repo);
  const recorded = Object.keys(KEYS).filter(k => s[k] !== undefined && s[k] !== null);
  const notes = existsSync(notesDir)
    ? readdirSync(notesDir).filter(f => f.endsWith('.md')) : [];
  return { file, exists: existsSync(file), recorded, notesDir, notes };
}

/** Delete the settings file and any notes. Only on an explicit choice. */
export function remove(repo) {
  const { file, notesDir, notes } = describe(repo);
  const gone = [];
  if (existsSync(file)) { rmSync(file); gone.push(file); }
  for (const n of notes) { rmSync(join(notesDir, n)); gone.push(join(notesDir, n)); }
  try { if (existsSync(notesDir) && readdirSync(notesDir).length === 0) rmdirSync(notesDir); } catch { /* keep going */ }
  return gone;
}

export function unset(repo, key) {
  const s = load(repo); delete s[key]; save(repo, s);
}

/**
 * Keep the file out of git. Appends to the repository's .gitignore only when
 * the line is not already there, so running setup again does not stack it up.
 */
export function ensureIgnored(repo) {
  const gi = join(repo, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const have = new Set(existing.split('\n').map(l => l.trim()));
  const missing = IGNORE_LINES.filter(l => !have.has(l));
  if (!missing.length) return { added: [], file: gi };
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(gi,
    `${sep}\n# hean-harness: this clone's own settings and skill output, not shared\n${missing.join('\n')}\n`);
  return { added: missing, file: gi };
}

// ---- CLI -------------------------------------------------------------------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const a = process.argv.slice(2);
  const flag = n => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const repo = flag('repo') ?? repoRoot();
  const key = flag('key');
  const out = o => console.log(JSON.stringify(o, null, 2));

  switch (a[0]) {
    case 'path': console.log(settingsPath(repo)); break;
    case 'list': {
      const s = load(repo);
      out(Object.fromEntries(Object.keys(KEYS).map(k =>
        [k, s[k] ?? null])));
      break;
    }
    case 'status': {
      const s = load(repo);
      for (const [k, why] of Object.entries(KEYS)) {
        const on = s[k] !== undefined && s[k] !== null;
        console.log(`  ${on ? 'set      ' : 'not set  '} ${k.padEnd(16)} ${why}`);
      }
      console.log(`\n  file: ${settingsPath(repo)}${existsSync(settingsPath(repo)) ? '' : '  (does not exist yet)'}`);
      break;
    }
    case 'get': out(get(repo, key)); break;
    case 'prompt': {
      const s = asPrompt(repo, key);
      console.log(s === null ? '' : s);
      break;
    }
    case 'instructions-path':
      console.log(instructionsPath(repo, flag('file') ?? `${key}.md`)); break;
    case 'set': {
      let v = flag('value');
      try { v = JSON.parse(v); } catch { /* a plain string is fine */ }
      out(set(repo, key, v));
      break;
    }
    case 'unset': unset(repo, key); console.log(`  ${key} cleared`); break;
    case 'describe': {
      const d = describe(repo);
      if (!d.exists && !d.notes.length) { console.log('  nothing recorded for this project'); break; }
      console.log(`  settings file  ${d.file}`);
      console.log(`  recorded       ${d.recorded.length ? d.recorded.join(', ') : 'none'}`);
      if (d.notes.length) console.log(`  notes          ${d.notes.join(', ')}  in ${d.notesDir}`);
      break;
    }
    case 'remove': {
      const gone = remove(repo);
      console.log(gone.length ? `  deleted ${gone.length} file${gone.length > 1 ? 's' : ''}:`
                              : '  nothing to delete');
      for (const g of gone) console.log(`    ${g}`);
      break;
    }
    case 'ignored': {
      console.log(`  in ${join(repo, '.gitignore')}:`);
      for (const l of IGNORE_LINES) console.log(`    ${l}`);
      break;
    }
    case 'ensure-ignored': { const r = ensureIgnored(repo);
      console.log(r.added.length
        ? `  added ${r.added.length} line${r.added.length > 1 ? 's' : ''} to ${r.file}`
        : `  already ignored in ${r.file}`); break; }
    default:
      console.error(`hean-harness settings

Usage: settings.mjs <command> [--repo R] [--key K] [--value V]

  status           which settings are set, and what each governs
  list             the current values as JSON
  path             where the settings file lives
  get --key K
  prompt --key K             the setting as text for the model; empty when unset
  instructions-path --key K  where a setting's prose file belongs
  set --key K --value V      V may be JSON or a plain string
  unset --key K
  describe         what this project recorded, and where
  remove           delete the settings file and any notes — asks nothing, so
                   only run it when the user has chosen to discard them
  ignored          the lines setup adds to the repository's .gitignore
  ensure-ignored   add those lines if they are not there already

Settings: ${Object.keys(KEYS).join(', ')}`);
      process.exit(a[0] ? 1 : 0);
  }
}
