#!/usr/bin/env node
/**
 * Refuses a git identity that does not match the key the commits are signed with.
 *
 * GitHub verifies a signed commit only when its committer email is a UID email
 * of the signing key, and a repository that requires verified signatures
 * rejects every other commit at push. By then the commits exist and must all be
 * rewritten. The usual cause is user.email changed in ~/.gitconfig, which every
 * repository and worktree on the machine shares, so one command breaks the
 * commits of every open repository at once.
 *
 * Two commands are checked:
 *
 *   git config    setting user.email, at any scope, to an address that is not
 *                 on the key is refused; an address on the key passes, so a
 *                 wrong value can be repaired. Removing user.email is refused,
 *                 except a --local or --worktree removal after which the
 *                 address that applies is still on the key.
 *   git push      refused when a commit it sends has a committer email that is
 *                 not on the key; the refusal lists the commits and says how
 *                 to repair them.
 *
 * A push with no typed refspec sends what git is configured to push, not HEAD:
 * the source of each remote.<remote>.push value, or the matching branches for
 * push.default=matching. A configured value whose source is a glob or variable
 * names no literal ref, so it adds nothing to the check and HEAD stays checked.
 * The matching branches, which a typed ':' also pushes, are the local branches
 * the remote being pushed to already has.
 *
 * The commits a push sends are counted as those on no remote-tracking branch.
 * Counting from the pushed branch's upstream instead refused work branches that
 * had merged the integration branch: the teammates' commits merged in are not
 * on the upstream, though the remote already has every one of them.
 *
 * Only commits that are unsigned or signed with the configured key are
 * checked. A commit a teammate signed with their own key verifies against
 * their key, not this one, and is theirs to answer for.
 *
 * Checked only where commits are signed with OpenPGP: commit.gpgsign is true,
 * user.signingkey is set and gpg.format is unset or openpgp, read in the
 * repository the command acts on (a `cd` earlier in the same command and
 * `git -C` are followed). The key's emails come from the program git signs with
 * (gpg.openpgp.program, then gpg.program, then gpg). When that program is
 * missing or cannot read the key, the guard says nothing: it never blocks on its
 * own failure.
 *
 * `git config --edit` passes, because the new value is not in the command.
 *
 * Reads the tool call on standard input, and either denies it or says nothing.
 */

import { readFileSync } from 'node:fs';

import { gitCommands, isLiteral, repoOf, tryGit } from '../scripts/lib/command-line.mjs';
import { allowed, gitConfig, identityRule } from '../scripts/lib/signing-identity.mjs';

// git config options that take the next word as their value
const CONFIG_VALUE_OPTS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
const CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--get-color', '--get-colorbool', '-l', '--list']);
// the subcommand form of newer git: `git config set user.email x`
const CONFIG_SUBCOMMANDS = new Set(['get', 'set', 'unset', 'list', 'edit', 'rename-section', 'remove-section']);

/**
 * What a `git config` does to user.email: { set: value, scope }, { unset: true,
 * scope }, or null when it leaves user.email alone. value is null when the text
 * cannot say what it is, such as "$EMAIL". scope is global, system, local,
 * worktree or file; local when none is given, as git does.
 *
 * Both syntaxes are read. The older one puts the action in an option (--unset,
 * --get, --remove-section, and none for a set); --add and --replace-all still
 * set the value. Newer git puts it in a subcommand.
 */
export function emailChange(args) {
  const pos = [];
  let mode = null;
  let scope = 'local';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (['--global', '--system', '--local', '--worktree'].includes(a)) { scope = a.slice(2); continue; }
    if (['-f', '--file', '--blob'].includes(a) || /^(-f.|--file=|--blob=)/.test(a)) scope = 'file';
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
  if (mode === 'remove-section' || mode === 'rename-section') return name.toLowerCase() === 'user' ? { unset: true, scope } : null;
  if (name.toLowerCase() !== 'user.email') return null;
  if (mode === 'unset') return { unset: true, scope };
  if ((mode === null || mode === 'set') && pos.length >= 2) return { set: isLiteral(pos[1]) ? pos[1] : null, scope };
  return null;
}

/**
 * The address that applies once user.email is removed from scope, or null when
 * none does. Without extensions.worktreeConfig, --worktree reads and writes the
 * local file, so it is the local scope.
 */
