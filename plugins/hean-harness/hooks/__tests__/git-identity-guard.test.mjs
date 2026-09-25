#!/usr/bin/env node
/**
 * What the git identity guard must let through, and what it must stop. Also
 * checks the doctor's git identity line.
 *
 * Every run uses a throwaway HOME (so a throwaway ~/.gitconfig), a throwaway
 * GNUPGHOME holding a generated key with no passphrase, and throwaway
 * repositories, so the machine's real git configuration and keyring are never
 * read or changed.
 *
 * Run: node hooks/__tests__/git-identity-guard.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'git-identity-guard.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'identity-guard-'));
const HOME = join(sandbox, 'home');
const GNUPGHOME = join(sandbox, 'gnupg');
mkdirSync(HOME);
mkdirSync(GNUPGHOME);
chmodSync(GNUPGHOME, 0o700);

const env = { ...process.env, HOME, GNUPGHOME, XDG_CONFIG_HOME: join(sandbox, 'xdg'), GIT_CONFIG_NOSYSTEM: '1' };
for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|AUTHOR_|COMMITTER_|CONFIG_GLOBAL)/.test(k)) delete env[k];
Object.assign(process.env, env);   // the doctor check at the end runs in this process

const run = (cmd, args, cwd = sandbox, extra = {}) =>
  execFileSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (cwd, ...args) => run('git', args, cwd);

/** Generate a key with no passphrase; its fingerprint. */
const newKey = uid => {
  run('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-gen-key', uid, 'ed25519', 'sign', 'never']);
  return run('gpg', ['--list-keys', '--with-colons', uid]).split('\n').find(l => l.startsWith('fpr')).split(':')[9];
};
// The user's signing key: two UIDs, so the allowed list has two emails. gpg lists
// the primary UID first, and which one is primary can change between runs.
const KEY = newKey('Test Signer <signer@example.com>');
run('gpg', ['--batch', '--quick-add-uid', KEY, 'Test Signer <Second@Example.com>']);
// A teammate's key, in the same keyring the way a fetched public key would be.
const TEAM_KEY = newKey('Team Mate <teammate@example.com>');

// ~/.gitconfig signs every commit with that key, the way a developer's machine does.
git(sandbox, 'config', '--global', 'commit.gpgsign', 'true');
git(sandbox, 'config', '--global', 'user.signingkey', KEY);
git(sandbox, 'config', '--global', 'user.email', 'signer@example.com');
git(sandbox, 'config', '--global', 'user.name', 'Test Signer');
git(sandbox, 'config', '--global', 'init.defaultBranch', 'main');

/** A commit with these emails, unsigned unless signKey names the key to sign it with. */
const commit = (repo, subject, author = 'signer@example.com', committer = 'signer@example.com', signKey = null) => {
  const sign = signKey ? ['-c', `user.signingkey=${signKey}`, 'commit', '-S'] : ['-c', 'commit.gpgsign=false', 'commit'];
  run('git', [...sign, '-q', '--allow-empty', '-m', subject], repo,
      { GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer });
  return git(repo, 'rev-parse', '--short', 'HEAD');
};

// SIGNED: a clone of ORIGIN, signing on through ~/.gitconfig.
const ORIGIN = join(sandbox, 'origin.git');
git(sandbox, 'init', '-q', '--bare', ORIGIN);
const SIGNED = join(sandbox, 'signed');
git(sandbox, 'clone', '-q', ORIGIN, SIGNED);
commit(SIGNED, 'Initial');
git(SIGNED, 'push', '-q', '-u', 'origin', 'main');

