---
name: jenkins-pre-post-deploy
description: Jenkins pre and post deploy phase runner for the connected Salesforce org — resolves the target org, takes one confirmation, then runs the phases unattended via a single script invocation, skipping the force-app deployment so a metadata deprecation can be tested without pushing a commit
---

# Jenkins pre/post deploy runner

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

Runs the `pre` and `post` phases of the Jenkins pipeline against the connected org. The main `deploy` phase is never run.

These are real, irreversible deploys. Components deleted by the destructive step go to the Recycle Bin; Flow versions and other types that cannot be recycled are gone. There is no rollback.

## Procedure

1. Resolve the org. Run `sf config get target-org --json` and read `result[0].value`. If it is empty, stop and tell the user no default org is set. Then read `.claude/rules/org-roles.md` and follow its "Before any write" section; when the org is not the saved deploy target, stop and tell the user.

2. Run `sf org display --json -o <alias>`. Show the user the alias, username, instance URL, and org ID, verbatim.

3. In one `AskUserQuestion` call, ask which phases to run — `pre`, `post`, or `both`. State the resolved alias in the question text. The user's answer is the confirmation of both the org and the phases. Do not ask a second time.

4. Check the script is present before going further. This skill drives a script
   the project supplies; the plugin ships none, because the steps belong to your
   pipeline rather than to Salesforce:

   ```bash
   test -f .claude/scripts/jenkins-pre-post-deploy.sh || {
     echo "Missing .claude/scripts/jenkins-pre-post-deploy.sh, which this project does not have."
     echo "It must accept <pre|post|both> --org <alias>, run those phases, and print a summary table."
     exit 1
   }
   ```

   When it is absent, stop and tell the user exactly that. Never substitute steps
   of your own for it.

5. Invoke the script exactly once, in the foreground:

   `bash .claude/scripts/jenkins-pre-post-deploy.sh <answer> --org <alias>`

   When the org write gate refuses it, relay the refusal word for word and stop.

6. Relay the script's summary table and exit code. Report the "Components the org could not find" block verbatim if it appears.

## Constraints

- **Invoke the script once.** Never run individual steps, never re-run a phase to inspect it, never wrap it in a loop.
- **Do not intervene between steps.** The script owns every verdict. Do not evaluate whether a deletion is safe, do not consult an advisor, do not pause for input. The user approved the run at step 3; every gap after that is an opportunity to second-guess a decision they already made.
- **Declined deletions are not failures.** A `destructiveChanges` manifest may name components deleted in an earlier release. The script reports them and continues, exactly as Jenkins does. Do not treat the report as an error.
- **`both` runs `pre` immediately followed by `post`.** The real pipeline deploys `force-app` between them; this does not. `post` therefore runs against an org that has not received the release. A `post` destructive entry that deletes a component other metadata still references — deferred there specifically so `force-app`'s updated, non-referencing versions land first — cannot be proven safe this way: without that intervening deploy, `post` runs against whatever the org already had, so a clean result here is not evidence the entry succeeds in a real run. Proving it needs a real run, or a manual `force-app` deploy before invoking `post` alone.
- **`both` can catch a metaData component `pre` declares that `post` is missing.** When the project's script converts both phases into one output folder, cleared only before the run — as the real pipeline does — `both` catches it. A component nested in a shared container file (a `CustomField` inside an `.object` file) that `pre` declares and `post` doesn't fails `post`'s metadata deploy here exactly as it does in a real run, with the same "Not in package.xml" error. A standalone-file component left the same way (an `ApexClass`, a `Flow`, a `FlowDefinition`) is silently dropped instead; it is harmless, not a gap this tool hides.
- **A failed `pre` means `post` does not run.** The script enforces this. Do not override it.
- **Never pass `--dry-run`.** If the user wants a rehearsal, say that this tool does not offer one.
- **Script and manifest content is out of scope.** A phase failure caused by a compile or schema error in a `runbooks/*-deploy/apex/*.apex` script, or by a destructive manifest entry placed in the wrong stage, is not this skill's concern to diagnose or fix. Authoring rules for both live in `.claude/rules/runbook-deployment-steps.md`.
