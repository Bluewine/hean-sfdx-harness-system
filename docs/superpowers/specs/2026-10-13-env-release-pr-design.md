# `env-release-pr`: one release PR skill for UAT and Production

## Context

`/hean-harness:release-pr` opens or updates the UAT deployment PR (`integration` → `release`). Its own text
names the Production Release PR (`release` → `master`) as "not this skill", and `create-pr` takes only story
PRs. So no skill covers a production release. Sessions asked to open one improvise: one copied the
previous production PR's 3-column body, another wrote a one-line body linking the UAT PR it carried. Earlier
production PRs in the same team vary between 3 columns, 4 columns, a list of PR links and a lone runlist link.
The user wants production PRs to use the UAT body contract.

## Goals

- One skill, `env-release-pr`, covers both the UAT deployment PR and the Production Release PR.
- The skill decides the kind from the request when the request settles it, and asks otherwise: the user
  when it can, the calling agent when it runs inside a subagent.
- Both kinds produce the same body: the 4-column story table and the Runlist line.
- Frontmatter trigger phrases route every release PR request to the new skill.

## Non-goals

- Changing `release-pr`'s content. It is turned off by a rename and stays byte-for-byte as it is, so the user
  can compare and turn it back on.
- Choosing an assignee or reviewers on the skill's own judgement. Release champions lead UAT and Production
  releases, while any developer may open the PR, so the skill never assigns the person running it. It passes
  only the people the requester names (see "Assignees and reviewers").
- A PR `uat-hotfix` opens or edits as one of its own steps. A UAT hotfix re-deploy requested outside
  `uat-hotfix` (`hotfix-{ID}` → `release`) stays in scope, as the kind table shows.
- Merging any PR.

## Files

- **Rename:** `plugins/hean-harness/skills/release-pr/SKILL.md` → `SKILL.mdx`. No content change. Claude Code
  loads only `SKILL.md`, as with `sync-to-branch` and `commit-walk-sync`.
- **New:** `plugins/hean-harness/skills/env-release-pr/SKILL.md`, written as if `release-pr` did not exist.
  It carries every phase and rule of `release-pr` (output contract, architecture rule, ref freshness check,
  owning-commit test, how-it-reached-`BASE` test, Linear and sprint resolution, ordering, one consolidated
  checkpoint, review file and `yes` gate, open or update, worktree wind-up, verification list, common
  mistakes), with the changes below.
- **Reference swaps:**

  | File | Change |
  |---|---|
  | `skills/create-pr/SKILL.md` description and line 9 | exception list names `env-release-pr` instead of `release-pr` |
  | `skills/update-pr/SKILL.md:8` | same |
  | `skills/open-work-report/SKILL.md` lines 10, 12, 64, 80, 112 | `/release-pr` → `/hean-harness:env-release-pr` |
  | `skills/open-work-report/scripts/open-work.mjs:72` (comment) | same |
  | `skills/open-work-report/__tests__/verify-open-work.mjs:21` (comment) | same |
  | `skills/org-roles/SKILL.md:46` | example skill name |
  | `assets/rules/project/linear-story-resolution.md` `paths:` | add `**/skills/env-release-pr/**`; keep the `release-pr` entry |
  | `docs/wiki-coverage.md` | `release-pr` row → `excluded (turned off, SKILL.mdx)`; new row `env-release-pr \| Skills \| pending` until the wiki entry lands at release |

- **Version:** `plugins/hean-harness/.claude-plugin/plugin.json` → `0.1.51`, own commit, tag
  `hean-harness-v0.1.51`.

## Frontmatter

```yaml
---
name: env-release-pr
description: Release-train deployment PR for either environment — UAT (integration into release) or Production (release into master) — dedupes the commit range into one row per Linear story with title, assignee and sprint, names hotfix-deployed stories out loud, then opens or updates the PR
when_to_use: Any request to open, create, raise, draft, refresh or update a deployment PR between the long-lived branches — "UAT deployment PR", "UAT Deployment {PROJECT}.{date}", "Production Release PR", "prod release", "open the release PR into master", "merge release into master", "deploy integration to UAT", "update the release PR body" — and any agent that needs one, passing uat or prod. Not for story PRs from work-* or hotfix-* into integration, which create-pr opens, nor a PR uat-hotfix opens or edits as one of its own steps.
argument-hint: "[uat|prod] [PR number] [--assignee <login>] [--reviewer <login>]"
arguments: [kind, pr]
---
```

`when_to_use` is appended to `description` in the skill listing; the two together must stay under Claude
Code's 1,536-character listing cap. Shipped text names no client project.

## Deciding the kind

The first rule that decides wins:

1. **Argument.** `$kind` is `uat`, `prod` or `production`. Any other value decides nothing.
2. **Existing PR.** The request names a PR by number (`$pr` or in the words) or by title: `gh pr view` its
   `baseRefName`. `release` → UAT, `master` → Production. A PR whose base is neither stops the run with that
   fact.