// Branches whose unpushed commits the push checks read.
const branch = (name, from = 'main') => git(SIGNED, 'branch', '-q', name, from);
branch('good'); git(SIGNED, 'checkout', '-q', 'good'); commit(SIGNED, 'Good work');
branch('bad-author', 'main'); git(SIGNED, 'checkout', '-q', 'bad-author');
commit(SIGNED, 'Wrong author', 'other@example.org');
branch('bad-committer', 'main'); git(SIGNED, 'checkout', '-q', 'bad-committer');
const BAD_COMMITTER = commit(SIGNED, 'Wrong committer', 'signer@example.com', 'other@example.org');
// a bad commit already on the remote, with upstream set: pushing a good one on top sends only the good one
branch('pushed-bad', 'main'); git(SIGNED, 'checkout', '-q', 'pushed-bad');
commit(SIGNED, 'Already pushed', 'signer@example.com', 'other@example.org');
git(SIGNED, 'push', '-q', '-u', 'origin', 'pushed-bad'); commit(SIGNED, 'Good on top');
// the same without upstream: origin/<branch> is the base
branch('no-upstream', 'main'); git(SIGNED, 'checkout', '-q', 'no-upstream');
commit(SIGNED, 'Already pushed', 'signer@example.com', 'other@example.org');
git(SIGNED, 'push', '-q', 'origin', 'no-upstream'); commit(SIGNED, 'Good on top');
// a branch never pushed: every commit on no remote counts
branch('fresh', 'main'); git(SIGNED, 'checkout', '-q', 'fresh');
commit(SIGNED, 'Fresh good');
const FRESH_BAD = commit(SIGNED, 'Fresh wrong', 'signer@example.com', 'Other@Example.org');
// two failing commits on one branch, and one with a merge after its failing commit
branch('two-bad', 'main'); git(SIGNED, 'checkout', '-q', 'two-bad');
const TWO_BAD_BASE = commit(SIGNED, 'Before');
commit(SIGNED, 'First wrong', 'signer@example.com', 'other@example.org');
commit(SIGNED, 'Second wrong', 'signer@example.com', 'other@example.org');
branch('merged', 'main'); git(SIGNED, 'checkout', '-q', 'merged');
commit(SIGNED, 'Wrong before merge', 'signer@example.com', 'other@example.org');
run('git', ['-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '--no-edit', 'good'], SIGNED);
// signed commits: one with the user's key and a wrong committer, one a teammate signed with their key
branch('signed-mine', 'main'); git(SIGNED, 'checkout', '-q', 'signed-mine');
const SIGNED_MINE = commit(SIGNED, 'Signed by me, wrong committer', 'signer@example.com', 'other@example.org', KEY);
branch('signed-team', 'main'); git(SIGNED, 'checkout', '-q', 'signed-team');
commit(SIGNED, 'Signed by a teammate', 'teammate@example.com', 'teammate@example.com', TEAM_KEY);
branch('unsigned-team', 'main'); git(SIGNED, 'checkout', '-q', 'unsigned-team');
const UNSIGNED_TEAM = commit(SIGNED, 'Teammate, unsigned', 'teammate@example.com', 'teammate@example.com');
git(SIGNED, 'checkout', '-q', 'main');
git(SIGNED, 'tag', 'v-bad', 'bad-committer');


// UNSIGNED: signing switched off for this repository only.
const UNSIGNED = join(sandbox, 'unsigned');
git(sandbox, 'init', '-q', UNSIGNED);
git(UNSIGNED, 'config', 'commit.gpgsign', 'false');
commit(UNSIGNED, 'Wrong but unsigned', 'other@example.org');

// UNKNOWN_KEY: signing on with a key gpg does not have.
const UNKNOWN_KEY = join(sandbox, 'unknown-key');
git(sandbox, 'init', '-q', UNKNOWN_KEY);
git(UNKNOWN_KEY, 'config', 'user.signingkey', 'DEADBEEFDEADBEEF');
commit(UNKNOWN_KEY, 'Wrong, key unreadable', 'other@example.org');

// WORK: a work branch pushed with upstream that merges origin/integration after a
// teammate's unsigned commit landed there. Every commit it sends is the user's.
const WORK = join(sandbox, 'work');
git(sandbox, 'clone', '-q', ORIGIN, WORK);
git(WORK, 'checkout', '-q', '-b', 'integration');
git(WORK, 'push', '-q', '-u', 'origin', 'integration');
git(WORK, 'checkout', '-q', '-b', 'work-X-1');
commit(WORK, 'Story work');
git(WORK, 'push', '-q', '-u', 'origin', 'work-X-1');
const TEAMMATE = join(sandbox, 'teammate');
git(sandbox, 'clone', '-q', '-b', 'integration', ORIGIN, TEAMMATE);
commit(TEAMMATE, 'Teammate change', 'teammate@example.com', 'teammate@example.com');
git(TEAMMATE, 'push', '-q', 'origin', 'integration');
git(WORK, 'fetch', '-q', 'origin');
run('git', ['-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '--no-edit', 'origin/integration'], WORK);
commit(WORK, 'More story work');
git(WORK, 'tag', 'v-work');

// LOCAL_UNSET: worktree config on, a wrong worktree email under a right local one
const LOCAL_UNSET = join(sandbox, 'local-unset');
git(sandbox, 'init', '-q', LOCAL_UNSET);
git(LOCAL_UNSET, 'config', 'extensions.worktreeConfig', 'true');
git(LOCAL_UNSET, 'config', '--local', 'user.email', 'signer@example.com');
git(LOCAL_UNSET, 'config', '--worktree', 'user.email', 'wrong@example.org');

// SSH_FORMAT: signing on, but with an SSH key
const SSH_FORMAT = join(sandbox, 'ssh-format');
git(sandbox, 'init', '-q', SSH_FORMAT);
git(SSH_FORMAT, 'config', 'gpg.format', 'ssh');

// PROGRAM: gpg.openpgp.program is a wrapper that records its use; gpg.program is a missing file
const PROGRAM = join(sandbox, 'program');
git(sandbox, 'init', '-q', PROGRAM);
const WRAPPER = join(sandbox, 'gpg-wrapper.sh');
const USED = join(sandbox, 'wrapper-used');
writeFileSync(WRAPPER, `#!/bin/sh\ntouch '${USED}'\nexec gpg "$@"\n`);
chmodSync(WRAPPER, 0o755);
git(PROGRAM, 'config', 'gpg.openpgp.program', WRAPPER);
git(PROGRAM, 'config', 'gpg.program', join(sandbox, 'no-such-gpg'));
const PROGRAM_MISSING = join(sandbox, 'program-missing');
git(sandbox, 'init', '-q', PROGRAM_MISSING);
git(PROGRAM_MISSING, 'config', 'gpg.program', join(sandbox, 'no-such-gpg'));

// MANY: 150 branches, each with an unpushed commit of its own
const MANY = join(sandbox, 'many');
git(sandbox, 'clone', '-q', ORIGIN, MANY);
const tree = git(MANY, 'rev-parse', 'main^{tree}');
const mainTip = git(MANY, 'rev-parse', 'main');
for (let i = 0; i < 150; i++) {
  const sha = run('git', ['commit-tree', '--no-gpg-sign', tree, '-p', mainTip, '-m', `Branch ${i}`], MANY);
  git(MANY, 'update-ref', `refs/heads/b${i}`, sha);
}

// a folder that is not a repository: only ~/.gitconfig decides
const PLAIN = join(sandbox, 'plain');
mkdirSync(PLAIN);

// PATH without gpg, for the "gpg is missing" case
const NO_GPG = join(sandbox, 'bin');
mkdirSync(NO_GPG);
symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(NO_GPG, 'git'));

/** Run the hook exactly as Claude Code does; the refusal text, or null when allowed. */
function refusal(command, cwd = SIGNED, extra = {}) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8', env: { ...env, ...extra }
  });
  if (!out.trim()) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

let pass = 0, fail = 0;
const check = (label, command, cwd, expect, extra) => {
  const got = refusal(command, cwd, extra);
  const ok = expect === null ? got === null : got !== null && expect.every(t => got.includes(t));
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${expect === null ? 'allow' : 'deny '}  ${label}`);
  if (!ok) console.log(`        ${JSON.stringify(command)}\n        expected ${expect === null ? 'allow' : `deny containing ${JSON.stringify(expect)}`}, got ${got === null ? 'allow' : JSON.stringify(got)}`);
};
const allow = (label, command, cwd = SIGNED, extra) => check(label, command, cwd, null, extra);
const deny = (label, command, cwd = SIGNED, ...texts) => check(label, command, cwd, texts);
const report = (label, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${ok ? '     ' : ''} ${label}`); };

