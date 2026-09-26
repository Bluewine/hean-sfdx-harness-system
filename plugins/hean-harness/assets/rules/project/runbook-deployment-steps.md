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

**Both stages share one conversion output folder, and it is not cleared between them.** Confirmed by running the conversion for `pre` then `post` back to back into the same output folder: `post`'s conversion regenerates `package.xml` from `post`'s own declared source, but never removes a file `pre`'s earlier conversion left behind, so a component only `pre` declared can still be physically present when `post` deploys. Whether that breaks the deploy depends on the component's shape:

- **A component nested inside a shared container file needs a matching declaration in the later stage too, at minimum an empty one** — a `CustomField` (or any other member living inside an `.object` file) that `pre` declares and `post` doesn't fails `post`'s deploy with "Not in package.xml", confirmed against a real org: Salesforce parses the whole container file and cross-checks every nested member against that stage's `package.xml`.
- **A standalone-file component needs no matching declaration.** Confirmed against a real org: a leftover file with no `package.xml` entry at all — an `ApexClass`, a `Flow`, a `FlowDefinition` — is silently dropped by the deploy; it neither applies nor errors. Duplicating it into the later stage is unnecessary.

**Metadata under a stage's `metaData/` must be listed in that stage's destructive manifest**, so the transient component is removed again once it has run. The only exception is a component the user says to keep.

**`ACME_Deployment` is a shared placeholder. Never add, edit, or remove it.**

**A destructive entry naming a component absent from the target org does not fail the deploy.** A destructive entry naming a component something else in the org still references does fail, regardless of metadata type — a custom field, a flexipage, an Apex class, a permission set. Two ways to satisfy the dependency, in order of preference:

- **Defer the deletion to the post destructive manifest.** The default. `post` runs after `deploy` pushes `force-app`, so any consumer this release already updates there to stop referencing the component is live in the org before `post`'s destructive step runs — nothing needs duplicating. Deprecating a component that predates the branch, with no name reuse involved, is always this case: list it here, alongside deleting it from the repo.
- **Deploy the referencing components' updated content early, under the same stage's `metaData/`,** so the metadata-deploy step (Stage mechanics step 1) clears every reference before that stage's destructive step (step 3) runs. Use this only when the deletion cannot wait for `post` — typically because the release reuses the exact same API name for new metadata, and the old component must be gone before `deploy` creates the new one under that name. This duplicates real `force-app` content into the runbook; keep both copies in sync for as long as the runbook keeps them.

## Writing pre/post-deploy Apex scripts

A `runbooks/*-deploy/apex/*.apex` script's target org does not reliably match whatever schema state the script was written and tested against. The same script runs unmodified across every environment the release reaches, and a field this release adds or removes may exist in one environment and not another at the moment the script runs, depending on that environment's own deploy history and where in the stage sequence the script sits relative to the metadata step.

**Never reference a field, object, or record type this same release adds or removes using typed dot-notation or a typed named-constructor** (`record.Field__c`, `new SomeObject(Field__c = value)`). Apex resolves every such reference against the target org's compiled schema at compile time, before any runtime logic — including an `if` guard checking whether the field exists — ever executes. A runtime existence check never protects a compile-time reference; the script fails to compile regardless of which branch would have run.

Use dynamic, string-keyed access instead, for every field or object touched by the script that this release adds or removes:

- Read: `Database.query('...')` into `List<SObject>`, then `.get('Field__c')` / `.getSObject('Relationship__r')`.
- Write: `Schema.getGlobalDescribe().get('ObjectName').newSObject()`, then `.put('Field__c', value)`.
- Guard with `Schema.SObjectType.<Object>.fields.getMap().containsKey('field__c')` (lowercase key) before touching a field that may not exist. The guard protects the field's data at runtime; it does nothing for compile-time syntax — the dynamic-access rule above is what makes the guard meaningful at all.

Apply this to every field the script touches that this release adds or removes — not only the one being removed. A script safe against the field it deletes but still typed against the field it creates fails identically, just in the opposite direction: it compiles once the new field exists everywhere, and fails everywhere it does not yet.

A field a `pre-deploy` script reads does not need to be deleted in `pre` too. The script only needs the field to still exist at the moment it runs, which holds regardless of which stage's destructive manifest eventually removes it — see Stage mechanics above for which stage that should be.

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
- **Publish Experience Cloud site** — the pipeline has no automatic publish step, so an unpublished site keeps serving the previous snapshot.

### Story reminder

Print this reminder as plain text immediately before the first question about manual steps, one block per story the question covers. When the same `AskUserQuestion` call also asks the screenshots question, print the reminder once for both.

```
{ID} — {Linear title}
Asked for: {what the story asks for, in one or two sentences of your own from the Linear description}
Done on this branch ({N} commits, {M} files):
  - {up to 5 "What was Done" bullets}
Found automatically:
  - Pre or post runbook script:   {names, or none}
  - Delete package entries:       {count and manifest, or none}
  - Experience Cloud site files:  {changed, or none}
Same story in other repositories: {repo (branch, N commits), or none — checked {list}}
```

- **Line sources**: the title and the Asked for line come from the Linear story lookup, the counts from the story's commits and file set, the bullets from the step that builds the "What was Done" bullets, the runbook and delete package lines from the Automatic rows step, and the site line from the story's changed files matched against the site paths below. Only the other-repositories line needs a new lookup.
- **Never shortened**: Send the block in this exact shape as reply text, in the same message as the question and before it. A one-sentence summary does not replace it.
- **Experience Cloud site files**: Salesforce site metadata matched by type — any changed path under an `experiences/`, `digitalExperiences/`, `digitalExperienceConfigs/` or `siteDotComSites/` metadata folder, and any changed file ending `.site-meta.xml` or `.network-meta.xml`. A folder that is only named `sites`, such as one inside a static resource, does not count.
- **Other repositories**: check every sibling folder of the main repository that is a git repository. Resolve the main repository through the common git directory, so a worktree under `.claude/worktrees/` looks beside the main repository, not inside it. Skip a sibling whose common git directory is the current repository's, because it is a worktree of this repository, not another one. A branch matches `work-{ID}` with any suffix that does not extend the ID's number, local or remote:

  ```bash
  COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
  for REPO in "$(dirname "$(dirname "$COMMON")")"/*/; do
    REPO=${REPO%/}
    [ -e "$REPO/.git" ] || continue
    [ "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)" != "$COMMON" ] || continue
    echo "== $REPO"
    git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads refs/remotes | grep -E '(^|/)work-{ID}($|[^0-9])'
    git -C "$REPO" log --all --format=%s | grep -c '^@{ID}:' || true
  done
  ```

  Report a repository when it has a matching branch or a commit count above zero, with its branch names and the count of `@{ID}:` commits. When none match, write `none` and list the repositories checked.
- **Option order**: when another repository has work on the story, `Cross-repo deploy order` comes first and its description names that repository and branch. When site files changed, `Publish Experience Cloud site` comes first and its description names the changed site metadata. When both apply, `Cross-repo deploy order` comes first and `Publish Experience Cloud site` second. Otherwise `None` stays first. The `None` option means no manual steps apply. No recurring candidate is preselected; update-pr's existing manual rows stay preselected.

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
