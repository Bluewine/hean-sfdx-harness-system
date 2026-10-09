---
name: flow-version-cleanup
description: Flow version limit cleanup for one Salesforce org — finds every flow at the 50-version limit and deletes its oldest non-Active versions through Tooling API batch requests from the Salesforce CLI, with one confirmation and a temporary write permission that is always reset, never Apex or a metadata deploy
argument-hint: "[org alias or username] [--count <N, default 5>]"
---

# Flow version cleanup

A flow holds at most 50 versions (Salesforce Help, "General Flow Limits"). At the limit, saving or
deploying the flow fails. This skill finds every flow at the limit in one org and deletes its oldest
non-Active versions.

## Why no Apex

Apex has no statement that deletes a flow version. Only the Tooling API does, and Apex reaches the
Tooling API only through an HTTP callout, which needs a Remote Site Setting or Named Credential
deployed to the org. The Salesforce CLI calls the Tooling API directly and needs nothing deployed.

- Never write or run Apex for this: no `sf apex run`, no script file.
- Never deploy metadata for this: no Remote Site Setting, Named Credential, External Credential or
  Connected App.
- Never delete `FlowInterview` records to unlock a version.
- Never change the org's saved role except through steps 4 and 6.

## Task list

Create one task per step below, steps 1 to 7, before step 1. Mark each `in_progress` when it starts
and `completed` when it ends.

## Steps

Run every command from the SFDX project root.

1. **Arguments.** Take the org from the first argument, from `-o <alias>`, or from the user's words
   ("in qa", "the UAT sandbox"). Take `--count <N>` when given. Never ask which flows: the script
   finds them.

2. **Plan (read-only).** Run, leaving out `--org` when no org was named and `--count` when no count
   was given:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-version-cleanup.mjs" plan --org <org> --count <N>
   ```

   - **Exit 1 with "matches more than one org", "no org logged in on this machine matches", "no org
     was given and no CLI default org is set", or "the CLI default org … is not logged in on this
     machine":** run
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" status`, ask the user which org in one
     `AskUserQuestion` call listing the logged-in orgs, then run step 2 again with that alias.
   - **Any other exit 1:** report the `ERROR:` line and stop.
   - **Exit 2:** report that no flow is at the 50-version limit (or that every one was skipped,
     with the SKIPPED list) and stop.
   - **Exit 0:** show the user the `ORG:` line, the plan table, the totals and the SKIPPED list as
     printed. Relay every line starting with `!!` word for word. Keep the `ALLOW:`, `RESTORE:` and
     `PLAN_FILE:` values for later steps.

3. **One confirmation.** Ask one `AskUserQuestion` question naming the org alias, the count, the
   number of versions and the number of flows.
   - Org printed `ROLE: … saved deploy target`: options "Delete" and "Cancel".
   - Org printed `!! … locked for writes`: options "Allow writes for this run, delete, then reset
     the role" and "Cancel".
   - "Cancel": stop. Nothing was written.

4. **Temporary permission.** Only when the org was locked: run the `ALLOW:` command exactly as
   printed. From here on, step 6 runs whatever happens.

5. **Delete.** Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-version-cleanup.mjs" apply "<PLAN_FILE>"
   ```

   Each batch of 25 versions takes about 30 seconds. Use a 600000 ms timeout; when the plan's total
   is above 400 versions, run it in the background and wait for it to finish. Keep its output and
   exit code: 0 all deleted, 3 some failed, 1 could not run. On exit 1 the script prints an
   `ERROR:` line and no `RESULT:` line or Before | After table, and its stderr progress lines
   (`batch N: deleting …`) show how far it got.

6. **Reset.** Only when step 4 ran, and after every outcome of step 5 — exit 0, 1 or 3, an
   interrupted run, or a timeout: run the `RESTORE:` command exactly as printed, then
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" status`. When the reset fails, print
   `!! The role of <alias> was not restored. Run: <RESTORE command>` and tell the user.

7. **Report.** On exit 1 from step 5: report the `ERROR:` line. When any `batch N: deleting …`
   line appears in the stderr output, versions may already be deleted: tell the user to run the
   plan step again to see the current counts. When no batch line appears, nothing was deleted.
   Then say whether the role was reset, as below, and stop.

   On exit 0 or 3: show the `RESULT:` line, the Before | After table, and each list the script printed:
   FAILED, DELETED DESPITE AN ERROR RESPONSE, NOT SENT, SKIPPED. Group the failures by error code
   and say what each needs:
   - `DEPENDENCY_EXISTS` naming a flow interview: a paused or failed interview still uses that
     version; it can be deleted after the interview finishes or is removed by its owner.
   - `DEPENDENCY_EXISTS` naming a branding set or Survey Version: a survey still references it.
   - `UNABLE_TO_LOCK_ROW` after the retry: run the skill again later.
   - `FIELD_INTEGRITY_EXCEPTION` "Unable to load specified entity": check the Before | After counts;
     the version may already be gone.
   Say whether the role was reset, from the `status` output.