console.log('git config: refused');
for (const scope of ['', '--global ', '--system ', '--local ', '--worktree ', '--file .git/config ', '-f other.cfg ', '--file=x.cfg ']) {
  deny(`set ${scope || 'no scope '}to a wrong email`, `git config ${scope}user.email bad@example.org`, SIGNED,
       '!! REFUSED', 'bad@example.org', KEY, 'signer@example.com', 'second@example.com', 'Commits must have verified signatures');
}
deny('--replace-all',                      'git config --global --replace-all user.email bad@example.org');
deny('--add',                              'git config --add user.email bad@example.org');
deny('set subcommand',                     'git config set --global user.email bad@example.org');
deny('set subcommand, --value pattern',    'git config set --all --value=old user.email bad@example.org');
deny('key in other case',                  'git config --global User.Email bad@example.org');
deny('value the text cannot show',         'git config --global user.email "$NEW_EMAIL"', SIGNED, 'does not show', 'written out');
deny('gpg.openpgp.program is used before gpg.program', 'git config user.email bad@example.org', PROGRAM, '!! REFUSED');
report('the gpg.openpgp.program wrapper ran', existsSync(USED));
deny('outside a repository, global signing', 'git config --global user.email bad@example.org', PLAIN);
deny('--unset',                            'git config --global --unset user.email', SIGNED, 'removes user.email');
deny('--global --unset-all',               'git config --global --unset-all user.email', SIGNED, 'removes user.email', 'git config --global user.email');
deny('--local unset, wrong worktree email then applies', 'git config --local --unset user.email', LOCAL_UNSET,
     'removes user.email', 'would be wrong@example.org', 'git config --local user.email');
