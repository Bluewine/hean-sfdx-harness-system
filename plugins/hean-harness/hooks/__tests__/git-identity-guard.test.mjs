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
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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

// The signing key: two UIDs, so the allowed list has two emails. gpg lists the
// primary UID first, and which one is primary can change between runs.
run('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-gen-key', 'Test Signer <signer@example.com>', 'ed25519', 'sign', 'never']);
const KEY = run('gpg', ['--list-keys', '--with-colons']).split('\n').find(l => l.startsWith('fpr')).split(':')[9];
run('gpg', ['--batch', '--quick-add-uid', KEY, 'Test Signer <Second@Example.com>']);
run('gpgconf', ['--kill', 'all']);

// ~/.gitconfig signs every commit with that key, the way a developer's machine does.
git(sandbox, 'config', '--global', 'commit.gpgsign', 'true');
git(sandbox, 'config', '--global', 'user.signingkey', KEY);
git(sandbox, 'config', '--global', 'user.email', 'signer@example.com');
git(sandbox, 'config', '--global', 'user.name', 'Test Signer');
git(sandbox, 'config', '--global', 'init.defaultBranch', 'main');

/** A commit made without signing (the guard reads config, not signatures), with these emails. */
const commit = (repo, subject, author = 'signer@example.com', committer = 'signer@example.com') => {
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', subject], repo,
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
const BAD_AUTHOR = commit(SIGNED, 'Wrong author', 'other@example.org');
branch('bad-committer', 'main'); git(SIGNED, 'checkout', '-q', 'bad-committer');
const BAD_COMMITTER = commit(SIGNED, 'Wrong committer', 'signer@example.com', 'other@example.org');
// a bad commit already on the remote, with upstream set: pushing a good one on top sends only the good one
branch('pushed-bad', 'main'); git(SIGNED, 'checkout', '-q', 'pushed-bad');
commit(SIGNED, 'Already pushed', 'other@example.org');
git(SIGNED, 'push', '-q', '-u', 'origin', 'pushed-bad'); commit(SIGNED, 'Good on top');
// the same without upstream: origin/<branch> is the base
branch('no-upstream', 'main'); git(SIGNED, 'checkout', '-q', 'no-upstream');
commit(SIGNED, 'Already pushed', 'other@example.org');
git(SIGNED, 'push', '-q', 'origin', 'no-upstream'); commit(SIGNED, 'Good on top');
// a branch never pushed: every commit on no remote counts
branch('fresh', 'main'); git(SIGNED, 'checkout', '-q', 'fresh');
commit(SIGNED, 'Fresh good');
const FRESH_BAD = commit(SIGNED, 'Fresh wrong', 'Other@Example.org');
git(SIGNED, 'checkout', '-q', 'main');

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
deny('outside a repository, global signing', 'git config --global user.email bad@example.org', PLAIN);
deny('--unset',                            'git config --global --unset user.email', SIGNED, 'removes user.email');
deny('--unset-all',                        'git config --unset-all user.email', SIGNED, 'removes user.email');
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
allow('delete a bad branch',               'git push origin --delete bad-author');
allow('delete refspec',                    'git push origin :bad-author');
allow('dry run',                           'git push --dry-run origin bad-author');
allow('signing off in this repository',    'git push origin HEAD', UNSIGNED);
allow('key gpg cannot read',               'git push origin HEAD', UNKNOWN_KEY);
allow('gpg missing from PATH',             'git push origin bad-author', SIGNED, { PATH: NO_GPG });

console.log('git push: refused');
deny('wrong author',                       'git push origin bad-author', SIGNED,
     '!! PUSH REFUSED', BAD_AUTHOR, 'Wrong author', 'author other@example.org', KEY,
     "git rebase --exec 'git commit --amend --no-edit --reset-author' ");
deny('wrong committer',                    'git push -u origin bad-committer', SIGNED,
     BAD_COMMITTER, 'Wrong committer', 'committer other@example.org');
deny('forced refspec',                     'git push --force origin +bad-author:main', SIGNED, BAD_AUTHOR);
deny('never pushed: rebase from the oldest parent', 'git push -u origin fresh', SIGNED, FRESH_BAD, 'Fresh wrong');
deny('--all',                              'git push --all origin', SIGNED, BAD_AUTHOR, BAD_COMMITTER);
deny('cd into the repository',             `cd ${SIGNED} && git push origin bad-author`, PLAIN, BAD_AUTHOR);
deny('git -C the repository',              `git -C ${SIGNED} push origin bad-author`, PLAIN, BAD_AUTHOR);
deny('chained after a commit',             'git commit -m "x" && git push origin bad-committer', SIGNED, BAD_COMMITTER);
onBranch('bad-author', () => deny('current branch, no refspec', 'git push', SIGNED, BAD_AUTHOR));

console.log('Doctor check');
const { checkGitIdentity, gitIdentityFix } = await import('../../scripts/lib/environment.mjs');
const report = (label, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}`); };
let r = checkGitIdentity();
report(`global email on the key: ${r.detail}`, r.ok && !r.skipped);
git(sandbox, 'config', '--global', 'user.email', 'other@example.org');
r = checkGitIdentity();
report(`global email off the key: ${r.detail}; fix: ${gitIdentityFix(r)}`,
       !r.ok && /^git config --global user\.email \S+@example\.com {4}\(or \S+@example\.com\)$/.test(gitIdentityFix(r)) &&
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
