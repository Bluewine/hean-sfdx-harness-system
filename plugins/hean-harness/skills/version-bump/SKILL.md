---
name: version-bump
description: Post-UAT housekeeping on the integration branch — raises the package.json release version by one and deletes every spent runbook script, staged class, and destructive-change entry outside a fixed keep-list and whatever the user holds back, then opens the Update Release Version PR
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

You are executing the `/version-bump` skill. Work through the phases in order.

## Trigger

Run this after a UAT deployment PR (integration into a release branch) has **merged**. Nothing before that merge requires it.

Do not run this skill for a hotfix. A hotfix lands on the release branch first and returns through a branch suffixed `-BM`; that is a different job.

## The two jobs

**Raise the version.** One number in `package.json` goes up by one.

**Retire spent runbook items.** A runbook is a one-time instruction that runs around a deployment. The deployment has happened, so the instruction has served its purpose and becomes clutter that misleads the next reader.

Both jobs run every cycle.

## Branch topology

| Branch | Environment |
|---|---|
| `integration` | QA |
| `release` | UAT |
| `master` | Production |

Read this mapping from `deploy-config.yml` rather than assuming it; a repository that renames its branches still works if you re-read the file.

**Cut the branch from `integration` and target `integration`.** The release branch is never the base and never the head.

**Never merge the release branch into this branch.** Merging release into a working branch belongs to the hotfix back-merge procedure, whose branches carry a `-BM` suffix. A normal UAT deployment moves content one way only, so the release branch holds nothing the integration branch lacks. Confirm that before assuming otherwise:

```bash
git diff --stat origin/{RELEASE} origin/{INTEGRATION}
```

Empty output means there is nothing to back-merge. Non-empty output means a hotfix bypassed integration — stop, and run the hotfix back-merge procedure first.

**Refresh from `integration` only**, and only when the branch has been open long enough for other work to land:

```bash
git fetch origin
git merge origin/{INTEGRATION}
```

## Phase 1 — Confirm the trigger and read the inputs

```bash
git fetch origin
gh pr list --base {RELEASE} --state merged --limit 5 --json number,title,mergedAt
```

Take from the most recent merged deployment PR:

- `UAT_PR_NUMBER` and `UAT_PR_TITLE` — quoted in the PR body so a reader can trace which deployment triggered this.
- `MERGE_DATE` as `YYYY-MM-DD`.
- `DEPLOY_DATE` as `YYYY.MM.DD`, taken from the deployment PR's title, not from today's clock. The two differ whenever a deployment is scheduled ahead.

Read the current version:

```bash
git show origin/{INTEGRATION}:package.json | grep '"version"'
```

`OLD_VERSION` is that value. `NEW_VERSION` increments its final segment by one.

## Phase 2 — Create the branch

Use the exact name `work-updateVersion`. It carries no work ID by design and has been reused every cycle for a year.

**Because the name is reused, last cycle's branch is usually still on your machine**, and `git checkout -b` fails with `a branch named 'work-updateVersion' already exists`. Confirm the stale branch is fully merged, then replace it — never reuse it in place, because its old commits would ride along into this cycle's PR:

```bash
git merge-base --is-ancestor work-updateVersion origin/{INTEGRATION} && git branch -D work-updateVersion
```

The check and the delete are chained deliberately: if the stale branch holds anything not yet in the integration branch, the delete does not run. Investigate that case rather than forcing it — an unmerged commit there means a previous cycle never landed.

Then cut the branch straight from the fetched remote ref:

```bash
git checkout -b work-updateVersion origin/{INTEGRATION}
```

## Phase 3 — Raise the version

Edit one line in `package.json`:

```json
"version": "{NEW_VERSION}",
```

Change nothing else in that file. A correct diff is one insertion and one deletion.

```bash
git add package.json
git commit -m "@{WORK_ID}: Update Release Version to v{NEW_VERSION}"
```

**On the commit message prefix.** Historic commits read `Update Release Version` with no prefix. That form no longer passes: a work item reference is required, as `.claude/rules/commit-message-format.md` sets out and a hook enforces before every commit. A repository may also run its own `commit-msg` hook with a stricter pattern of its own:

```bash
git config core.hooksPath
```

A path means there is a second check to satisfy — read that hook before choosing a message. Either way, ask which work item to use rather than inventing an ID, and never reach for `--no-verify` to get around either check.

## Phase 4 — Build the delete-list and confirm it

**Every spent runbook item goes. Only two things are exempt: the keep-list below, and whatever the user holds back in the confirmation at the end of this phase.** There is no per-item judgement of your own.

**Deleting now cannot stop the item reaching production, and this is the point people get wrong.** The release branch already holds the item and delivers it to production on the next release-to-production merge. The deletion made here reaches the release branch only on the *following* UAT deployment, and production one merge after that. So an item removed today still runs in production on schedule.

