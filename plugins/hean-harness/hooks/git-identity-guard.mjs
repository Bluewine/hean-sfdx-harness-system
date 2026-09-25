#!/usr/bin/env node
/**
 * Refuses a git identity that does not match the key the commits are signed with.
 *
 * GitHub verifies a signed commit only when its author and committer emails are
 * UID emails of the signing key, and a repository that requires verified
 * signatures rejects every other commit at push. By then the commits exist and
 * must all be rewritten. The usual cause is user.email changed in
 * ~/.gitconfig, which every repository and worktree on the machine shares, so
 * one command breaks the commits of every open repository at once.
 *
 * Two commands are checked:
 *
 *   git config    setting user.email, at any scope, to an address that is not
 *                 on the key is refused; an address on the key passes, so a
 *                 wrong value can be repaired. Removing user.email is refused.
 *   git push      refused when a commit it sends has an author or committer
 *                 email that is not on the key; the refusal lists the commits
 *                 and gives the command that rewrites them.
 *
 * Checked only where commits are signed: commit.gpgsign is true and
 * user.signingkey is set, read in the repository the command acts on (a `cd`
 * earlier in the same command and `git -C` are followed). The key's emails come
 * from `gpg --list-keys`. When gpg is missing or cannot read the key, the guard
 * says nothing: it never blocks on its own failure.
 *
 * `git config --edit` passes, because the new value is not in the command.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { gitCommands, isLiteral, repoOf } from '../scripts/lib/command-line.mjs';
import { allowed, gitConfig, identityRule } from '../scripts/lib/signing-identity.mjs';

// git config options that take the next word as their value
const CONFIG_VALUE_OPTS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
const CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--get-color', '--get-colorbool', '-l', '--list']);
// the subcommand form of newer git: `git config set user.email x`
const CONFIG_SUBCOMMANDS = new Set(['get', 'set', 'unset', 'list', 'edit', 'rename-section', 'remove-section']);

/**
 * What a `git config` does to user.email: { set: value }, { unset: true }, or
 * null when it leaves user.email alone. value is null when the text cannot say
 * what it is, such as "$EMAIL".
 *
 * Both syntaxes are read. The older one puts the action in an option (--unset,
 * --get, --remove-section, and none for a set); --add and --replace-all still
 * set the value. Newer git puts it in a subcommand. Scope options (--global,
 * --system, --local, --worktree, --file) do not change the answer.
 */
export function emailChange(args) {
  const pos = [];
  let mode = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (CONFIG_VALUE_OPTS.has(a)) { i++; continue; }
    if (a.startsWith('--') && a.includes('=')) continue;    // --file=x, --type=bool, --value=x
    if (a === '--unset' || a === '--unset-all') mode = 'unset';
    else if (CONFIG_READS.has(a)) mode = 'get';
    else if (a === '-e' || a === '--edit') mode = 'edit';
    else if (a === '--remove-section') mode = 'remove-section';
    else if (a === '--rename-section') mode = 'rename-section';
    else if (!a.startsWith('-')) pos.push(a);                // other options are flags, -fpath included
  }
  if (mode === null && CONFIG_SUBCOMMANDS.has(pos[0])) mode = pos.shift();

  const name = pos[0];
  if (!isLiteral(name)) return null;
  if (mode === 'remove-section' || mode === 'rename-section') return name.toLowerCase() === 'user' ? { unset: true } : null;
  if (name.toLowerCase() !== 'user.email') return null;
  if (mode === 'unset') return { unset: true };
  if ((mode === null || mode === 'set') && pos.length >= 2) return { set: isLiteral(pos[1]) ? pos[1] : null };
  return null;
}

const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 };
const git = (repo, ...args) => { try { return execFileSync('git', ['-C', repo, ...args], quiet).trim(); } catch { return null; } };

// git push options that take the next word as their value
const PUSH_VALUE_OPTS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);

/**
 * What a `git push` names: { remote, sources, all, sends }. sources are the
 * local names each refspec pushes (HEAD when none is given); all is --all,
 * --branches or --mirror; sends is false for a delete or a dry run.
 */
export function pushTargets(args) {
  const pos = [];
  let remote = null, all = false, sends = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (PUSH_VALUE_OPTS.has(a)) { if (a === '--repo') remote = args[i + 1]; i++; continue; }
    if (a.startsWith('--repo=')) { remote = a.slice(7); continue; }
    if (a === '--all' || a === '--branches' || a === '--mirror') all = true;
    else if (a === '-d' || a === '--delete' || a === '-n' || a === '--dry-run') sends = false;
    else if (!a.startsWith('-')) pos.push(a);
  }
  if (remote === null) remote = pos.shift() ?? null;
  const sources = [];
  for (const spec of pos) {
    const src = spec.replace(/^\+/, '').split(':')[0];
    if (src === '') continue;                                // :branch deletes
    sources.push(isLiteral(src) ? src : 'HEAD');
  }
  if (!sources.length && !all) sources.push('HEAD');
  return { remote, sources, all, sends };
}

/**
 * The commits pushing source would send, and the ref they are counted from.
 * The base is the branch's upstream, else <remote>/<branch> (origin when the
 * remote named is not configured), else no base: every commit on no remote.
 */
