---
paths:
  - "runbooks/**"
  - "deletePackage/**"
---

# Runbook Deployment Steps

> `ACME_` stands in for whatever class prefix the project uses. Set one during setup and it
> is read from the project's local settings; leave it unset and no prefix is enforced.

Apply when adding or changing anything under `runbooks/` or `deletePackage/`, and when describing a change's deployment steps in a PR body.

## Stage mechanics

Each stage runs around the `force-app` deployment, in this order:

1. Convert `runbooks/<stage>-deploy/metaData/` and deploy the result
2. Run every `.apex` file under `runbooks/<stage>-deploy/apex/` in filename order
3. Apply `deletePackage/<stage>/destructiveChanges<Stage>.xml`

**Both stages share one conversion output folder, and it is not cleared between them.** Anything declared in `pre` must also exist in `post`, at minimum as an empty declaration, or `post`'s generated `package.xml` omits it and the deploy fails with "Not in package.xml". Declaring a transient component in one stage only avoids this entirely.

**Metadata under a stage's `metaData/` must be listed in that stage's destructive manifest**, so the transient component is removed again once it has run. The only exception is a component the user says to keep.

**`ACME_Deployment` is a shared placeholder. Never add, edit, or remove it.**

**A destructive entry naming a component absent from the target org does not fail the deploy.** Deprecating a component that predates the branch belongs in the post destructive manifest, alongside deleting it from the repo.

## Automatic rows

Derive one row per item the change touches. Every row's Mode is **Automatic**.

| What changed | What the row states | Stage |
|---|---|---|
| `runbooks/pre-deploy/apex/*.apex` | what the script does to the org | Pre |
| `runbooks/post-deploy/apex/*.apex` | what the script does to the org | Post |
| `runbooks/pre-deploy/metaData/**` | the component is deployed from the runbook, then removed again by `destructiveChangesPre.xml` in the same stage | Pre |
| `runbooks/post-deploy/metaData/**` | the component is deployed from the runbook, then removed again by `destructiveChangesPost.xml` in the same stage | Post |
| a `<members>` entry the change adds to `deletePackage/pre/destructiveChangesPre.xml` | the named component is deleted from the target org | Pre |
| a `<members>` entry the change adds to `deletePackage/post/destructiveChangesPost.xml` | the named component is deleted from the target org | Post |

Read a runbook script and the class it calls before describing it. State what it does to the org and whether re-running it is safe — never that a file exists.

Diff the destructive manifests against the merge base with the PR's base branch, so only entries the change itself adds are listed rather than entries an earlier release left in place. `{BASE}` is the base branch the running PR skill resolved; outside a PR skill it is `integration`:

```bash
MB=$(git merge-base origin/{BASE} HEAD)
git diff "$MB" HEAD -- deletePackage/
```

## Manual rows

Manual steps live outside the repo and cannot be derived from a diff. **Always ask which manual steps apply, the same way screenshots are asked for**, unless the user named them in their prompt — in which case use those verbatim. Never infer a manual step and render it unasked, and never render one the user declined. When the user gives a step without naming its stage, ask. Every manual row's Mode is **Manual**.

Manual steps a project needs repeatedly, to offer as candidates:

- **Cross-repo deploy order** — when several repositories deploy to one org, any repository owning record types or metadata that another references has to deploy first, or the dependent deploy fails on a reference it cannot resolve.
- **Publishing the Experience Cloud site** — the pipeline has no automatic publish step, so an unpublished site keeps serving the previous snapshot.

### Story reminder

Print this reminder as plain text immediately before the first question about manual steps, one block per story the question covers. When the same `AskUserQuestion` call also asks the screenshots question, print the reminder once for both.

```
{ID} — {Linear title}
Story:   {first sentence of the Linear description}
Done on this branch ({N} commits, {M} files):
  - {up to 5 "What was Done" bullets}
Found automatically:
  - Pre or post runbook script:   {names, or none}
  - Delete package entries:       {count and manifest, or none}
  - Experience Cloud site files:  {changed, or none}
Same story in other repositories: {repo (branch, N commits), or none — checked {list}}
```

- **Line sources**: the title and first sentence come from the Linear story lookup, the counts from the story's commits and file set, the bullets from the "What was Done" step, and the runbook, delete package and site lines from the Automatic rows step. Only the other-repositories line needs a new lookup.
- **Experience Cloud site files**: any changed path under an `experiences/`, `digitalExperiences/`, `digitalExperienceConfigs/`, `sites/` or `networks/` metadata folder.
- **Other repositories**: check every sibling folder of the main repository that is a git repository. Resolve the main repository through the common git directory, so a worktree under `.claude/worktrees/` looks beside the main repository, not inside it. A branch matches `work-{ID}` with any suffix that does not extend the ID's number, local or remote:

  ```bash
  MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  for REPO in "$(dirname "$MAIN")"/*/; do
    REPO=${REPO%/}
    { [ -e "$REPO/.git" ] && [ "$REPO" != "$MAIN" ]; } || continue
    echo "== $REPO"
    git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads refs/remotes | grep -E '(^|/)work-{ID}($|[^0-9])'
    git -C "$REPO" log --all --format=%s | grep -c '^@{ID}:' || true
  done
  ```

  Report a repository when it has a matching branch or a commit count above zero, with its branch names and the count of `@{ID}:` commits. When none match, write `none` and list the repositories checked.
- **Option order**: when another repository has work on the story, `Cross-repo deploy order` comes first and its description names that repository and branch. When site files changed, `Publish Experience Cloud site` comes first and its description names the changed site folder. When both apply, `Cross-repo deploy order` comes first and `Publish Experience Cloud site` second. Otherwise `None` stays first. No candidate is preselected.

## Table shape

Render one table per stage that has rows, `Pre` before `Post`. A stage with no rows gets no table, no label, and no mention.

Within a stage's table, put that stage's manual rows first because someone must act on them, then its automatic rows **in execution order** — the metadata deploy, then the `.apex` scripts in filename order, then the destructive manifest, matching Stage mechanics above.

The stage is named by the table's own label, so it never appears as a column:

```
**Pre-deploy**

| Step | Mode |
|---|---|
| {what happens, and what breaks if it is skipped} | {Manual|Automatic} |

**Post-deploy**

| Step | Mode |
|---|---|
| {what happens, and what breaks if it is skipped} | {Manual|Automatic} |
```

## Omission

Write only what is present. A stage with nothing gets no table, no label, and no mention. When neither stage has an automatic or a manual step, omit the section entirely. Never write a placeholder row, an empty table, or a row stating that a stage has nothing.
