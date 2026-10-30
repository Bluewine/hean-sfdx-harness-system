#!/usr/bin/env node
/**
 * What the git identity guard must let through, and what it must stop. Also
 * checks the doctor's git identity line.
 *
 * Every run uses a throwaway HOME (so a throwaway ~/.gitconfig), a throwaway
 * GNUPGHOME holding generated keys with no passphrase, and throwaway
 * repositories, so the machine's real git configuration and keyring are never
 * read or changed. The throwaway gpg-agent is stopped and the folder removed on
 * every exit, a crash included.
 *
 * How it stays fast:
 * - Repositories are written by one `git fast-import` each. Every commit is
 *   empty, so every branch has the same (empty) tree, and switching a branch
 *   only rewrites HEAD.
 * - Checks call the hook's exported check() in this process. While a check
 *   runs, each read-only git or gpg call it makes is stored per command, folder,
 *   PATH and input, and reused until the test itself changes a repository.
 * - The check groups run at the same time in worker threads. The doctor group
 *   has its own HOME, because it rewrites ~/.gitconfig.
 * - The two timed checks run last, alone, as real `node` hook processes, the
 *   way Claude Code runs the hook.
 *
 * Run: node hooks/__tests__/git-identity-guard.test.mjs
 */

import cp, { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'git-identity-guard.mjs');

const realExecFileSync = cp.execFileSync;
let env = process.env;   // the main thread builds the throwaway environment; a worker is started with it

// Read-only git and gpg calls the hook makes, stored per (command, folder, PATH, input).
const memo = new Map();
let inHook = false;
cp.execFileSync = function (file, args, opts = {}) {
  if (!inHook) return realExecFileSync.call(this, file, args, opts);
  const key = JSON.stringify([file, args, opts.cwd ?? process.cwd(), process.env.PATH, opts.input ?? null]);
  if (!memo.has(key)) {
    try { memo.set(key, { out: realExecFileSync.call(this, file, args, opts) }); } catch (e) { memo.set(key, { err: e }); }
  }
  const m = memo.get(key);
  if (m.err) throw m.err;
  return m.out;
};
syncBuiltinESMExports();

/** Results that do not depend on HEAD or on refs: gpg reads, git config reads and the repository top. */
const stable = key => {
  const [file, args] = JSON.parse(key);
  return file !== 'git' || args.includes('config') || args.includes('--show-toplevel');
};
/** Drop stored results the test's last change could make stale; all of them unless only refs or HEAD changed. */
const forget = all => {
  if (all) return memo.clear();
  for (const k of memo.keys()) if (!stable(k)) memo.delete(k);
};

const run = (cmd, args, cwd, extra = {}, input) => {
  forget(cmd !== 'git' || args.includes('config'));
  return realExecFileSync(cmd, args, {
    cwd, env: { ...env, ...extra }, encoding: 'utf8', input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
  }).trim();
};
const git = (cwd, ...args) => run('git', args, cwd);

/** A commit with these emails, unsigned; its short hash, as git commit prints it. */
const commit = (repo, subject, author = 'signer@example.com', committer = 'signer@example.com') => {
  const out = run('git', ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', subject], repo,
                  { GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer });
  return /^\[\S+ (?:\(root-commit\) )?([0-9a-f]+)\]/.exec(out)[1];
};

/**
 * Check HEAD out on this branch. Every commit in these repositories is empty, so
 * every branch has the same tree and a checkout changes only HEAD. Written to
 * HEAD.lock and renamed, as git does, so a hook process reading HEAD at the same
 * time never sees it empty.
 */
const setHead = (repo, name) => {
  writeFileSync(join(repo, '.git', 'HEAD.lock'), `ref: refs/heads/${name}\n`);
  renameSync(join(repo, '.git', 'HEAD.lock'), join(repo, '.git', 'HEAD'));
  forget(false);
};

// ---------------------------------------------------------------- checks

let pass = 0, fail = 0;
let group = null;
const out = line => (isMainThread ? console.log(line) : parentPort.postMessage({ group, line }));
let hookModule = null;

/** Run the hook's check in this process; the refusal text, or null when allowed. */
function refusal(command, cwd, extra = {}) {
  const saved = process.env.PATH;
  if (extra.PATH) process.env.PATH = extra.PATH;
  inHook = true;
  try { return hookModule.check(command, cwd); } catch { return null; }   // the hook says nothing when it throws
  finally { inHook = false; process.env.PATH = saved; }
}

/** Run the hook exactly as Claude Code does; the refusal text, or null when allowed. */
function childRefusal(command, cwd) {
  const stdout = realExecFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env
  });
  if (!stdout.trim()) return null;
  const o = JSON.parse(stdout).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

/** One check; returns the refusal text so a later check can assert more on it. */
const check = (label, command, cwd, expect, extra) => {
  const got = refusal(command, cwd, extra);
  const ok = expect === null ? got === null : got !== null && expect.every(t => got.includes(t));
  ok ? pass++ : fail++;
  out(`  ${ok ? 'pass' : 'FAIL'}  ${expect === null ? 'allow' : 'deny '}  ${label}`);
  if (!ok) out(`        ${JSON.stringify(command)}\n        expected ${expect === null ? 'allow' : `deny containing ${JSON.stringify(expect)}`}, got ${got === null ? 'allow' : JSON.stringify(got)}`);
  return got;
};
const report = (label, ok) => { ok ? pass++ : fail++; out(`  ${ok ? 'pass' : 'FAIL'}  ${ok ? '     ' : ''} ${label}`); };