function sentCommits(repo, remote, source) {
  const tip = git(repo, 'rev-parse', '--verify', '-q', `${source}^{commit}`);
  if (!tip) return null;
  const branch = source === 'HEAD'
    ? git(repo, 'symbolic-ref', '-q', '--short', 'HEAD')
    : source.replace(/^refs\/heads\//, '');
  const remotes = (git(repo, 'remote') ?? '').split('\n').filter(Boolean);
  const via = remotes.includes(remote) ? remote : 'origin';
  let base = branch ? git(repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`) : null;
  if (!base && branch && git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${via}/${branch}`)) base = `${via}/${branch}`;
  const log = git(repo, 'log', '--format=%h%x1f%ae%x1f%ce%x1f%s', tip, '--not', ...(base ? [base] : ['--remotes']));
  if (log === null) return null;
  const commits = log.split('\n').filter(Boolean).map(l => {
    const [hash, author, committer, subject] = l.split('\x1f');
    return { hash, author, committer, subject };
  });
  return { base, commits };
}

/** The rebase starting point for the commits: the base ref, else the oldest commit's parent, else --root. */
function rebaseBase(repo, base, commits) {
  if (base) return base;
  const oldest = commits.at(-1).hash;
  return git(repo, 'rev-parse', '--verify', '-q', '--short', `${oldest}^`) ?? '--root';
}

const WHY = (repo, rule) =>
  `!! ${repo} signs commits with GPG key ${rule.key}. This repository requires verified signatures, ` +
  `and GitHub verifies a signature only when the commit's author and committer emails are UID emails ` +
  `of that key: ${rule.emails.join(', ')}. Any other email is rejected at push with ` +
  `"Commits must have verified signatures".`;

function configRefusal(change, repo, rule) {
  if (change.unset) {
    return `!! REFUSED: this removes user.email while commits are signed.\n${WHY(repo, rule)}\n\n` +
           `To change the address, set it to one of the key's emails instead of removing it.`;
  }
  const what = change.set === null
    ? 'sets user.email to a value the command text does not show'
    : `sets user.email to ${change.set}, which is not an email on the signing key`;
  return `!! REFUSED: this ${what}.\n${WHY(repo, rule)}\n` +
         `!! user.email set with --global changes every repository and worktree on this machine.\n\n` +
         `Set it only to one of: ${rule.emails.join(', ')}` +
         (change.set === null ? ', written out in the command.' : '.');
}

function pushRefusal(repo, rule, bad, base) {
  const current = gitConfig(repo, 'user.email');
  const lines = [
    `!! PUSH REFUSED: ${bad.length} commit${bad.length > 1 ? 's' : ''} this push sends carr${bad.length > 1 ? 'y' : 'ies'} an email that is not on the signing key.`,
    WHY(repo, rule),
    '',
    'Commits that fail:'
  ];
  for (const c of bad) lines.push(`  ${c.hash}  ${c.subject}  (author ${c.author}, committer ${c.committer})`);
  lines.push('', 'Repair, then push again:');
  let step = 1;
  if (!current || !allowed(current, rule.emails)) {
    lines.push(`  ${step++}. user.email is ${current ?? 'not set'}. Set it to ${rule.emails.join(' or ')} ` +
               `where the wrong value is set (git config --show-origin --get user.email names the file).`);
  }
  lines.push(`  ${step}. git rebase --exec 'git commit --amend --no-edit --reset-author' ${base}`);
  lines.push('', '!! Tell the user which commits are rewritten before running the repair.');
  return lines.join('\n');
}

/** Why this script may not run, or null when it may. */
export function check(script, sessionCwd) {
  for (const c of gitCommands(script, sessionCwd)) {
    if (c.sub !== 'config' && c.sub !== 'push') continue;
    const repo = repoOf(c, sessionCwd);

    if (c.sub === 'config') {
      const change = emailChange(c.args);
      if (!change) continue;
      const where = repo ?? c.dir ?? sessionCwd;
      const rule = identityRule(where);
      if (!rule) continue;
      if (change.set && allowed(change.set, rule.emails)) continue;
      return configRefusal(change, where, rule);
    }

    if (!repo) continue;
    const target = pushTargets(c.args);
    if (!target.sends) continue;
    const rule = identityRule(repo);
    if (!rule) continue;
    const sources = target.all
      ? (git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads') ?? '').split('\n').filter(Boolean)
      : target.sources;
    const bad = [];
    const seen = new Set();
    let base = null;
    for (const source of sources) {
      const sent = sentCommits(repo, target.remote, source);
      if (!sent) continue;
      const failing = sent.commits.filter(k => !seen.has(k.hash) && !(allowed(k.author, rule.emails) && allowed(k.committer, rule.emails)));
      if (!failing.length) continue;
      failing.forEach(k => seen.add(k.hash));
      bad.push(...failing);
      base ??= rebaseBase(repo, sent.base, sent.commits);
    }
    if (bad.length) return pushRefusal(repo, rule, bad, base);
  }
  return null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('git-identity-guard.mjs');
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  let reason = null;
  try { reason = check(input?.tool_input?.command ?? '', input?.cwd || process.cwd()); } catch { reason = null; }
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }));
  }
  process.exit(0);
}
