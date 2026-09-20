---
name: reference-runbook-stage-destructive-rule
description: Runbook stage mechanics — both stages share one conversion folder, so anything in pre must also exist in post, and each stage's metaData must appear in its own destructive manifest
metadata:
  type: reference
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

Each deploy stage runs independently around the `force-app` deploy, in this order: convert `runbooks/<stage>-deploy/metaData/`, deploy it, run every `.apex` file in `runbooks/<stage>-deploy/apex/` in numeric sequence, then apply `deletePackage/<stage>/destructiveChanges<Stage>.xml`.

**Both stages convert into the same output folder and it is not cleared between them.** Post's `package.xml` is generated from post's `metaData` only, so a component present in pre but absent from post arrives at the post deploy as an undeclared file and the stage fails with `"problem": "Not in package.xml"`. A component unique to *post* is harmless; only pre-only components break.

**Why:** this is why a shared placeholder class is duplicated into both stages' `metaData` folders — it keeps the post-deploy manifest covering the shared folder. **Never modify or remove that shared placeholder — it belongs to everyone.**

**How to apply:** anything declared in pre must also exist in post, at minimum as an empty placeholder, so post's `package.xml` builds correctly. Where a script has no reason to run before the main deploy, putting it in post alone is simpler than mirroring it. Anything under a stage's `metaData` must be listed in that stage's own destructive manifest or it is deployed and never cleaned up. Deleting a component from the org has two halves: list it in the post destructive manifest *and* remove it from the repo. Deleting a component that no longer exists in the target org does not fail the command. See [[feedback_no_pre_post_apex_tests]].