deny('unset with no scope is local',       'git config --unset user.email', LOCAL_UNSET, 'git config --local user.email');
deny('unset subcommand',                   'git config unset --global user.email', SIGNED, 'removes user.email');
deny('--remove-section user',              'git config --global --remove-section user', SIGNED, 'removes user.email');
deny('remove-section subcommand',          'git config remove-section --global user', SIGNED, 'removes user.email');

console.log('git config: allowed');
allow('set to a key email',                'git config --global user.email signer@example.com');
allow('set to the other key email, any case', 'git config user.email SECOND@example.COM');
allow('set subcommand to a key email',     'git config set --global user.email second@example.com');
allow('read',                              'git config user.email');
allow('--get',                             'git config --global --get user.email');
allow('get subcommand',                    'git config get user.email');
allow('--list',                            'git config --list --show-origin');
allow('another key',                       'git config --global user.name "Somebody Else"');
allow('another section removed',           'git config --remove-section alias');
allow('--edit (value not in the command)', 'git config --global --edit');
allow('signing off in this repository',    'git config user.email bad@example.org', UNSIGNED);
allow('unset with signing off',            'git config --unset user.email', UNSIGNED);
allow('--local unset, global key email then applies', 'git config --local --unset-all user.email');
allow('unset subcommand --local, key email then applies', 'git config unset --local user.email');
allow('--worktree unset, local key email then applies', 'git config --worktree --unset user.email', LOCAL_UNSET);
allow('--worktree without worktree config is local', 'git config --worktree --unset user.email');
allow('gpg.format ssh',                    'git config --global user.email bad@example.org', SSH_FORMAT);
allow('gpg.program missing, no openpgp program', 'git config user.email bad@example.org', PROGRAM_MISSING);
allow('key gpg cannot read',               'git config user.email bad@example.org', UNKNOWN_KEY);
allow('gpg missing from PATH',             'git config user.email bad@example.org', SIGNED, { PATH: NO_GPG });
allow('echo of the command',               "echo 'git config user.email bad@example.org'");

