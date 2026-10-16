#!/usr/bin/env node
/**
 * Merge an approved GitHub PR with a merge commit whose subject starts with the PR's work ID.
 *
 * Usage: merge-pr.mjs <PR URL> [--work-id <ID>] [--dry-run]
 * Exit:  0 merged (or dry run), 2 refused (REFUSED: line), 1 could not run (ERROR: line).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORK_ID = /^[A-Z]+-[0-9]+(-[A-Z]{2})?$/;
const TITLE_ID = /^@([A-Z]+-[0-9]+(?:-[A-Z]{2})?):/;
const TITLES = ['MERGE_MESSAGE', 'PR_TITLE'];
const MESSAGES = ['PR_TITLE', 'PR_BODY', 'BLANK'];

/** The work ID a PR title starts with, or null. */
export function workIdFromTitle(title) {
  const m = TITLE_ID.exec(title ?? '');
  return m ? m[1] : null;
}

/**
 * The merge commit subject and body.
 * settings: { merge_commit_title, merge_commit_message } from the repository; null or unknown values give
 * GitHub's classic default (MERGE_MESSAGE / PR_TITLE).
 */
export function buildMessage({ title, body, number, headOwner, headRef, settings, workId }) {
  const t = TITLES.includes(settings?.merge_commit_title) ? settings.merge_commit_title : null;
  const m = MESSAGES.includes(settings?.merge_commit_message) ? settings.merge_commit_message : null;
  const [titleKind, messageKind] = t && m ? [t, m] : ['MERGE_MESSAGE', 'PR_TITLE'];
  const base = titleKind === 'PR_TITLE' ? title : `Merge pull request #${number} from ${headOwner}/${headRef}`;
  const subject = base.startsWith(`@${workId}:`) ? base : `@${workId}: ${base}`;
  const text = messageKind === 'PR_TITLE' ? title : messageKind === 'PR_BODY' ? (body ?? '') : '';
  return { subject, body: text };
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr || r.error?.message || '').trim() };
}

const fail = (code, line) => { console.log(line); process.exit(code); };

function main(argv) {
  let url = null, workId = null, dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dry = true;
    else if (argv[i] === '--work-id') workId = argv[++i] ?? '';
    else if (!url) url = argv[i];
    else fail(1, `ERROR: unexpected argument ${argv[i]}`);
  }
  if (!url) fail(1, 'ERROR: usage: merge-pr.mjs <PR URL> [--work-id <ID>] [--dry-run]');
  if (workId !== null && !WORK_ID.test(workId)) fail(2, `REFUSED: invalid work ID "${workId}" — expected the shape ABC-123 or ABC-123-UK`);
  const loc = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
  if (!loc) fail(1, `ERROR: not a pull request URL: ${url}`);

  const view = gh(['pr', 'view', url, '--json',
    'number,title,body,state,isDraft,reviewDecision,headRefName,headRefOid,headRepositoryOwner,url']);
  if (!view.ok) fail(1, `ERROR: gh pr view failed: ${view.err}`);
  let pr;
  try { pr = JSON.parse(view.out); } catch { fail(1, 'ERROR: gh pr view returned unreadable output'); }

  if (pr.state !== 'OPEN') fail(2, `REFUSED: PR #${pr.number} is not open (state ${pr.state})`);
  if (pr.isDraft) fail(2, `REFUSED: PR #${pr.number} is a draft`);
  if (pr.reviewDecision !== 'APPROVED') fail(2, `REFUSED: PR #${pr.number} is not approved (review decision ${pr.reviewDecision || 'none'})`);
  const titleId = workIdFromTitle(pr.title);
  const id = titleId ?? workId;
  if (!id) fail(2, 'REFUSED: no work ID — the PR title has no @WORK-ID: prefix');
  if (titleId && workId && workId !== titleId) console.log(`NOTE: --work-id ${workId} was ignored because the title carries ${titleId}`);

  let settings = null;
  const repo = gh(['api', '--hostname', loc[1], `repos/${loc[2]}/${loc[3]}`]);
  if (repo.ok) { try { settings = JSON.parse(repo.out); } catch { settings = null; } }

  const msg = buildMessage({
    title: pr.title, body: pr.body, number: pr.number,
    headOwner: pr.headRepositoryOwner?.login ?? loc[2], headRef: pr.headRefName, settings, workId: id
  });

  if (dry) {
    console.log(`Subject: ${msg.subject}`);
    console.log(`Body: ${msg.body}`);
    return;
  }

  const merge = gh(['pr', 'merge', url, '--merge', '--subject', msg.subject, '--body', msg.body,
    '--match-head-commit', pr.headRefOid]);
  if (!merge.ok) fail(1, `ERROR: gh pr merge failed: ${merge.err}`);

  let sha = '', state = '';
  const after = gh(['pr', 'view', url, '--json', 'mergeCommit,state']);
  if (after.ok) { try { const j = JSON.parse(after.out); sha = j.mergeCommit?.oid ?? ''; state = j.state ?? ''; } catch { /* keep blanks */ } }
  if (state === 'MERGED') {
    console.log(`Merged: ${msg.subject}`);
    console.log(`SHA: ${sha || 'unknown'}`);
  } else {
    console.log(`Queued: ${msg.subject}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