function emailAfterRemoval(dir, scope) {
  const worktrees = gitConfig(dir, 'extensions.worktreeConfig', [], ['--type=bool']) === 'true';
  const removed = scope === 'worktree' && !worktrees ? 'local' : scope;
  const order = removed === 'worktree' ? ['--local', '--global', '--system']
              : [...(worktrees ? ['--worktree'] : []), '--global', '--system'];
  for (const s of order) {
    const v = gitConfig(dir, 'user.email', [s]);
    if (v) return v;
  }
  return null;
}

// git push options that take the next word as their value
export const PUSH_VALUE_OPTS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);

/**
 * The words of a `git push` after the subcommand, as { remote, refspecs,
 * flags }: remote is the --repo value or the first positional word, or
 * undefined when none is typed; refspecs are the other positional words;
 * flags are the options that take no value, in order.
 */
export function pushWords(args) {
  const pos = [], flags = [];
  let remote, remoteGiven = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (PUSH_VALUE_OPTS.has(a)) { if (a === '--repo') { remoteGiven = true; remote = args[i + 1]; } i++; continue; }
    if (a.startsWith('--repo=')) { remoteGiven = true; remote = a.slice('--repo='.length); continue; }
    if (!a.startsWith('-')) pos.push(a);
    else flags.push(a);
  }
  if (!remoteGiven) remote = pos.shift();
  return { remote, refspecs: pos, flags };
}

// the local branches whose name the remote already has: what a ':' refspec and push.default=matching push
export const MATCHING = '--matching';

/**
 * What a `git push` sends, as { revs, sends }: revs are the revisions whose
 * commits it sends — the local side of each refspec, MATCHING for a ':'
 * refspec, --branches for --all and --branches, --tags for --tags, both for
 * --mirror, and HEAD when none of these and no refspec is given. sends is
 * false for a delete or a dry run.
 */
export function pushTargets(args) {
  const { refspecs: pos, flags } = pushWords(args);
  const revs = new Set();
  let sends = true;
  for (const a of flags) {
    if (a === '--all' || a === '--branches') revs.add('--branches');
    else if (a === '--tags') revs.add('--tags');
    else if (a === '--mirror') { revs.add('--branches'); revs.add('--tags'); }
    else if (a === '-d' || a === '--delete' || a === '-n' || a === '--dry-run') sends = false;
  }
  if (pos.length === 0 && !revs.size) revs.add('HEAD');
  for (const spec of pos) {
    const bare = spec.replace(/^\+/, '');
    if (bare === ':') { revs.add(MATCHING); continue; }
    const src = bare.split(':')[0];
    if (src === '') continue;                                // :branch deletes
    revs.add(isLiteral(src) ? src : 'HEAD');
  }
  return { revs: [...revs], sends };
}

// options that choose the pushed refs themselves, so git reads no configured refspec
const REF_FLAGS = new Set(['--all', '--branches', '--tags', '--mirror']);

/**
 * The remote a push goes to: the typed one, else branch.<branch>.pushRemote,
 * remote.pushDefault, branch.<branch>.remote, origin.
 */
function pushRemote(repo, typed) {
  const cfg = (...args) => tryGit(repo, 'config', ...args);
  const branch = tryGit(repo, 'symbolic-ref', '--short', '-q', 'HEAD');
  return typed ?? (branch && cfg('--get', `branch.${branch}.pushRemote`)) ?? cfg('--get', 'remote.pushDefault') ??
    (branch && cfg('--get', `branch.${branch}.remote`)) ?? 'origin';
}

/**
 * What git is configured to push when the push types no refspec and no ref
 * option, as { name, revs, unnamed, named }: name is the remote.<remote>.push
 * key read, revs the source of each value (MATCHING for ':' and for
 * push.default=matching), unnamed the values whose source is a glob or
 * variable, which name no literal ref. named is true when remote.<remote>.push
 * has values and every one names its source, or has none and
 * push.default=matching, so git sends nothing besides revs. A
 * delete or negative value sends nothing. words is the result of pushWords.
 */