const GROUPS = {
  configRefused(fx) {
    const { SIGNED, PROGRAM, USED, PLAIN, LOCAL_UNSET, UNSIGNED, LOCAL_KEY, KEY, TEAM_KEY } = fx;
    const allow = (label, command, cwd = SIGNED, extra) => check(label, command, cwd, null, extra);
    const deny = (label, command, cwd = SIGNED, ...texts) => check(label, command, cwd, texts);

    out('git config: refused');
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

    out('git config: --global and --system are checked against the global key');
    deny('--global set, address only on this repository\'s own local key', `git config --global user.email teammate@example.com`, LOCAL_KEY,
         '!! REFUSED', 'teammate@example.com', KEY);
    deny('--system set, address only on this repository\'s own local key', `git config --system user.email teammate@example.com`, LOCAL_KEY,
         '!! REFUSED', 'teammate@example.com', KEY);
    allow('--global set, address on the global key even though the local key differs', 'git config --global user.email signer@example.com', LOCAL_KEY);
    allow('--system set, address on the global key even though the local key differs', 'git config --system user.email second@example.com', LOCAL_KEY);
    allow('no-scope set still checked against this repository\'s own key', 'git config user.email teammate@example.com', LOCAL_KEY);
    deny('no-scope set to the global-only address is refused: it is not this repository\'s key', 'git config user.email signer@example.com', LOCAL_KEY,
         '!! REFUSED', TEAM_KEY);
    deny('--global set is refused here even though this repository itself does not sign', 'git config --global user.email bad@example.org', UNSIGNED,
         '!! REFUSED', 'bad@example.org', KEY);
    allow('--global set to the global key\'s address, from a repository that does not sign', 'git config --global user.email signer@example.com', UNSIGNED);
  },

  configOther(fx) {
    const { SIGNED, LOCAL_UNSET, UNSIGNED, SSH_FORMAT, PROGRAM_MISSING, UNKNOWN_KEY, NO_GPG, KEY } = fx;
    const allow = (label, command, cwd = SIGNED, extra) => check(label, command, cwd, null, extra);
    const deny = (label, command, cwd = SIGNED, ...texts) => check(label, command, cwd, texts);

    out('git config: allowed');
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
    allow('gpg.format ssh, no-scope set checked against this repository', 'git config user.email bad@example.org', SSH_FORMAT);
    deny('gpg.format ssh locally does not excuse a --global set: ~/.gitconfig still signs OpenPGP',
         'git config --global user.email bad@example.org', SSH_FORMAT, '!! REFUSED', KEY);
    allow('gpg.program missing, no openpgp program', 'git config user.email bad@example.org', PROGRAM_MISSING);
    allow('key gpg cannot read',               'git config user.email bad@example.org', UNKNOWN_KEY);
    allow('gpg missing from PATH',             'git config user.email bad@example.org', SIGNED, { PATH: NO_GPG });
    allow('echo of the command',               "echo 'git config user.email bad@example.org'");

    out('git config: where it runs');
    deny('cd into a signed repository',        `cd ${SIGNED} && git config user.email bad@example.org`, UNSIGNED);
    allow('cd into an unsigned repository',    `cd ${UNSIGNED} && git config user.email bad@example.org`);
    deny('git -C a signed repository',         `git -C ${SIGNED} config user.email bad@example.org`, UNSIGNED);
    allow('git -C an unsigned repository',     `git -C ${UNSIGNED} config user.email bad@example.org`);
    deny('chained after another command',      'git status && git config --global user.email bad@example.org');
    deny('second line of a script',            'echo start\ngit config user.email bad@example.org');
    allow('chained, each in an unsigned repo', `git status; git -C ${UNSIGNED} config user.email bad@example.org`);
  },

  // Every check here names its refspec, so none reads SIGNED's HEAD, which the push-refused group moves.
  pushAllowed(fx) {
    const { SIGNED, WORK, UNSIGNED, UNKNOWN_KEY, NO_GPG, BRANCHY, CFG_NAMES, CFG_GLOB, CFG_NAMED_OK, MATCH_LOCAL, MATCH_HEAD } = fx;
    const allow = (label, command, cwd = SIGNED, extra) => check(label, command, cwd, null, extra);
    const deny = (label, command, cwd = SIGNED, ...texts) => check(label, command, cwd, texts);

    out('git push: allowed');
    allow('refspec, good commits',             'git push origin good');
    allow('src:dst refspec, good commits',     'git push origin good:review/good');
    allow('bad commit already on the upstream', 'git push origin pushed-bad');
    allow('bad commit already on origin/<branch>, no upstream', 'git push origin no-upstream');
    allow('author not on the key, committer on it', 'git push origin bad-author');
    allow('teammate commit signed with their own key', 'git push origin signed-team');
    allow('delete a bad branch',               'git push origin --delete bad-committer');
    allow('delete refspec',                    'git push origin :bad-committer');
    allow('dry run',                           'git push --dry-run origin bad-committer');
    allow('signing off in this repository',    'git push origin HEAD', UNSIGNED);
    allow('key gpg cannot read',               'git push origin HEAD', UNKNOWN_KEY);
    allow('gpg missing from PATH',             'git push origin bad-committer', SIGNED, { PATH: NO_GPG });

    out('git push: work branch that merged a teammate commit from integration');
    for (const cmd of ['git push', 'git push origin', 'git push origin HEAD', 'git push origin work-X-1',
                       'git push -u origin work-X-1', 'git push origin work-X-1:work-X-1', 'git push --all origin',
                       'git push --branches origin', 'git push --force-with-lease origin HEAD']) {
      allow(cmd, cmd, WORK);
    }
    const OWN_BAD = commit(WORK, 'My wrong commit', 'signer@example.com', 'other@example.org');
    const got = deny('an added bad commit of the user is refused', 'git push', WORK, OWN_BAD, 'My wrong commit',
                     'git commit --amend --no-edit --allow-empty');
    report('the teammate commit is not listed', got !== null && !got.includes('Teammate change'));
    // Every tag is clean while HEAD is not: a --tags push that read HEAD, or any commit
    // outside the tags, would be refused here.
    allow('tags only, HEAD bad but every tag clean', 'git push origin --tags', WORK);

    // BRANCHY and its variants stay on main, which is clean; feat holds a wrong committer.
    out('git push: configured and colon pushes');
    allow('a typed refspec overrides remote.origin.push', 'git push origin good', CFG_NAMES);
    allow('a typed src:dst refspec overrides remote.origin.push', 'git push origin good:review/good', CFG_NAMES);
    allow('a glob in remote.origin.push does not refuse by itself', 'git push', CFG_GLOB);
    allow('a glob in remote.origin.push, remote typed',            'git push origin', CFG_GLOB);
    allow('no configuration: HEAD only, feat not checked',         'git push', BRANCHY);
    allow('delete refspec :feat sends nothing',                    'git push origin :feat', BRANCHY);
    allow('delete refspec :feat sends nothing, configured',        'git push origin :feat', CFG_NAMES);
    allow('--delete with remote.origin.push sends nothing',        'git push --delete origin feat', CFG_NAMES);
    allow('dry run with remote.origin.push sends nothing',         'git push --dry-run', CFG_NAMES);
    allow('named remote.origin.push values send only what they name, not HEAD', 'git push', CFG_NAMED_OK);
    allow('named remote.origin.push values, remote typed',         'git push origin', CFG_NAMED_OK);

    out('git push: matching branches only');
    allow('push.default=matching skips branches the remote lacks',  'git push', MATCH_LOCAL);
    allow('push.default=matching, remote typed',                    'git push origin', MATCH_LOCAL);
    allow('typed ":" skips branches the remote lacks',              'git push origin :', MATCH_LOCAL);
    allow('typed "+:" skips branches the remote lacks',             'git push origin +:', MATCH_LOCAL);
    allow('push.default=matching, HEAD local-only and bad: HEAD is not sent', 'git push', MATCH_HEAD);
    allow('push.default=matching, HEAD local-only and bad, remote typed',     'git push origin', MATCH_HEAD);
  },

  // The only group that moves SIGNED's HEAD.
  pushRefused(fx) {
    const { SIGNED, PLAIN, KEY, BAD_COMMITTER, UNSIGNED_TEAM, SIGNED_MINE, FRESH_BAD, TWO_BAD_BASE, FEAT_BAD, CFG_NAMES, CFG_MATCHING, BRANCHY, CFG_MIXED, HEAD_BAD } = fx;
    const allow = (label, command, cwd = SIGNED, extra) => check(label, command, cwd, null, extra);
    const deny = (label, command, cwd = SIGNED, ...texts) => check(label, command, cwd, texts);
    const onBranch = (name, checks) => { setHead(SIGNED, name); checks(); setHead(SIGNED, 'main'); };

    out('git push: refused');
    deny('wrong committer',                    'git push -u origin bad-committer', SIGNED,
         '!! PUSH REFUSED', BAD_COMMITTER, 'Wrong committer', 'committer other@example.org', KEY,
         'not on the checked-out branch');
    deny('unsigned teammate commit',           'git push origin unsigned-team', SIGNED, UNSIGNED_TEAM, 'committer teammate@example.com');
    deny('signed with the user key, wrong committer', 'git push origin signed-mine', SIGNED, SIGNED_MINE);
    deny('forced refspec',                     'git push --force origin +bad-committer:main', SIGNED, BAD_COMMITTER);
    const all = deny('--all',                  'git push --all origin', SIGNED, BAD_COMMITTER, FRESH_BAD, SIGNED_MINE);
    report('--all leaves out the author-only and teammate-signed commits',
           all !== null && !/Wrong author|Signed by a teammate/.test(all));
    deny('--tags with a bad tag, HEAD clean',  'git push origin --tags', SIGNED, BAD_COMMITTER);
    deny('--mirror',                           'git push --mirror origin', SIGNED, BAD_COMMITTER);
    deny('cd into the repository',             `cd ${SIGNED} && git push origin bad-committer`, PLAIN, BAD_COMMITTER);
    deny('git -C the repository',              `git -C ${SIGNED} push origin bad-committer`, PLAIN, BAD_COMMITTER);
    deny('chained after a commit',             'git commit -m "x" && git push origin bad-committer', SIGNED, BAD_COMMITTER);

    out('git push: configured and colon pushes');
    deny('remote.origin.push names feat, bare push',   'git push', CFG_NAMES, '!! PUSH REFUSED', FEAT_BAD, 'Wrong on feat');
    deny('remote.origin.push names feat, remote typed', 'git push origin', CFG_NAMES, FEAT_BAD);
    deny('remote.origin.push names feat, -u',          'git push -u origin', CFG_NAMES, FEAT_BAD);
    // feat is on origin, so the matching branches include it; local-only is not, so git does not send it
    const matching = deny('push.default=matching checks the other branches', 'git push', CFG_MATCHING, FEAT_BAD);
    report('push.default=matching leaves out the branch the remote lacks', matching !== null && !matching.includes('Wrong on local-only'));
    deny('push.default=matching, remote typed',        'git push origin', CFG_MATCHING, FEAT_BAD);
    const colon = deny('typed ":" pushes the matching branches', 'git push origin :', BRANCHY, FEAT_BAD);
    report('typed ":" leaves out the branch the remote lacks', colon !== null && !colon.includes('Wrong on local-only'));
    deny('typed "+:" pushes the matching branches',    'git push origin +:', BRANCHY, FEAT_BAD);
    deny('typed ":" with a configured push still pushes the matching branches', 'git push origin :', CFG_NAMES, FEAT_BAD);
    const unfetched = deny('typed ":" to a URL with no tracking refs checks every branch', 'git push https://host/r.git :', BRANCHY, FEAT_BAD);
    report('every branch includes the local-only one', unfetched !== null && unfetched.includes('Wrong on local-only'));
    deny('typed ":" to a remote never fetched checks every branch', 'git push upstream +:', BRANCHY, FEAT_BAD);
    deny('an unnamed configured value keeps HEAD with the named ones', 'git push', CFG_MIXED, HEAD_BAD);

    out('git push: the checked-out branch');
    onBranch('good', () => allow('current branch, no refspec, good commits', 'git push'));
    onBranch('bad-committer', () => deny('only HEAD fails: amend', 'git push', SIGNED, BAD_COMMITTER,
                                         'git commit --amend --no-edit --allow-empty'));
    onBranch('fresh', () => {
      const got = deny('never pushed, only HEAD fails', 'git push -u origin fresh', SIGNED, FRESH_BAD, 'Fresh wrong', 'git commit --amend');
      report('the amend keeps the author: no --reset-author', got !== null && !got.includes('--reset-author'));
    });
    onBranch('two-bad', () => {
      const got = deny('two failing: rebase from the oldest one\'s parent', 'git push', SIGNED, 'First wrong', 'Second wrong',
                       `git rebase --exec 'git commit --amend --no-edit --allow-empty' ${TWO_BAD_BASE}`);
      report('the repair keeps authors: no --reset-author', got !== null && !got.includes('--reset-author'));
    });
    onBranch('merged', () => {
      const got = refusal('git push', SIGNED);
      report('merge after the failing commit: no rebase command, repair by hand',
             got?.includes('Wrong before merge') && got.includes('include a merge') && !got.includes('git rebase'));
    });
  },

  repair(fx) {
    const { REPAIR } = fx;
    const allow = (label, command, cwd) => check(label, command, cwd, null);

    out('git push: the suggested repair runs over empty commits');
    // Every commit these tests make is empty, like the ones made to start a Jenkins
    // build again. Run the advice exactly as the refusal prints it.
    const advice = refusal('git push', REPAIR)?.match(/git rebase --exec .*$/m)?.[0];
    report(`advice found: ${advice}`, !!advice);
    let repaired = true;
    try { run('sh', ['-c', advice], REPAIR); } catch { repaired = false; }
    report('the suggested rebase completes on empty commits', repaired);
    allow('the push is allowed after the repair', 'git push', REPAIR);
    report('the repair kept the authors',
           git(REPAIR, 'log', '-2', '--format=%ae') === 'signer@example.com\nteammate@example.com');
    git(REPAIR, 'commit', '-q', '--allow-empty', '-m', 'Retrigger once more', '--no-gpg-sign');
    run('git', ['-c', 'user.email=other@example.org', 'commit', '-q', '--amend', '--no-edit', '--allow-empty', '--no-gpg-sign', '--reset-author'], REPAIR);
    const amend = refusal('git push', REPAIR)?.match(/git commit --amend .*$/m)?.[0];
    report(`amend advice found: ${amend}`, amend === 'git commit --amend --no-edit --allow-empty');
    let amended = true;
    try { run('sh', ['-c', amend], REPAIR); } catch { amended = false; }
    report('the suggested amend completes on an empty commit', amended);
    allow('the push is allowed after the amend', 'git push', REPAIR);
  },

  // Runs with its own HOME (a copy of the throwaway ~/.gitconfig), because it rewrites it,
  // so it is the last group of its lane.
  async doctor(fx) {
    const { sandbox, DOCTOR_HOME } = fx;
    process.env.HOME = DOCTOR_HOME;
    env = { ...env, HOME: DOCTOR_HOME };
    out('Doctor check');
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
  }
};