Do not reason about whether an item has appeared on the production branch yet. That test looks careful and is wrong — it holds spent runbooks in the repository for an extra cycle for no benefit.

**The keep-list. Never delete these, and never raise them for discussion:**

| Path | |
|---|---|
| `runbooks/pre-deploy/apex/00_predeployApexScript.apex` | entry point |
| `runbooks/post-deploy/apex/00_postdeployApexScript.apex` | entry point |
| `runbooks/post-deploy/apex/01_sampleDataSetup.apex` | sample script |
| `runbooks/post-deploy/apex/02_sampleConfigSetup.apex` | sample script |
| `runbooks/pre-deploy/metaData/classes/SampleDeployment.cls` | sample class, with its `.cls-meta.xml` |
| `runbooks/post-deploy/metaData/classes/SampleDeployment.cls` | sample class, with its `.cls-meta.xml` |
| `runbooks/post-deploy/metaData/classes/SampleDataSetup.cls` | sample class, with its `.cls-meta.xml` |
| `<members>SampleDeployment</members>` in `destructiveChangesPost.xml` | pairs with the kept class |
| `<members>SampleDataSetup</members>` in `destructiveChangesPost.xml` | pairs with the kept class |
| every `.keep` file | holds an empty directory open |

These exist to show the shape of a runbook to whoever writes the next one. They are not spent work and they are not reviewed each cycle.

`SampleDeployment` and `SampleDataSetup` stand for whichever permanent samples the project
keeps. Read the current keep-list from the repository rather than assuming these names.

**A sample is a triad, and all three legs stay together.** A script calls a class, the class is staged under `metaData/classes/`, and a destructive-change entry removes that class from the org afterwards. Deleting any one leg leaves a sample that no longer demonstrates the full lifecycle — and deleting the class while its script survives breaks the deployment outright. `01_sampleDataSetup.apex`, `SampleDataSetup`, and that class's destructive-change entry are one such triad.

**A kept script may also call classes under `force-app/`.** Those are product code, not runbook staging, and have nothing to do with this cleanup — leave them alone whatever the script references.

**Container files are edited, never deleted.** Deleting one breaks the deployment pipeline, which expects them to exist even when empty:

- `deletePackage/pre/destructiveChangesPre.xml` and `deletePackage/post/destructiveChangesPost.xml` — remove entries from inside; an empty file keeps only its `<Package>` and `<version>` lines
- `deletePackage/pre/package.xml` and `deletePackage/post/package.xml`
- `runbooks/pre-deploy/sf/commands.txt` and `runbooks/post-deploy/sf/commands.txt` — remove lines from inside

**Everything else under `runbooks/` and `deletePackage/` is a deletion candidate.** List what is present and subtract the keep-list and the container files:

```bash
git ls-tree -r --name-only origin/{INTEGRATION} | grep -E '^(runbooks|deletePackage)/'
```

**Check every candidate class for inbound references before proposing it.** A keep-list script may call a class on your candidate list, and deleting it would break the deployment:

```bash
grep -rn "{CLASS_NAME}" runbooks/
```

A hit inside a keep-list script is a conflict, and it means the keep-list is incomplete: a sample triad has a leg missing. Carry it into the confirmation below rather than resolving it yourself, and propose adding the class and its destructive-change entry to the keep-list rather than deleting them. Ignore hits that resolve to `force-app/` classes.

### The confirmation

**One message, at the end of this phase, before anything is deleted.** It carries the whole delete-list, every reference conflict found, and one question:

> Due for deletion this cycle: {LIST}
> {CONFLICTS, each naming the keep-list script and the class it calls}
> Hold any of these back? If so, which, and why in one line each?

Do not split this into several messages, and do not raise a conflict later during Phase 5 — by then the user has already answered and will be asked twice about the same cycle.

**Never decide a hold-back yourself.** A hold-back is the user's call about work you cannot see — a script that has not finished running, a class another team still needs, a deletion pending an approval elsewhere. You have no way to know any of that from the repository, and a hold-back you invent silently keeps spent code alive for another cycle.

**Use the user's own words as the reason.** Write what they said into the PR body's Held Back block. Do not rewrite it into your own justification, do not add reasoning they did not give, and do not supply a reason for an item they named without one — ask again instead.

An empty answer means delete the whole list, and the Held Back block is omitted.

## Phase 5 — Delete completely

Delete every candidate the user did not hold back. No further questions arise here; Phase 4 settled them.

An item has up to five parts, and a partial removal leaves a broken reference. Delete all of them together:

1. The script — `runbooks/{pre|post}-deploy/apex/{NN}_{name}.apex`, or under `sf/`
2. Its supporting code — the matching `.cls` **and** `.cls-meta.xml` under `runbooks/{pre|post}-deploy/metaData/classes/`
3. Any other staged metadata under `runbooks/{pre|post}-deploy/metaData/` — flows, flow definitions, prompt templates
4. Its entry in `deletePackage/post/destructiveChangesPost.xml` or `deletePackage/pre/destructiveChangesPre.xml`
5. Any line naming it in `runbooks/{pre|post}-deploy/sf/commands.txt`

