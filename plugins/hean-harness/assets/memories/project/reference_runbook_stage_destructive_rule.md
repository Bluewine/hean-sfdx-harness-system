---
name: reference-runbook-stage-destructive-rule
description: Runbook stage mechanics — both stages share one conversion folder, so a component nested in a shared container file declared in pre must also be declared in post (a standalone-file component need not be), and each stage's metaData must appear in its own destructive manifest
metadata:
  type: reference
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

Each deploy stage runs independently around the `force-app` deploy, in this order: convert `runbooks/<stage>-deploy/metaData/`, deploy it, run every `.apex` file in `runbooks/<stage>-deploy/apex/` in numeric sequence, then apply `deletePackage/<stage>/destructiveChanges<Stage>.xml`.

**Both stages convert into the same output folder and it is not cleared between them.** Post's `package.xml` is generated from post's `metaData` only, so a component present in pre but absent from post arrives at the post deploy as an undeclared file. What happens next depends on the component's shape. A component nested inside a shared container file — a `CustomField` inside an `.object` file — fails the post deploy with `"problem": "Not in package.xml"`, because Salesforce parses the whole container file and checks every nested member against post's `package.xml`. A standalone-file component — an `ApexClass`, a `Flow`, a `FlowDefinition` — is silently dropped by the deploy; it neither applies nor errors. A component unique to *post* is harmless.

**Why:** a shared placeholder class sits in both stages' `metaData` folders. **Never modify or remove that shared placeholder — it belongs to everyone.**

**How to apply:** a component nested in a shared container file declared in pre must also be declared in post, at minimum as an empty declaration, so post's `package.xml` covers it. A standalone-file component need not be. Where a script has no reason to run before the main deploy, putting it in post alone is simpler than mirroring it. Anything under a stage's `metaData` must be listed in that stage's own destructive manifest or it is deployed and never cleaned up. Deleting a component from the org has two halves: list it in the post destructive manifest *and* remove it from the repo. Deleting a component that no longer exists in the target org does not fail the command. See [[feedback_no_pre_post_apex_tests]].
