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

Diff the destructive manifests against the merge base, so only entries the change itself adds are listed rather than entries an earlier release left in place:

```bash
MB=$(git merge-base origin/integration HEAD)
git diff "$MB" HEAD -- deletePackage/
```

## Manual rows

Manual steps live outside the repo and cannot be derived from a diff. **Always ask which manual steps apply, the same way screenshots are asked for**, unless the user named them in their prompt — in which case use those verbatim. Never infer a manual step and render it unasked, and never render one the user declined. When the user gives a step without naming its stage, ask. Every manual row's Mode is **Manual**.

Manual steps a project needs repeatedly, to offer as candidates:

- **Cross-repo deploy order** — when several repositories deploy to one org, any repository owning record types or metadata that another references has to deploy first, or the dependent deploy fails on a reference it cannot resolve.
- **Publishing the Experience Cloud site** — the pipeline has no automatic publish step, so an unpublished site keeps serving the previous snapshot.

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