export function configuredPush(repo, words) {
  const none = { name: null, revs: [], unnamed: [], named: false };
  if (words.refspecs.length || words.flags.some(f => REF_FLAGS.has(f))) return none;
  const cfg = (...args) => tryGit(repo, 'config', ...args);
  const name = `remote.${pushRemote(repo, words.remote)}.push`;
  const values = (cfg('--get-all', name) ?? '').split('\n').filter(Boolean);
  if (!values.length) {
    if (cfg('--get', 'push.default') !== 'matching') return { ...none, name };
    return { ...none, name, revs: [MATCHING], named: true };   // only the matching branches, HEAD among them if it matches
  }
  const revs = [], unnamed = [];
  for (const value of values) {
    const spec = value.replace(/^\+/, '');
    if (spec === ':') { revs.push(MATCHING); continue; }
    const src = spec.split(':')[0];
    if (src === '' || src.startsWith('^')) continue;
    if (isLiteral(src)) revs.push(src);
    else unnamed.push(value);
  }
  return { name, revs, unnamed, named: !unnamed.length };
}

/** The revisions with MATCHING turned into refs/heads/<branch> for each local branch the remote has. */
function expandMatching(repo, remote, revs) {
  if (!revs.includes(MATCHING)) return revs;
  const prefix = `refs/remotes/${remote}/`;
  const names = refs => (tryGit(repo, 'for-each-ref', '--format=%(refname)', refs) ?? '').split('\n').filter(Boolean);
  const theirs = new Set(names(prefix).map(r => r.slice(prefix.length)));
  const matching = names('refs/heads/').map(r => r.slice('refs/heads/'.length)).filter(b => theirs.has(b)).map(b => `refs/heads/${b}`);
  return [...revs.filter(r => r !== MATCHING), ...matching];
}

/**
 * The commits the push sends whose committer email is not on the key, oldest
 * last. A commit counts as sent when no remote-tracking branch has it. Commits
 * signed with another key are left out; the signature is read only for commits
 * whose email already fails, so a push of many clean branches reads no
 * signatures at all.
 */
function failingCommits(repo, rule, revs) {
  const tips = revs.filter(r => r.startsWith('--') || tryGit(repo, 'rev-parse', '--verify', '-q', `${r}^{commit}`));
  if (!tips.length) return [];
  const log = tryGit(repo, 'log', '--topo-order', '--format=%H%x1f%ce', ...tips, '--not', '--remotes');
  if (!log) return [];
  const suspects = log.split('\n').map(l => l.split('\x1f')).filter(([, ce]) => !allowed(ce, rule.emails)).map(([h]) => h);
  if (!suspects.length) return [];
  const detail = tryGit(repo, 'log', '--stdin', '--no-walk=unsorted',
                        '--format=%H%x1f%h%x1f%ce%x1f%G?%x1f%GK%x1f%GF%x1f%GP%x1f%s', { input: suspects.join('\n') });
  if (!detail) return [];
  const failing = [];
  for (const line of detail.split('\n')) {
    const [full, hash, committer, status, gk, gf, gp, subject] = line.split('\x1f');
    const ours = [gk, gf, gp].some(id => id && rule.ids.has(id.toUpperCase()));
    if (status === 'N' || ours) failing.push({ full, hash, committer, subject });
  }
  return failing;
}

/**
 * The repair lines for failing commits. One failing commit at HEAD is amended.
 * Otherwise a rebase from the parent of the oldest failing commit rewrites
 * them, unless that range holds a merge: a rebase would drop the merge and
 * rewrite the commits it merged in, so those are repaired by hand. An amend
 * takes its committer from user.email and keeps the author, and only the
 * committer is checked, so every commit keeps the author it had. --allow-empty
 * keeps an amend from stopping on an empty commit, which the team makes to
 * start a Jenkins build again.
 */