console.log('git config: where it runs');
deny('cd into a signed repository',        `cd ${SIGNED} && git config user.email bad@example.org`, UNSIGNED);
allow('cd into an unsigned repository',    `cd ${UNSIGNED} && git config user.email bad@example.org`);
deny('git -C a signed repository',         `git -C ${SIGNED} config user.email bad@example.org`, UNSIGNED);
allow('git -C an unsigned repository',     `git -C ${UNSIGNED} config user.email bad@example.org`);
deny('chained after another command',      'git status && git config --global user.email bad@example.org');
deny('second line of a script',            'echo start\ngit config user.email bad@example.org');
allow('chained, each in an unsigned repo', `git status; git -C ${UNSIGNED} config user.email bad@example.org`);

console.log('git push: allowed');
/** Run checks with HEAD on this branch of SIGNED, then go back to main. */
const onBranch = (name, checks) => { git(SIGNED, 'checkout', '-q', name); checks(); git(SIGNED, 'checkout', '-q', 'main'); };
onBranch('good', () => allow('current branch, no refspec, good commits', 'git push'));
allow('refspec, good commits',             'git push origin good');
allow('src:dst refspec, good commits',     'git push origin good:review/good');
allow('bad commit already on the upstream', 'git push origin pushed-bad');
allow('bad commit already on origin/<branch>, no upstream', 'git push origin no-upstream');
allow('author not on the key, committer on it', 'git push origin bad-author');
allow('teammate commit signed with their own key', 'git push origin signed-team');
allow('delete a bad branch',               'git push origin --delete bad-committer');
allow('delete refspec',                    'git push origin :bad-committer');
allow('dry run',                           'git push --dry-run origin bad-committer');
allow('tags only, every tag clean',        'git push origin --tags', WORK);
allow('signing off in this repository',    'git push origin HEAD', UNSIGNED);
allow('key gpg cannot read',               'git push origin HEAD', UNKNOWN_KEY);
allow('gpg missing from PATH',             'git push origin bad-committer', SIGNED, { PATH: NO_GPG });

console.log('git push: work branch that merged a teammate commit from integration');
for (const cmd of ['git push', 'git push origin', 'git push origin HEAD', 'git push origin work-X-1',
                   'git push -u origin work-X-1', 'git push origin work-X-1:work-X-1', 'git push --all origin',
                   'git push --branches origin', 'git push --force-with-lease origin HEAD']) {
  allow(cmd, cmd, WORK);
}
const OWN_BAD = commit(WORK, 'My wrong commit', 'signer@example.com', 'other@example.org');
deny('an added bad commit of the user is refused', 'git push', WORK, OWN_BAD, 'My wrong commit',
     'git commit --amend --no-edit');
report('the teammate commit is not listed', !refusal('git push', WORK).includes('Teammate change'));
allow('tags only, HEAD bad but every tag clean', 'git push origin --tags', WORK);

console.log('git push: refused');
deny('wrong committer',                    'git push -u origin bad-committer', SIGNED,
     '!! PUSH REFUSED', BAD_COMMITTER, 'Wrong committer', 'committer other@example.org', KEY,
     'not on the checked-out branch');
deny('unsigned teammate commit',           'git push origin unsigned-team', SIGNED, UNSIGNED_TEAM, 'committer teammate@example.com');
deny('signed with the user key, wrong committer', 'git push origin signed-mine', SIGNED, SIGNED_MINE);
deny('forced refspec',                     'git push --force origin +bad-committer:main', SIGNED, BAD_COMMITTER);
deny('--all',                              'git push --all origin', SIGNED, BAD_COMMITTER, FRESH_BAD, SIGNED_MINE);
report('--all leaves out the author-only and teammate-signed commits',
       !/Wrong author|Signed by a teammate/.test(refusal('git push --all origin')));
