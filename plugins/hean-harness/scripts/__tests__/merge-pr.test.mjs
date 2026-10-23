#!/usr/bin/env node
/**
 * What merge-pr builds, refuses and sends to GitHub.
 *
 * GitHub is never called: a stand-in `gh` first on PATH answers from a canned config and writes each call's
 * argv (JSON, one line per call) to a log file.
 *
 * Run: node scripts/__tests__/merge-pr.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(dirname(SCRIPTS), 'skills', 'merge-pr', 'scripts', 'merge-pr.mjs');
const lib = await import(SCRIPT);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const root = mkdtempSync(join(tmpdir(), 'hean-merge-pr-'));
const bin = join(root, 'bin');
mkdirSync(bin);
const log = join(root, 'gh.log');
const cfgFile = join(root, 'cfg.json');
writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const c = JSON.parse(fs.readFileSync(${JSON.stringify(cfgFile)}, 'utf8'));
if (a[0] === 'pr' && a[1] === 'view' && a.includes('mergeCommit,state')) { console.log(JSON.stringify({ mergeCommit: { oid: 'abc123merge' }, state: c.after || 'MERGED' })); }
else if (a[0] === 'pr' && a[1] === 'list') { if (c.list === 'fail') { console.error('list blocked\\nsecond line'); process.exit(1); } console.log(c.list === 'garbage' ? 'not json' : JSON.stringify(c.list)); }
else if (a[0] === 'pr' && a[1] === 'view') { console.log(JSON.stringify(c.pr)); }
else if (a[0] === 'api') { if (c.repo === 'fail') { console.error('boom'); process.exit(1); } console.log(JSON.stringify(c.repo)); }
else if (a[0] === 'pr' && a[1] === 'merge') { if (c.mergeFails) { console.error('merge blocked by protection'); process.exit(1); } }
`);
chmodSync(join(bin, 'gh'), 0o755);

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
function makeRepo(name, origin) {
  const dir = join(root, name);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}
const MATCHING = makeRepo('matching', 'https://github.com/acme/widgets');
const ELSEWHERE = makeRepo('elsewhere', 'https://github.com/other/place.git');
const NOT_A_REPO = mkdtempSync(join(tmpdir(), 'hean-merge-pr-norepo-'));

const URL = 'https://github.com/acme/widgets/pull/684';
const PR = {
  number: 684, title: '@ABC-123: Add the dedupe check', body: 'Body text', state: 'OPEN', isDraft: false,
  reviewDecision: 'APPROVED', headRefName: 'work-ABC-123', headRefOid: 'deadbeef',
  headRepositoryOwner: { login: 'dev1' }, baseRefName: 'main', url: URL
};
const CLASSIC = { merge_commit_title: null, merge_commit_message: null };

function run(args, { pr = {}, repo = CLASSIC, mergeFails = false, after = 'MERGED', list = [], cwd = MATCHING } = {}) {
  writeFileSync(cfgFile, JSON.stringify({ pr: { ...PR, ...pr }, repo, mergeFails, after, list }));
  writeFileSync(log, '');
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { code: r.status, out: r.stdout.trim(), calls, merge: calls.find(c => c[0] === 'pr' && c[1] === 'merge') };
}
const val = (call, flag) => call[call.indexOf(flag) + 1];

try {
  console.log('buildMessage');
  const base = { title: 'Add check', body: 'B', number: 7, headOwner: 'o', headRef: 'br', workId: 'ABC-1' };
  const b = s => lib.buildMessage({ ...base, settings: s });
  check('null settings: classic', b(CLASSIC).subject === '@ABC-1: Merge pull request #7 from o/br' && b(CLASSIC).body === 'Add check');
  check('settings undefined: classic', b(undefined).subject === '@ABC-1: Merge pull request #7 from o/br');
  check('PR_TITLE / PR_BODY', (r => r.subject === '@ABC-1: Add check' && r.body === 'B')(b({ merge_commit_title: 'PR_TITLE', merge_commit_message: 'PR_BODY' })));
  check('MERGE_MESSAGE / BLANK', (r => r.subject.startsWith('@ABC-1: Merge pull request') && r.body === '')(b({ merge_commit_title: 'MERGE_MESSAGE', merge_commit_message: 'BLANK' })));
  check('no double prefix', lib.buildMessage({ ...base, title: '@ABC-1: Add check', settings: { merge_commit_title: 'PR_TITLE', merge_commit_message: 'BLANK' } }).subject === '@ABC-1: Add check');
  check('workIdFromTitle', lib.workIdFromTitle('@AB-12-UK: x') === 'AB-12-UK' && lib.workIdFromTitle('AB-12: x') === null);

  console.log('command line');
  let r = run([URL]);
  check('classic default merges', r.code === 0 && r.merge && val(r.merge, '--subject') === '@ABC-123: Merge pull request #684 from dev1/work-ABC-123', r.out);
  check('classic body is the title', r.merge && val(r.merge, '--body') === '@ABC-123: Add the dedupe check');
  check('merge call flags', r.merge && r.merge.includes('--merge') && val(r.merge, '--match-head-commit') === 'deadbeef' && r.merge[2] === URL);
  check('prints subject and SHA', /Merged: @ABC-123: Merge pull request/.test(r.out) && /SHA: abc123merge/.test(r.out), r.out);

  r = run([URL], { repo: { merge_commit_title: 'PR_TITLE', merge_commit_message: 'PR_BODY' } });
  check('PR_TITLE setting: subject unchanged, no double prefix', r.merge && val(r.merge, '--subject') === '@ABC-123: Add the dedupe check');
  check('PR_BODY: body is the PR body', r.merge && val(r.merge, '--body') === 'Body text');

  r = run([URL], { repo: { merge_commit_title: 'PR_TITLE', merge_commit_message: 'BLANK' } });
  check('BLANK: empty body', r.merge && val(r.merge, '--body') === '');

  r = run([URL], { repo: 'fail' });
  check('unreadable repo settings: classic', r.code === 0 && val(r.merge, '--subject') === '@ABC-123: Merge pull request #684 from dev1/work-ABC-123');

  r = run([URL], { pr: { title: 'Add the dedupe check' } });
  check('no work ID: exit 2, no merge', r.code === 2 && /^REFUSED: no work ID/.test(r.out) && !r.merge, r.out);

  r = run([URL, '--work-id', 'XYZ-9-UK'], { pr: { title: 'Add the dedupe check' } });
  check('--work-id supplies it', r.code === 0 && val(r.merge, '--subject') === '@XYZ-9-UK: Merge pull request #684 from dev1/work-ABC-123', r.out);

  for (const bad of ['xyz-9', 'XYZ', 'XYZ-9-U', '']) {
    r = run([URL, '--work-id', bad]);
    check(`invalid --work-id "${bad}": exit 2, no calls`, r.code === 2 && /^REFUSED/.test(r.out) && r.calls.length === 0, r.out);
  }

  r = run([URL], { pr: { reviewDecision: 'REVIEW_REQUIRED' } });
  check('not approved: exit 2, no merge', r.code === 2 && /not approved/.test(r.out) && !r.merge, r.out);
  r = run([URL], { pr: { isDraft: true } });
  check('draft: exit 2, no merge', r.code === 2 && /draft/.test(r.out) && !r.merge, r.out);
  r = run([URL], { pr: { state: 'CLOSED' } });
  check('closed: exit 2, no merge', r.code === 2 && /not open/.test(r.out) && !r.merge, r.out);

  r = run([URL], { mergeFails: true });
  check('failing merge: exit 1 with stderr', r.code === 1 && /^ERROR:.*merge blocked by protection/.test(r.out), r.out);

  r = run([URL, '--dry-run']);
  check('--dry-run: prints, no merge call', r.code === 0 && !r.merge && /^Subject: @ABC-123: Merge pull request #684/m.test(r.out), r.out);

  console.log('fix round 1');
  const NASTY = { title: '@ABC-123: Say "hi" `x` $(echo x)\nline2', body: 'b "q" `t` $(echo x)\nl2\n\nl4' };
  r = run([URL], { pr: NASTY, repo: { merge_commit_title: 'PR_TITLE', merge_commit_message: 'PR_BODY' } });
  check('special characters reach merge argv byte for byte', r.merge && val(r.merge, '--subject') === '@ABC-123: Say "hi" `x` $(echo x)\nline2' && val(r.merge, '--body') === NASTY.body, JSON.stringify(r.merge));

  r = run([URL], { pr: { title: 'No id', isDraft: true } });
  check('refusal checks run before the work-ID check', r.code === 2 && /draft/.test(r.out), r.out);

  r = run([URL, '--work-id', 'XYZ-9']);
  check('title ID wins, NOTE printed once', r.code === 0 && val(r.merge, '--subject').startsWith('@ABC-123: ') && r.out.split('\n').filter(l => /^NOTE:/.test(l)).length === 1 && /XYZ-9.*ignored.*ABC-123/.test(r.out), r.out);

  r = run([URL], { after: 'OPEN' });
  check('queued: Queued line, exit 0, no Merged', r.code === 0 && /^Queued: @ABC-123: /m.test(r.out) && !/Merged:/.test(r.out), r.out);

  check('api call carries --hostname', (r => r.calls.some(c => c[0] === 'api' && c[1] === '--hostname' && c[2] === 'github.com' && c[3] === 'repos/acme/widgets'))(run([URL])));
  check('GHE host is passed through', (r => r.calls.some(c => c[0] === 'api' && c[2] === 'ghe.example.com'))(run(['https://ghe.example.com/acme/widgets/pull/5'])));

  console.log('UAT PR lookup');
  const INT = { baseRefName: 'integration' };
  const listCalls = x => x.calls.filter(c => c[0] === 'pr' && c[1] === 'list');
  const lastLine = x => x.out.split('\n').pop();
  r = run([URL], { pr: INT, list: [{ number: 690, url: 'https://github.com/acme/widgets/pull/690' }] });
  check('one open PR: its URL, last line, exit 0', r.code === 0 && lastLine(r) === 'UAT PR: https://github.com/acme/widgets/pull/690' && /^SHA: /m.test(r.out), r.out);
  const lc = listCalls(r)[0];
  check('list call arguments', listCalls(r).length === 1 && lc.join(' ') === 'pr list --repo github.com/acme/widgets --base release --head integration --state open --json number,url', JSON.stringify(lc));
  r = run([URL], { pr: INT, list: [] });
  check('no open PR', r.code === 0 && lastLine(r) === 'UAT PR: none open', r.out);
  r = run([URL], { pr: INT, list: [{ number: 695, url: 'u2' }, { number: 690, url: 'u1' }] });
  check('several open PRs: ascending numbers', r.code === 0 && lastLine(r) === 'UAT PR: several open (#690, #695), not updated', r.out);
  r = run([URL], { pr: INT, list: 'fail' });
  check('list fails: first error line, exit 0', r.code === 0 && lastLine(r) === 'UAT PR: lookup failed — list blocked', r.out);
  r = run([URL], { pr: INT, list: 'garbage' });
  check('unreadable list output', r.code === 0 && /^UAT PR: lookup failed — /.test(lastLine(r)), r.out);
  r = run([URL], { pr: { baseRefName: 'main' }, list: [{ number: 1, url: 'u' }] });
  check('base not integration: no UAT line, no list call', r.code === 0 && !/UAT PR/.test(r.out) && listCalls(r).length === 0, r.out);
  r = run([URL], { pr: INT, after: 'OPEN', list: [{ number: 1, url: 'u' }] });
  check('queued: no UAT line, no list call', r.code === 0 && /^Queued:/m.test(r.out) && !/UAT PR/.test(r.out) && listCalls(r).length === 0, r.out);
  r = run([URL, '--dry-run'], { pr: INT, list: [{ number: 1, url: 'u' }] });
  check('dry run: no UAT line, no list call', r.code === 0 && !/UAT PR/.test(r.out) && listCalls(r).length === 0, r.out);
  r = run([URL], { pr: INT, cwd: ELSEWHERE });
  check('origin points elsewhere: skipped, no list call', r.code === 0 && lastLine(r) === 'UAT PR: skipped — this folder is not a checkout of acme/widgets' && listCalls(r).length === 0, r.out);
  r = run([URL], { pr: INT, cwd: NOT_A_REPO });
  check('outside a git repository: skipped, no list call', r.code === 0 && lastLine(r) === 'UAT PR: skipped — this folder is not a checkout of acme/widgets' && listCalls(r).length === 0, r.out);

  console.log('repoFromRemote');
  const want = { host: 'github.com', owner: 'acme', repo: 'widgets' };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const u of ['git@github.com:acme/widgets.git', 'git@github.com:acme/widgets', 'https://github.com/acme/widgets.git', 'https://github.com/acme/widgets', 'https://GitHub.com/ACME/Widgets\n', 'ssh://git@github.com/acme/widgets.git', 'ssh://git@github.com:22/acme/widgets', 'https://user@github.com/acme/widgets.git', 'https://user:token@github.com/acme/widgets']) {
    check(`parses ${u.trim()}`, same(lib.repoFromRemote(u), want), JSON.stringify(lib.repoFromRemote(u)));
  }
  check('unparseable gives null', lib.repoFromRemote('nonsense') === null && lib.repoFromRemote(null) === null);
} finally {
  rmSync(NOT_A_REPO, { recursive: true, force: true });
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