**Removing an entry from a `<types>` block.** Drop the whole block when no member survives. Drop only the one `<members>` line when other members remain, because the surviving members still need their block:

```xml
    <types>
        <members>SampleDeployment</members>
        <members>SampleDataSetup</members>
        <name>ApexClass</name>
    </types>
```

Commit the removal separately from the version bump, naming the deployment that introduced the
items. `{DEPLOY_NAME}` is whatever that deployment is called in this project — read it from the
release branch or the deployment config rather than inventing one:

```bash
git add -A
git commit -m "@{WORK_ID}: Deprecate Runbook from UAT Deployment {DEPLOY_NAME}"
```

Two commits, in this order, keep the diff readable: the version bump, then the cleanup.

## Phase 6 — Write the PR body

Render `templates/pr-body.md`, dropping any block whose HTML comment says to omit it.

**The body names two things and nothing else: what you deleted, and what the user held back with their stated reason.** Keep-list files appear in neither — they are permanent, so naming them adds noise to every PR forever.

Write the file with a shell heredoc, never the Write tool, and quote the delimiter:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$REPO_ROOT/.claude/skills/version-bump/output"
cat > "$REPO_ROOT/.claude/skills/version-bump/output/version-{NEW_VERSION}.md" << 'BODY'
{RENDERED_TEMPLATE}
BODY
```

Show the rendered body and wait for an explicit `yes` before Phase 7. Anything else is a revision request: apply it, rewrite the file, show it again, wait again. Confirming an input is answering a question, not approving the publish.

## Phase 7 — Open the PR

```bash
gh pr create \
  --base {INTEGRATION} \
  --head work-updateVersion \
  --title "Update Release Version to v{NEW_VERSION}" \
  --body-file "$REPO_ROOT/.claude/skills/version-bump/output/version-{NEW_VERSION}.md" \
  --draft
```

The title form `Update Release Version to v{NEW_VERSION}` has held for every cycle on record. Keep it.

Open as a draft unless the request says otherwise. Report the returned URL. Do not merge — this skill prepares the PR and stops.

## Verification

Confirm each against real output, not intent:

- `git diff {INTEGRATION} --stat` shows `package.json` with exactly one insertion and one deletion.
- Every other changed path sits under `runbooks/` or `deletePackage/`.
- No keep-list path and no container file appears in the diff as deleted.
- Every candidate left behind was named by the user in the Phase 4 confirmation.
- `grep -rn` finds no reference from a surviving script to a deleted class.
- The PR body lists every deletion, and every hold-back carries the user's own wording.
- `git log --oneline {INTEGRATION}..HEAD` lists the version commit first, the cleanup commit second.
- The PR base is the integration branch.
- `gh pr create` returned a URL.

## Common mistakes

| Mistake | Correction |
|---|---|
| Item held back because it is not yet on the production branch | The release branch delivers it to production independently; delete it now |
| Per-item judgement applied to the cleanup | Only the keep-list is exempt; the user decides everything else |
| Keep-list file deleted | The list is fixed and does not change between cycles |
| Keep-list file raised in the confirmation | It is permanent; never put it up for discussion |
| Container file deleted instead of emptied | `deletePackage/` XML and `commands.txt` are edited in place |
| One leg of a sample triad deleted | Script, class, and destructive-change entry stay together |
| `force-app/` class treated as a runbook dependency | It is product code; only `metaData/classes/` staging counts |
| Hold-back decided without asking | Ask every cycle; a hold-back is the user's call, never yours |
| Hold-back reason written in your own words | Use the user's wording verbatim; ask again if they gave none |
| Reference conflict raised after the confirmation | Grep during Phase 4 so one message carries every open item |
| Kept files listed in the PR body | Name deletions and hold-backs only |
| Release branch merged into the version branch | That is the hotfix back-merge procedure; refresh from integration instead |
| PR targeted at the release branch | The base is integration |
| Branch renamed after a ticket | The name is `work-updateVersion` every cycle |
| Last cycle's `work-updateVersion` reused in place | Confirm it is merged, delete it, cut a fresh one from the integration branch |
| Only the script deleted | Remove all five parts, including the destructive-change entry |
| Whole `<types>` block dropped when members survive | Remove the single `<members>` line instead |
| Version taken from a tag or branch name | It lives in `package.json` |
| Deploy date read from today's clock | Take it from the deployment PR title |
| Historic unprefixed commit message copied blindly | A work ID is required; check `core.hooksPath` for a second, stricter hook too |
| `--no-verify` used to bypass the hook | Ask which work ID to use instead |
| Both jobs squashed into one commit | Version bump first, cleanup second |
| PR opened without showing the body | Render, wait for `yes`, then submit |