3. **Request words.** "UAT" → UAT. "prod", "production" or "master" → Production. Words for both, or for
   neither, decide nothing. "release" alone decides nothing: it appears in "Production Release" and is the
   UAT base branch.
4. **Ask.** One question: "UAT (`integration` → `release`) or Production (`release` → `master`)?"
   - `AskUserQuestion` is in the tool list → ask the user with it.
   - `AskUserQuestion` is not in the tool list → the skill runs inside a subagent (Claude Code removes that
     tool from every subagent). Stop before any git or GitHub call and return exactly:
     `needs input: kind — uat (integration → release) or prod (release → master)`.

Never decide the kind from the current branch, which PRs are open, the calendar or release cadence, or an
earlier PR's body. The checkpoint states the kind and both branches every run, including when the request
decided it.

When the kind and an existing PR disagree (`prod` given, PR base is `release`), stop and report both; do not
pick one.

## What differs by kind

| | UAT | Production |
|---|---|---|
| `BASE` | `release` | `master` |
| `HEAD` | `integration`; `hotfix-{ID}` for a hotfix re-deploy | always `release` |
| Title stem source | `gh pr list --base release --state all --limit 20` | `gh pr list --base master --state all --limit 20` |
| Identical title already exists | append ` (Fixes)`, then ` (Extra Fixes)` | list the suffixes the repository's earlier production titles used and ask which to append |
| Body file | `.claude/skills/env-release-pr/output/uat-{DEPLOY_DATE}.md` | `.claude/skills/env-release-pr/output/production-{DEPLOY_DATE}.md` |

Everything else is the same for both kinds:

- **Body contract:** `Work ID | Subject | Assignee | Sprint`, separator `-- | -- | -- | -- |`, one row per
  story, blank line, `[Runlist]({RUNLIST_URL})`.
- **`DEPLOY_DATE` and `RUNLIST_URL`:** asked at the checkpoint, never computed or copied from another
  deployment; in update mode taken from the existing PR's title and body.
- **How-it-reached-`BASE` test:** unchanged with `BASE` substituted. For Production, a story whose hotfix
  reached `master` through an earlier production release and whose copy-back commit only now reaches
  `release` matches the hotfix case, and the closing report names it.
- **Create mode:** `gh pr create --base {BASE} --head {HEAD} --title … --body-file …`, plus the people flags
  below. This differs from `release-pr`, which always assigned `@me`.
- **Update mode:** `gh pr edit` with `--body-file`, plus the people flags below. Existing assignees and reviewers
  are never removed.
- **Attribution check** on the body file before every submit, as in `release-pr`.

## Assignees and reviewers

- **Default:** none. The skill never adds `--assignee`, `--reviewer`, `--add-assignee` or `--add-reviewer` on its
  own, and never assigns `@me` because the person running it opened the PR.
- **Sources, and the only ones:** `--assignee <login>` and `--reviewer <login>` in the skill arguments (repeatable;
  a comma-separated list also works), or the requester's own words naming who to assign or ask for review
  ("assign it to <login>", "request review from <login>"). The requester is the user or the agent that called the
  skill. `@me` is passed only when the requester writes `@me` or asks to be assigned.
- **Never taken from:** earlier release PRs, CODEOWNERS, commit authors, Linear assignees, or the GitHub account
  running the session.
- **Checkpoint:** the found-context block shows `People` — the named assignees and reviewers, or `none`.
- **Create mode:** one `--assignee <login>` per named assignee and one `--reviewer <login>` per named reviewer.
- **Update mode:** one `--add-assignee <login>` per named assignee and one `--add-reviewer <login>` per named
  reviewer. Never `--remove-assignee` or `--remove-reviewer`.
- **Arguments:** `$pr` counts as a PR number only when it is all digits, so `/hean-harness:env-release-pr prod
  --assignee <login>` does not read `--assignee` as a PR.

## Verification

1. **Routing.** Headless sessions (`claude -p … --plugin-dir plugins/hean-harness`) in a throwaway git
   repository with no GitHub remote. Each run stops at the ref freshness check, so nothing reaches GitHub.
   Check which skill loaded and how the kind was settled:
   - "open the Production Release PR" → `env-release-pr`, Production, no question.
   - "open the UAT deployment PR" → `env-release-pr`, UAT, no question.
   - "open the release PR" → `env-release-pr`, the kind question.
   - the vague request sent through a subagent → the `needs input: kind …` line, no question.
   - `release-pr` never loads.
2. **Listing length.** `description` plus `when_to_use` is under 1,536 characters.
3. **Full test loop** passes (the `open-work-report` files change only in comments), and no test process is
   left running.
4. **Real run** by the user in a client repository after the update, for example on an open Production
   Release PR.
