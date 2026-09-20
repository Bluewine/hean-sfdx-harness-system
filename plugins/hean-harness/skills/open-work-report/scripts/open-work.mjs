import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const INTEGRATION = arg('integration', 'origin/integration');
const aliasPath = arg('aliases',
  resolve(dirname(fileURLToPath(import.meta.url)), '../aliases.json'));

// aliases.json is local-only and gitignored: which work IDs were typo'd is a
// property of one repo's history at one moment, so it must never be committed.
// ABSENT is therefore the normal state and says nothing — most runs need no
// aliases at all. PRESENT BUT UNREADABLE is a different thing: someone meant to
// fold an ID and it is not happening, which is worth saying out loud.
let aliases = {};
try {
  aliases = JSON.parse(readFileSync(aliasPath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`[open-work] aliases.json at ${aliasPath} is unreadable (${err.message}).`);
    console.error(`[open-work] Continuing with NO alias map — any typo'd ID will appear as its own row.`);
  }
}

// Full subject, two-or-more letters, no trailing \b — a trailing boundary would
// drop `work-ABC-14_WT_...` merge subjects, where a digit precedes `_`.
const ID_RE = /\b[A-Z]{2,}-[0-9]+/g;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

// `--branches --remotes` deliberately, not `--all`: --all also walks refs/stash,
// refs/tags and refs/notes, and a stash entry is not work in progress.
// `--source` makes %S report the ref each commit was reached through, so a row
// can name the branch its work lives on. That name is display only — it never
// decides whether a row exists or which state it is in.
const lines = git(['log', '--branches', '--remotes', '--not', INTEGRATION,
                   '--source', '--format=%H%x09%S%x09%s']).split('\n').filter(Boolean);

const parse = (line) => {
  const [sha, ref, ...rest] = line.split('\t');
  return { sha, ref, subject: rest.join('\t') };
};

// refs/heads/foo and refs/remotes/origin/foo are the same branch to a reader.
const branchName = (ref) =>
  ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '').replace(/^origin\//, '');

const pushedShas = new Set(git(['rev-list', '--remotes']).split('\n').filter(Boolean));
// IDs that also own commits already in integration — used only to flag possible
// work-ID reuse, never to include or exclude a row.
const inIntegration = new Set();
for (const subj of git(['log', INTEGRATION, '--format=%s']).split('\n').filter(Boolean)) {
  for (const raw of subj.match(ID_RE) ?? []) inIntegration.add(aliases[raw] ?? raw);
}

const byId = new Map();
for (const line of lines) {
  const { sha, ref, subject } = parse(line);
  for (const raw of subject.match(ID_RE) ?? []) {
    const id = aliases[raw] ?? raw;
    if (!byId.has(id)) byId.set(id, { shas: new Set(), branches: new Set() });
    byId.get(id).shas.add(sha);
    byId.get(id).branches.add(branchName(ref));
  }
}

// Owning test, identical in intent to release-pr: a candidate earns a row only
// if it owns a commit — as the `@ID:` subject prefix, or as the `work-ID` branch
// in a merge subject. An ID appearing only inside another story's subject is a
// cross-reference, not work in flight.
const subjects = lines.map((l) => parse(l).subject);
const owns = (id) => {
  const re = new RegExp(`(^@?${id}:|work[-_]${id}([^0-9]|$))`);
  return subjects.some((s) => re.test(s));
};

const rows = [];
const mentionOnly = [];
for (const [id, { shas: shaSet, branches }] of byId) {
  const shas = [...shaSet];
  if (!owns(id)) {
    mentionOnly.push({ id, subjects: subjects.filter((s) => s.includes(id)) });
    continue;
  }
  const pushed = shas.filter((s) => pushedShas.has(s)).length;
  const pushState = pushed === 0 ? 'fully local'
    : pushed === shas.length ? 'fully pushed'
    : 'partially pushed';
  rows.push({
    id, branches: [...branches].sort(), commits: shas.length, pushed, pushState,
    alsoInIntegration: inIntegration.has(id),
  });
}

// Ordering by work ID only; the caller re-sorts into sprint blocks once Linear
// has supplied each row's cycle.
const idNum = (id) => Number(id.slice(id.lastIndexOf('-') + 1));
const idTeam = (id) => id.slice(0, id.lastIndexOf('-'));
rows.sort((a, b) => idTeam(a.id).localeCompare(idTeam(b.id)) || idNum(a.id) - idNum(b.id));

process.stdout.write(JSON.stringify({ integration: INTEGRATION, rows, mentionOnly }, null, 2) + '\n');
