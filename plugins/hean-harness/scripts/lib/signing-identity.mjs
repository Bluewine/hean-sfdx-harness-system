/**
 * Reads which email addresses a repository's commits may carry, when its
 * commits are signed.
 *
 * GitHub marks a signed commit verified only when its author and committer
 * emails are UID emails of the signing key. A repository that requires verified
 * signatures rejects the push of any other commit, and the rejection comes
 * after the commits exist, so every one of them has to be rewritten.
 * user.email usually lives in ~/.gitconfig, which every repository and
 * worktree on the machine shares: one wrong global value breaks them all.
 *
 * Shared by hooks/git-identity-guard.mjs, which refuses the commands that cause
 * that, and the doctor's environment check, which reports it.
 *
 * Every read returns null instead of throwing. The key is read with
 * `gpg --list-keys`, a public-key read that needs no passphrase or agent.
 */

import { execFileSync } from 'node:child_process';

const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 };

/** One git config value, or null when unset or unreadable. scope is e.g. ['--global'], or [] for the effective value. */
export function gitConfig(dir, key, scope = [], type = []) {
  try {
    return execFileSync('git', [...(dir ? ['-C', dir] : []), 'config', ...scope, ...type, '--get', key], quiet).trim() || null;
  } catch { return null; }
}

/**
 * The signing key when commits are signed, or null when they are not.
 * Signed means commit.gpgsign is true and user.signingkey is set.
 * dir is the repository (null for outside one); scope narrows the read.
 */
export function signingKey(dir, scope = []) {
  if (gitConfig(dir, 'commit.gpgsign', scope, ['--type=bool']) !== 'true') return null;
  return gitConfig(dir, 'user.signingkey', scope);
}

/**
 * The UID emails of a key, lower-cased, or null when gpg is missing, the key is
 * not in the keyring, or it has no email. Revoked UIDs are left out, because
 * GitHub does not verify against them.
 */
export function keyEmails(key) {
  let out;
  try { out = execFileSync('gpg', ['--batch', '--list-keys', '--with-colons', key], quiet); } catch { return null; }
  const emails = new Set();
  for (const line of out.split('\n')) {
    const f = line.split(':');
    if (f[0] !== 'uid' || f[1] === 'r') continue;
    const m = /<([^>]+)>/.exec(f[9] ?? '');
    if (m) emails.add(m[1].trim().toLowerCase());
  }
  return emails.size ? [...emails] : null;
}

/** Is this address one of the allowed emails? Compared without regard to case. */
export const allowed = (email, emails) => emails.includes(String(email).trim().toLowerCase());

/**
 * The signing key and its emails for a repository, or null when commits there
 * are not signed or the key cannot be read.
 */
export function identityRule(dir, scope = []) {
  const key = signingKey(dir, scope);
  if (!key) return null;
  const emails = keyEmails(key);
  return emails ? { key, emails } : null;
}