deny('--tags with a bad tag, HEAD clean',  'git push origin --tags', SIGNED, BAD_COMMITTER);
deny('--mirror',                           'git push --mirror origin', SIGNED, BAD_COMMITTER);
deny('cd into the repository',             `cd ${SIGNED} && git push origin bad-committer`, PLAIN, BAD_COMMITTER);
deny('git -C the repository',              `git -C ${SIGNED} push origin bad-committer`, PLAIN, BAD_COMMITTER);
deny('chained after a commit',             'git commit -m "x" && git push origin bad-committer', SIGNED, BAD_COMMITTER);
onBranch('bad-committer', () => deny('only HEAD fails: amend', 'git push', SIGNED, BAD_COMMITTER,
                                     'git commit --amend --no-edit'));
onBranch('fresh', () => deny('never pushed, only HEAD fails', 'git push -u origin fresh', SIGNED, FRESH_BAD, 'Fresh wrong', 'git commit --amend'));
onBranch('two-bad', () => deny('two failing: rebase from the oldest one\'s parent', 'git push', SIGNED, 'First wrong', 'Second wrong',
                               `git rebase --exec 'git commit --amend --no-edit' ${TWO_BAD_BASE}`));
onBranch('two-bad', () => report('the repair keeps authors: no --reset-author', !refusal('git push').includes('--reset-author')));
onBranch('fresh', () => report('the amend keeps the author: no --reset-author', !refusal('git push').includes('--reset-author')));
onBranch('merged', () => {
  const got = refusal('git push');
  report('merge after the failing commit: no rebase command, repair by hand',
         got?.includes('Wrong before merge') && got.includes('include a merge') && !got.includes('git rebase'));
});

console.log('git push: 150 branches');
let t = Date.now();
allow('--all over 150 clean branches', 'git push --all origin', MANY);
report(`finished in ${Date.now() - t} ms, under 5000`, Date.now() - t < 5000);
for (let i = 0; i < 150; i++) {
  git(MANY, 'checkout', '-q', `b${i}`);
  commit(MANY, `Teammate signed ${i}`, 'teammate@example.com', 'teammate@example.com', TEAM_KEY);
}
t = Date.now();
allow('--all over 150 branches, each with a teammate-signed commit', 'git push --all origin', MANY);
report(`finished in ${Date.now() - t} ms, under 8000`, Date.now() - t < 8000);

console.log('Doctor check');
const { checkGitIdentity, gitIdentityFix } = await import('../../scripts/lib/environment.mjs');
let r = checkGitIdentity();
report(`global email on the key: ${r.detail}`, r.ok && !r.skipped);
git(sandbox, 'config', '--global', 'user.email', 'other@example.org');
r = checkGitIdentity();
report(`global email off the key: ${r.detail}; fix: ${gitIdentityFix(r)}`,
       !r.ok && r.detail.includes('user.email is other@example.org') &&
       ['signer@example.com', 'second@example.com'].every(e => gitIdentityFix(r).includes(e)));
git(sandbox, 'config', '--global', '--unset', 'user.email');
r = checkGitIdentity();
report(`global email not set: ${r.detail}; fix: ${gitIdentityFix(r)}`,
       !r.ok && r.detail.startsWith('user.email is not set') &&
       ['signer@example.com', 'second@example.com'].every(e => gitIdentityFix(r).includes(e)));
git(sandbox, 'config', '--global', 'commit.gpgsign', 'false');
r = checkGitIdentity();
report(`signing off: ${r.detail}`, r.skipped);

console.log(`\n  ${pass} passed, ${fail} failed`);

// malformed input must never crash or deny
for (const raw of ['', 'not json', '{}', '{"tool_input":null}', '{"tool_input":{"command":null}}']) {
  const out = execFileSync(process.execPath, [HOOK], { input: raw, encoding: 'utf8', env });
  console.log(`  malformed input ${JSON.stringify(raw).padEnd(34)} -> ${out === '' ? 'silent, exit 0' : out}`);
  if (out !== '') fail++;
}

run('gpgconf', ['--kill', 'all']);
rmSync(sandbox, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
