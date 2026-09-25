/**
 * Reads which email addresses a repository's commits may carry as committer,
 * when its commits are signed.
 *
 * GitHub marks a signed commit verified only when its committer email is a UID
 * email of the signing key. A repository that requires verified signatures
 * rejects the push of any other commit, and the rejection comes after the
 * commits exist, so every one of them has to be rewritten. user.email usually
 * lives in ~/.gitconfig, which every repository and worktree on the machine
 * shares: one wrong global value breaks them all.
 *
 * Shared by hooks/git-identity-guard.mjs, which refuses the commands that cause
 * that, and the doctor's environment check, which reports it.
 *
 * Only OpenPGP signing is read. The key is read with `--list-keys`, a public-key
 * read that needs no passphrase or agent, through the program git itself signs
 * with. Every read returns null instead of throwing.
 */

import { execFileSync } from 'node:child_process';

import { QUIET, tryGit } from './command-line.mjs';

/** One git config value, or null when unset or unreadable. scope is e.g. ['--global'], or [] for the effective value. */
export function gitConfig(dir, key, scope = [], type = []) {
  return tryGit(dir ?? '.', 'config', ...scope, ...type, '--get', key, { timeout: 4000 }) || null;
}

/**
 * The signing key and the program git signs with, or null when commits are not
 * signed with OpenPGP. Signed means commit.gpgsign is true and user.signingkey
 * is set; a gpg.format other than openpgp (ssh, x509) is not read.
 * dir is the repository (null for outside one); scope narrows the read.
 */
export function signingKey(dir, scope = []) {
  if (gitConfig(dir, 'commit.gpgsign', scope, ['--type=bool']) !== 'true') return null;
  const format = gitConfig(dir, 'gpg.format', scope);
  if (format && format !== 'openpgp') return null;
  const key = gitConfig(dir, 'user.signingkey', scope);
  if (!key) return null;
  const program = gitConfig(dir, 'gpg.openpgp.program', scope) ?? gitConfig(dir, 'gpg.program', scope) ?? 'gpg';
  return { key, program };
}

/**
 * The key's UID emails, lower-cased, and the ids of the key and its subkeys
 * (long key ids and fingerprints, upper-cased), or null when the program is
 * missing, the key is not in the keyring, or it has no email. Revoked UIDs are
 * left out, because GitHub does not verify against them.
 */
export function readKey({ key, program }) {
  let out;
  try { out = execFileSync(program, ['--batch', '--list-keys', '--with-colons', key], { ...QUIET, timeout: 4000 }); } catch { return null; }
  const emails = new Set();
  const ids = new Set();
  for (const line of out.split('\n')) {
    const f = line.split(':');
    if (f[0] === 'pub' || f[0] === 'sub') ids.add(f[4].toUpperCase());
    else if (f[0] === 'fpr') ids.add(f[9].toUpperCase());
    else if (f[0] === 'uid' && f[1] !== 'r') {
      const m = /<([^>]+)>/.exec(f[9] ?? '');
      if (m) emails.add(m[1].trim().toLowerCase());
    }
  }
  return emails.size ? { emails: [...emails], ids } : null;
}

/** Is this address one of the allowed emails? Compared without regard to case. */
export const allowed = (email, emails) => emails.includes(String(email).trim().toLowerCase());

/**
 * The signing key, its program, its emails and its ids for a repository, or
 * null when commits there are not signed with OpenPGP or the key cannot be read.
 */
export function identityRule(dir, scope = []) {
  const signing = signingKey(dir, scope);
  if (!signing) return null;
  const read = readKey(signing);
  return read ? { ...signing, ...read } : null;
}