// The groups run in this many worker threads at once, each lane one group after the
// other. More threads at once start more processes at once, and on this machine each
// process start then gets slower than the time the extra thread saves.
const LANES = [['configOther', 'repair'], ['configRefused', 'doctor'], ['pushRefused'], ['pushAllowed']];

/** A worker thread: run the groups of one lane in turn, sending each one's output and time, then the counts. */
async function workerMain() {
  hookModule = await import(HOOK);
  for (group of workerData.lane) {
    const t0 = Date.now();
    memo.clear();
    await GROUPS[group](workerData.fx);
    parentPort.postMessage({ group, took: Date.now() - t0 });
  }
  parentPort.postMessage({ pass, fail });
}

// ---------------------------------------------------------------- setup

/** A repository written by one git fast-import of stream, with this text added to .git/config; its marks as { ':1': sha }. */
function build(dir, stream, config = '', head = null) {
  run('git', ['init', '-q', '--ref-format=files', dir]);
  if (config) appendFileSync(join(dir, '.git', 'config'), config);
  const marks = join(dir, '.git', 'test-marks');
  run('git', ['fast-import', '--quiet', `--export-marks=${marks}`], dir, {}, stream);
  if (head) writeFileSync(join(dir, '.git', 'HEAD'), `ref: refs/heads/${head}\n`);
  return Object.fromEntries(readFileSync(marks, 'utf8').trim().split('\n').map(l => l.split(' ')));
}