function repairSteps(repo, rule, failing) {
  const lines = [];
  const current = gitConfig(repo, 'user.email');
  if (!current || !allowed(current, rule.emails)) {
    lines.push(`user.email is ${current ?? 'not set'}. Set it to ${rule.emails.join(' or ')} ` +
               `where the wrong value is set (git config --show-origin --get user.email names the file).`);
  }
  const oldest = failing.at(-1).full;
  const base = tryGit(repo, 'rev-parse', '--verify', '-q', '--short', `${oldest}^`) ?? '--root';
  if (failing.length === 1 && oldest === tryGit(repo, 'rev-parse', 'HEAD')) {
    lines.push(`git commit --amend --no-edit --allow-empty`);
  } else if (tryGit(repo, 'rev-list', '--stdin', '^HEAD', { input: failing.map(k => k.full).join('\n') })) {
    lines.push(`Some of these commits are not on the checked-out branch. Check out the branch that holds them ` +
               `(git branch --contains <hash> names it) and repair them there.`);
  } else if (tryGit(repo, 'rev-list', '--merges', base === '--root' ? 'HEAD' : `${base}..HEAD`)) {
    lines.push(`The commits from ${base} to HEAD include a merge, so no rebase is suggested: a rebase would drop ` +
               `the merge and rewrite the commits it merged in. Repair these commits by hand.`);
  } else {
    lines.push(`git rebase --exec 'git commit --amend --no-edit --allow-empty' ${base}`);
  }
  return lines;
}

const WHY = (repo, rule) =>
  `!! ${repo} signs commits with GPG key ${rule.key}. Commits signed with ${rule.key} must carry a ` +
  `committer email that is a UID email of that key — one of: ${rule.emails.join(', ')} — or GitHub ` +
  `will not mark them verified, and a repository that requires verified signatures rejects the ` +
  `push with "Commits must have verified signatures".`;

function configRefusal(change, repo, rule, after) {
  if (change.unset) {
    const scope = change.scope === 'file' ? '' : ` --${change.scope}`;
    return `!! REFUSED: this removes user.email while commits are signed.\n${WHY(repo, rule)}\n\n` +
           (['local', 'worktree'].includes(change.scope)
             ? `After the removal the address that applies would be ${after ?? 'none'}, which is not on the key. `
             : '') +
           `Set it instead: git config${scope} user.email ${rule.emails.join(' or ')}`;
  }
  const what = change.set === null
    ? 'sets user.email to a value the command text does not show'
    : `sets user.email to ${change.set}, which is not an email on the signing key`;
  return `!! REFUSED: this ${what}.\n${WHY(repo, rule)}\n` +
         `!! user.email set with --global changes every repository and worktree on this machine.\n\n` +
         `Set it only to one of: ${rule.emails.join(', ')}` +
         (change.set === null ? ', written out in the command.' : '.');
}

function pushRefusal(repo, rule, failing) {
  const n = failing.length;
  const lines = [
    `!! PUSH REFUSED: ${n} commit${n > 1 ? 's' : ''} this push sends ha${n > 1 ? 've' : 's'} a committer email that is not on the signing key.`,
    WHY(repo, rule),
    '',
    'Commits that fail:'
  ];
  for (const k of failing) lines.push(`  ${k.hash}  ${k.subject}  (committer ${k.committer})`);
  lines.push('', 'Repair, then push again:');
  repairSteps(repo, rule, failing).forEach((l, i) => lines.push(`  ${i + 1}. ${l}`));
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
      // --global and --system change the address for every repository that has no
      // scope of its own set, so they are checked against the global signing key,
      // not this repository's (which may sign with a different local key, or not
      // sign at all while the global key still applies elsewhere).
      const ruleScope = ['global', 'system'].includes(change.scope) ? ['--global'] : [];
      const rule = identityRule(where, ruleScope);
      if (!rule) continue;
      if (change.set && allowed(change.set, rule.emails)) continue;
      let after = null;
      if (change.unset && ['local', 'worktree'].includes(change.scope)) {
        after = emailAfterRemoval(where, change.scope);
        if (after && allowed(after, rule.emails)) continue;
      }
      return configRefusal(change, where, rule, after);
    }

    if (!repo) continue;
    const target = pushTargets(c.args);
    if (!target.sends) continue;
    const rule = identityRule(repo);
    if (!rule) continue;
    const words = pushWords(c.args);
    const configured = configuredPush(repo, words);
    // with named values or matching git sends only revs; an unnamed value may send HEAD too
    const revs = new Set([...(configured.named ? [] : target.revs), ...configured.revs]);
    const failing = failingCommits(repo, rule, expandMatching(repo, pushRemote(repo, words.remote), [...revs]));
    if (failing.length) return pushRefusal(repo, rule, failing);
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