let clock = 1700000000;
/** One fast-import commit. Without from, it goes on top of the ref's last commit in the same stream. */
const fiCommit = (ref, mark, subject, { author = 'signer@example.com', committer = 'signer@example.com', from, merge } = {}) => {
  const t = clock++;
  const msg = `${subject}\n`;
  return `commit ${ref}\nmark :${mark}\nauthor Test Signer <${author}> ${t} +0000\ncommitter Test Signer <${committer}> ${t} +0000\n` +
         `data ${Buffer.byteLength(msg)}\n${msg}` + (from ? `from ${from}\n` : '') + (merge ? `merge ${merge}\n` : '') + '\n';
};
const fiReset = (ref, from) => `reset ${ref}\nfrom ${from}\n\n`;
const upstream = (...branches) => branches.map(b => `[branch "${b}"]\n\tremote = origin\n\tmerge = refs/heads/${b}\n`).join('');
const short = sha => sha.slice(0, 7);

async function main() {
  const T0 = Date.now();
  const sandbox = mkdtempSync(join(tmpdir(), 'identity-guard-'));
  const HOME = join(sandbox, 'home');
  const GNUPGHOME = join(sandbox, 'gnupg');
  mkdirSync(HOME);
  mkdirSync(GNUPGHOME);
  chmodSync(GNUPGHOME, 0o700);

  // The Command Line Tools git starts about twice as fast as the /usr/bin/git shim.
  const CLT = '/Library/Developer/CommandLineTools/usr/bin';
  const PATH = process.platform === 'darwin' && existsSync(join(CLT, 'git')) ? `${CLT}:${process.env.PATH}` : process.env.PATH;
  env = { ...process.env, PATH, HOME, GNUPGHOME, XDG_CONFIG_HOME: join(sandbox, 'xdg'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|AUTHOR_|COMMITTER_|CONFIG_GLOBAL)/.test(k)) delete env[k];
  Object.assign(process.env, env);

  // Stop the throwaway gpg-agent and remove the folder on every exit, a crash included.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // gpg-agent takes its scdaemon with it; keyboxd and dirmngr run only on gpg setups that start them
    try { realExecFileSync('gpgconf', ['--kill', 'gpg-agent', 'keyboxd', 'dirmngr'], { env, stdio: 'ignore' }); } catch { /* none started */ }
    rmSync(sandbox, { recursive: true, force: true });
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));

  // The user's signing key, with two UIDs so the allowed list has two emails (gpg lists
  // the primary UID first, and which one is primary can change between runs), and a
  // teammate's key, in the same keyring the way a fetched public key would be.
  const keyParams = (name, email) =>
    `Key-Type: eddsa\nKey-Curve: ed25519\nKey-Usage: sign\nName-Real: ${name}\nName-Email: ${email}\nExpire-Date: 0\n%commit\n`;
  writeFileSync(join(sandbox, 'keys.txt'), `%no-protection\n${keyParams('Test Signer', 'signer@example.com')}${keyParams('Team Mate', 'teammate@example.com')}`);
  run('gpg', ['--batch', '--gen-key', join(sandbox, 'keys.txt')], sandbox);
  run('gpg', ['--batch', '--quick-add-uid', '<signer@example.com>', 'Test Signer <Second@Example.com>'], sandbox);
  const fprOf = {};
  let fpr = null;
  for (const l of run('gpg', ['--batch', '--list-keys', '--with-colons'], sandbox).split('\n')) {
    const f = l.split(':');
    if (f[0] === 'pub') fpr = null;
    else if (f[0] === 'fpr' && !fpr) fpr = f[9];
    else if (f[0] === 'uid') fprOf[/<([^>]+)>/.exec(f[9])[1].toLowerCase()] = fpr;
  }
  const KEY = fprOf['signer@example.com'];
  const TEAM_KEY = fprOf['teammate@example.com'];

  // ~/.gitconfig signs every commit with that key, the way a developer's machine does.
  writeFileSync(join(HOME, '.gitconfig'),
    `[commit]\n\tgpgsign = true\n[user]\n\tsigningkey = ${KEY}\n\temail = signer@example.com\n\tname = Test Signer\n[init]\n\tdefaultBranch = main\n`);
  const ORIGIN = join(sandbox, 'origin.git');   // never created: the hook reads only remote-tracking refs
  const remote = `[remote "origin"]\n\turl = ${ORIGIN}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

  // SIGNED: branches whose unpushed commits the push checks read.
  const SIGNED = join(sandbox, 'signed');
  const s = build(SIGNED,
    fiCommit('refs/heads/main', 1, 'Initial') +
    fiCommit('refs/heads/good', 2, 'Good work', { from: ':1' }) +
    fiCommit('refs/heads/bad-author', 3, 'Wrong author', { author: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/bad-committer', 4, 'Wrong committer', { committer: 'other@example.org', from: ':1' }) +
    // a bad commit already on the remote, with upstream set: pushing a good one on top sends only the good one
    fiCommit('refs/heads/pushed-bad', 5, 'Already pushed', { committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/pushed-bad', 6, 'Good on top') +
    // the same without upstream: origin/<branch> is the base
    fiCommit('refs/heads/no-upstream', 7, 'Already pushed', { committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/no-upstream', 8, 'Good on top') +
    // a branch never pushed: every commit on no remote counts
    fiCommit('refs/heads/fresh', 9, 'Fresh good', { from: ':1' }) +
    fiCommit('refs/heads/fresh', 10, 'Fresh wrong', { committer: 'Other@Example.org' }) +
    // two failing commits on one branch, and one with a merge after its failing commit
    fiCommit('refs/heads/two-bad', 11, 'Before', { from: ':1' }) +
    fiCommit('refs/heads/two-bad', 12, 'First wrong', { committer: 'other@example.org' }) +
    fiCommit('refs/heads/two-bad', 13, 'Second wrong', { committer: 'other@example.org' }) +
    fiCommit('refs/heads/merged', 14, 'Wrong before merge', { committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/merged', 15, 'Merge branch \'good\' into merged', { merge: ':2' }) +
    fiCommit('refs/heads/unsigned-team', 16, 'Teammate, unsigned', { author: 'teammate@example.com', committer: 'teammate@example.com', from: ':1' }) +
    fiReset('refs/remotes/origin/main', ':1') + fiReset('refs/remotes/origin/pushed-bad', ':5') +
    fiReset('refs/remotes/origin/no-upstream', ':7') + fiReset('refs/tags/v-bad', ':4'),
    remote + upstream('main', 'pushed-bad'), 'main');
  // signed commits: one with the user's key and a wrong committer, one a teammate signed with their key
  const signedCommit = (key, subject, author, committer) =>
    run('git', ['commit-tree', `-S${key}`, `${s[':1']}^{tree}`, '-p', s[':1'], '-m', subject], SIGNED,
        { GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer });
  const signedMine = signedCommit(KEY, 'Signed by me, wrong committer', 'signer@example.com', 'other@example.org');
  const signedTeam = signedCommit(TEAM_KEY, 'Signed by a teammate', 'teammate@example.com', 'teammate@example.com');
  run('git', ['update-ref', '--stdin'], SIGNED, {},
      `create refs/heads/signed-mine ${signedMine}\ncreate refs/heads/signed-team ${signedTeam}\n`);

  // WORK: a work branch pushed with upstream that merges origin/integration after a
  // teammate's unsigned commit landed there. Every commit it sends is the user's.
  const WORK = join(sandbox, 'work');
  build(WORK,
    fiCommit('refs/heads/main', 1, 'Initial') +
    fiReset('refs/heads/integration', ':1') +
    fiCommit('refs/remotes/origin/integration', 2, 'Teammate change', { author: 'teammate@example.com', committer: 'teammate@example.com', from: ':1' }) +
    fiCommit('refs/heads/work-X-1', 3, 'Story work', { from: ':1' }) +
    fiReset('refs/remotes/origin/work-X-1', ':3') +
    fiCommit('refs/heads/work-X-1', 4, 'Merge remote-tracking branch \'origin/integration\' into work-X-1', { from: ':3', merge: ':2' }) +
    fiCommit('refs/heads/work-X-1', 5, 'More story work') +
    fiReset('refs/remotes/origin/main', ':1') + fiReset('refs/tags/v-work', ':5'),
    remote + upstream('main', 'integration', 'work-X-1'), 'work-X-1');

  // REPAIR: two commits with a wrong committer on a branch never pushed
  const REPAIR = join(sandbox, 'repair');
  build(REPAIR,
    fiCommit('refs/heads/main', 1, 'Initial') + fiReset('refs/remotes/origin/main', ':1') +
    fiCommit('refs/heads/retrigger', 2, 'Retrigger build', { author: 'teammate@example.com', committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/retrigger', 3, 'Retrigger again', { committer: 'other@example.org' }),
    remote + upstream('main'), 'retrigger');

  // Small repositories that differ only in .git/config, copied from one empty repository
  const TEMPLATE = join(sandbox, 'template');
  run('git', ['init', '-q', '--ref-format=files', TEMPLATE]);
  const repo = (name, config, extraFiles = {}) => {
    const dir = join(sandbox, name);
    cpSync(TEMPLATE, dir, { recursive: true });
    appendFileSync(join(dir, '.git', 'config'), config);
    for (const [f, text] of Object.entries(extraFiles)) writeFileSync(join(dir, '.git', f), text);
    return dir;
  };
  // UNSIGNED: signing switched off for this repository only.
  const UNSIGNED = repo('unsigned', '[commit]\n\tgpgsign = false\n');
  commit(UNSIGNED, 'Wrong but unsigned', 'other@example.org');
  // UNKNOWN_KEY: signing on with a key gpg does not have.
  const UNKNOWN_KEY = repo('unknown-key', '[user]\n\tsigningkey = DEADBEEFDEADBEEF\n');
  commit(UNKNOWN_KEY, 'Wrong, key unreadable', 'other@example.org');
  // LOCAL_UNSET: worktree config on, a wrong worktree email under a right local one
  const LOCAL_UNSET = repo('local-unset', '[extensions]\n\tworktreeConfig = true\n[user]\n\temail = signer@example.com\n',
                           { 'config.worktree': '[user]\n\temail = wrong@example.org\n' });
  // LOCAL_KEY: a different signing key set locally than ~/.gitconfig's, so the
  // repository's own identity and the global identity disagree.
  const LOCAL_KEY = repo('local-key', `[user]\n\tsigningkey = ${TEAM_KEY}\n`);
  // SSH_FORMAT: signing on, but with an SSH key
  const SSH_FORMAT = repo('ssh-format', '[gpg]\n\tformat = ssh\n');
  // PROGRAM: gpg.openpgp.program is a wrapper that records its use; gpg.program is a missing file
  const WRAPPER = join(sandbox, 'gpg-wrapper.sh');
  const USED = join(sandbox, 'wrapper-used');
  writeFileSync(WRAPPER, `#!/bin/sh\ntouch '${USED}'\nexec gpg "$@"\n`);
  chmodSync(WRAPPER, 0o755);
  const PROGRAM = repo('program', `[gpg "openpgp"]\n\tprogram = ${WRAPPER}\n[gpg]\n\tprogram = ${join(sandbox, 'no-such-gpg')}\n`);
  const PROGRAM_MISSING = repo('program-missing', `[gpg]\n\tprogram = ${join(sandbox, 'no-such-gpg')}\n`);

  // BRANCHY: main is clean and on origin; feat holds a commit with a wrong committer. The variants
  // differ only in what git is configured to push.
  const BRANCHY = join(sandbox, 'branchy');
  const b = build(BRANCHY,
    fiCommit('refs/heads/main', 1, 'Initial') +
    fiCommit('refs/heads/good', 2, 'Good work', { from: ':1' }) +
    fiCommit('refs/heads/feat', 3, 'Wrong on feat', { committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/local-only', 4, 'Wrong on local-only', { committer: 'other@example.org', from: ':1' }) +
    fiReset('refs/remotes/origin/main', ':1') + fiReset('refs/remotes/origin/feat', ':1'),
    remote + upstream('main'), 'main');
  const branchy = (name, config) => {
    const dir = join(sandbox, name);
    cpSync(BRANCHY, dir, { recursive: true });
    appendFileSync(join(dir, '.git', 'config'), config);
    return dir;
  };
  const CFG_NAMES = branchy('cfg-names', '[remote "origin"]\n\tpush = refs/heads/feat:refs/heads/feat\n');
  const CFG_MATCHING = branchy('cfg-matching', '[push]\n\tdefault = matching\n');
  const CFG_GLOB = branchy('cfg-glob', '[remote "origin"]\n\tpush = refs/heads/*:refs/heads/*\n');
  // MATCH_LOCAL: matching, but the remote has only main, so feat and local-only are not sent
  const MATCH_LOCAL = branchy('match-local', '[push]\n\tdefault = matching\n');
  run('git', ['update-ref', '-d', 'refs/remotes/origin/feat'], MATCH_LOCAL);

  // HEADBAD: the checked-out branch holds a wrong committer, feat is clean. The variants differ in remote.origin.push.
  const HEADBAD = join(sandbox, 'headbad');
  const hb = build(HEADBAD,
    fiCommit('refs/heads/main', 1, 'Initial') +
    fiCommit('refs/heads/bad-head', 2, 'Wrong on HEAD', { committer: 'other@example.org', from: ':1' }) +
    fiCommit('refs/heads/feat', 3, 'Good on feat', { from: ':1' }) +
    fiReset('refs/remotes/origin/main', ':1'),
    remote + upstream('main'), 'bad-head');
  const headbad = (name, config) => {
    const dir = join(sandbox, name);
    cpSync(HEADBAD, dir, { recursive: true });
    appendFileSync(join(dir, '.git', 'config'), config);
    return dir;
  };
  const MATCH_HEAD = headbad('match-head', '[push]\n\tdefault = matching\n');
  const CFG_NAMED_OK = headbad('cfg-named-ok', '[remote "origin"]\n\tpush = refs/heads/feat:refs/heads/feat\n');
  const CFG_MIXED = headbad('cfg-mixed', '[remote "origin"]\n\tpush = refs/heads/feat:refs/heads/feat\n\tpush = refs/heads/*:refs/heads/*\n');

  // a folder that is not a repository: only ~/.gitconfig decides
  const PLAIN = join(sandbox, 'plain');
  mkdirSync(PLAIN);

  // PATH without gpg, for the "gpg is missing" case
  const NO_GPG = join(sandbox, 'bin');
  mkdirSync(NO_GPG);
  symlinkSync(PATH.split(':').map(d => join(d, 'git')).find(f => existsSync(f)), join(NO_GPG, 'git'));

  // The doctor group's own HOME, a copy of ~/.gitconfig, because it rewrites it.
  const DOCTOR_HOME = join(sandbox, 'doctor-home');
  mkdirSync(DOCTOR_HOME);
  copyFileSync(join(HOME, '.gitconfig'), join(DOCTOR_HOME, '.gitconfig'));
  const tSetup = Date.now() - T0;

  const fx = {
    sandbox, DOCTOR_HOME, SIGNED, WORK, REPAIR, BRANCHY, CFG_NAMES, CFG_MATCHING, CFG_GLOB, MATCH_LOCAL, CFG_NAMED_OK, CFG_MIXED, MATCH_HEAD, FEAT_BAD: short(b[':3']), HEAD_BAD: short(hb[':2']), UNSIGNED, UNKNOWN_KEY, LOCAL_UNSET, LOCAL_KEY, SSH_FORMAT, PROGRAM, PROGRAM_MISSING,
    PLAIN, NO_GPG, USED, KEY, TEAM_KEY,
    BAD_COMMITTER: short(s[':4']), FRESH_BAD: short(s[':10']), TWO_BAD_BASE: short(s[':11']),
    UNSIGNED_TEAM: short(s[':16']), SIGNED_MINE: short(signedMine)
  };

  // The groups, and the real hook processes, at the same time.
  const names = Object.keys(GROUPS);
  const lines = Object.fromEntries(names.map(g => [g, []]));
  const took = {};
  const groupRuns = LANES.map(lane => new Promise(resolve => {
    const w = new Worker(new URL(import.meta.url), { workerData: { lane, fx }, env });
    let counts = null;
    w.on('message', msg => {
      if (msg.line !== undefined) lines[msg.group].push(msg.line);
      else if (msg.took !== undefined) took[msg.group] = msg.took;
      else counts = msg;
    });
    w.on('error', e => lines[lane[0]].push(`  FAIL         the lane ${lane.join(', ')} stopped: ${e.stack}`));
    w.on('exit', code => resolve(counts && code === 0 ? counts : { pass: counts?.pass ?? 0, fail: (counts?.fail ?? 0) + 1 }));
  }));
  // Built while the lanes run: only the checks after them read it.
  // MANY: 150 branches, each with an unpushed commit of its own
  const MANY = join(sandbox, 'many');
  let manyStream = fiCommit('refs/heads/main', 1, 'Initial') + fiReset('refs/remotes/origin/main', ':1');
  for (let i = 0; i < 150; i++) manyStream += fiCommit(`refs/heads/b${i}`, i + 2, `Branch ${i}`, { from: ':1' });
  const m = build(MANY, manyStream, remote + upstream('main'), 'main');
  // A teammate-signed commit on top of each branch, ready for the second timed check.
  // One real TEAM_KEY signature is attached to 150 distinct commit objects: git verifies
  // each one (a bad signature by TEAM_KEY), which the hook treats exactly like a valid
  // teammate signature: the status is not N, and the key is not the user's.
  const sig = run('gpg', ['--batch', '--armor', '--detach-sign', '--local-user', TEAM_KEY], sandbox, {}, 'signed payload\n');
  const gpgsig = sig.split('\n').map((l, i) => (i ? ' ' : '') + l).join('\n');
  const objects = join(sandbox, 'signed-objects');
  mkdirSync(objects);
  const files = [];
  for (let i = 0; i < 150; i++) {
    const who = `Team Mate <teammate@example.com> ${1700100000 + i} +0000`;
    files.push(join(objects, `c${i}`));
    writeFileSync(files[i], `tree ${'4b825dc642cb6eb9a060e54bf8d69288fbee4904'}\nparent ${m[`:${i + 2}`]}\nauthor ${who}\ncommitter ${who}\n` +
                            `gpgsig ${gpgsig}\n\nTeammate signed ${i}\n`);
  }
  const teamSigned = run('git', ['hash-object', '-t', 'commit', '-w', '--stdin-paths'], MANY, {}, `${files.join('\n')}\n`).split('\n');

  /** Run a program with this standard input; resolves to its output and exit code. */
  const start = (file, args, raw, cwd = PLAIN) => new Promise(resolve => {
    const child = spawn(file, args, { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.on('close', code => resolve({ raw, stdout, code }));
    child.stdin.end(raw);
  });
  // One process at a time, beside the lanes.
  const processRuns = (async () => {
    // malformed input must never crash or deny
    const malformed = [];
    for (const raw of ['', 'not json', '{}', '{"tool_input":null}', '{"tool_input":{"command":null}}']) {
      malformed.push(await start(process.execPath, [HOOK], raw));
    }
    // Refusals through a real hook process, as Claude Code runs it. The process starts in
    // PLAIN, so each is refused only when the hook reads the folder from the input's cwd.
    const refused = [];
    for (const [label, command, cwd, texts] of [
      ['git config, cwd from the input', 'git config user.email signer@example.com', LOCAL_KEY, ['!! REFUSED', TEAM_KEY]],
      ['git push, cwd from the input', 'git push origin bad-committer', SIGNED, ['!! PUSH REFUSED', fx.BAD_COMMITTER, KEY]]
    ]) {
      const r = await start(process.execPath, [HOOK], JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }));
      refused.push({ ...r, label, texts });
    }
    // The 150 teammate-signed commits the second timed check reads must each carry the
    // signature, and git must check it (B, a bad signature by TEAM_KEY), so the timed run
    // verifies 150 signatures. Every commit carries the same signature over a different
    // payload, so the first and the last stand for the rest; checking all 150 with gpg
    // here would cost about 4 s.
    const stored = await start('git', ['cat-file', '--batch'], `${teamSigned.join('\n')}\n`, MANY);
    const statuses = await start('git', ['log', '--no-walk=unsorted', '--stdin', '--format=%G?%x1f%GK'],
                                 `${teamSigned[0]}\n${teamSigned[149]}\n`, MANY);
    return { malformed, refused, stored, statuses };
  })();
  const counts = await Promise.all(groupRuns);
  const { malformed, refused, stored, statuses } = await processRuns;
  for (const g of names) for (const l of lines[g]) console.log(l);
  for (const c of counts) { pass += c.pass; fail += c.fail; }
  console.log('Malformed input');
  for (const { raw, stdout, code } of malformed) {
    const ok = stdout === '' && code === 0;
    console.log(`  malformed input ${JSON.stringify(raw).padEnd(34)} -> ${ok ? 'silent, exit 0' : `${stdout} (exit ${code})`}`);
    if (!ok) fail++;
  }
  console.log('Refusals through a real hook process');
  for (const { label, stdout, code, texts } of refused) {
    let o = null;
    try { o = JSON.parse(stdout).hookSpecificOutput; } catch { /* checked below */ }
    report(`deny   ${label}: exit 0, PreToolUse, deny, reason with ${JSON.stringify(texts)}`,
           code === 0 && o?.hookEventName === 'PreToolUse' && o?.permissionDecision === 'deny' &&
           texts.every(t => o.permissionDecisionReason?.includes(t)));
  }
  const tGroups = Date.now() - T0 - tSetup;

  // The timed checks run last, alone, as real hook processes.
  console.log('git push: 150 branches');
  let t = Date.now();
  let got = childRefusal('git push --all origin', MANY);
  let ms = Date.now() - t;
  report('allow  --all over 150 clean branches', got === null);
  report(`finished in ${ms} ms, under 5000`, ms < 5000);
  run('git', ['update-ref', '--stdin'], MANY, {}, teamSigned.map((h, i) => `update refs/heads/b${i} ${h}\n`).join(''));
  t = Date.now();
  got = childRefusal('git push --all origin', MANY);
  ms = Date.now() - t;
  report('allow  --all over 150 branches, each with a teammate-signed commit', got === null);
  report(`finished in ${ms} ms, under 8000`, ms < 8000);
  const carried = stored.stdout.split(gpgsig).length - 1;
  const st = statuses.stdout.trim().split('\n');
  report(`each of the 150 commits carries the TEAM_KEY signature: ${carried} of 150`, stored.code === 0 && carried === 150);
  report(`git checks it as a bad signature by TEAM_KEY: ${st.map(l => l.replace('\x1f', ' by ')).join(', ')}`,
         statuses.code === 0 && st.length === 2 && st.every(l => l.startsWith('B\x1f') && l.length > 2 && TEAM_KEY.endsWith(l.slice(2))));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  setup ${tSetup} ms, check groups ${tGroups} ms (${names.map(g => `${g} ${took[g]}`).join(', ')})`);
  process.exit(fail ? 1 : 0);
}

if (isMainThread) await main();
else await workerMain();
