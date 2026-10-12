# Flow version cleanup skill and API write gate

Date: 2026-10-09. Approved in chat on 2026-10-09.

## Purpose

An org reaches the platform limit of 50 versions per flow, and a deploy of that flow then fails. The
user needs to delete the oldest inactive versions of every flow at that limit in a named org with Salesforce CLI
commands only.

A session asked to do this wrote an anonymous Apex script and planned to deploy a Remote Site Setting
for the org's own My Domain URL. Apex has no statement that deletes a Flow version: only the Tooling
API does, and Apex reaches it only through an HTTP callout, which needs a Remote Site Setting or a
Named Credential. Deploying either to a shared org to run a cleanup is a metadata change nobody asked
for. The Salesforce CLI calls the Tooling API directly and needs nothing deployed.

The same session sent the deletes with `sf api request rest`, which `hooks/org-write-gate.mjs` does
not list as a write. The org's saved role therefore did not control those deletes.

## Scope

Two tasks, each with its own commit and review:

1. **Task A — write gate.** `hooks/org-write-gate.mjs` treats `sf api request rest` and
   `sf api request graphql` as org writes when they can change data.
2. **Task B — skill.** New skill `/hean-harness:flow-version-cleanup` with its script, library and
   tests.

Task A comes first: Task B's write-permission step depends on it.

## Task A — API request write gate

**Rule:**

| Command | Counts as a write when |
|---|---|
| `sf api request rest` | `-X`/`--method` is `POST`, `PUT`, `PATCH` or `DELETE`; or `-f`/`--file` is given (the request file can carry any method) |
| `sf api request graphql` | the `--body` file contains the word `mutation`, or the file cannot be read |

- Without `-X`, the CLI sends `GET`; `GET`, `HEAD`, `OPTIONS` and `TRACE` stay read-only.
- The method value is compared case-insensitively.
- `sf api request rest` takes the URL as a positional argument, so the topic words are
  followed by the URL. Match the command on its first three topic words (`api request rest`,
  `api request graphql`), not on the whole word list the parser builds today.
- A GraphQL `--body` given inline (not `@file` and not an existing path) is read as the body text itself.
- The org comes from `-o`/`--target-org` as for every other write.

**Tests** in `hooks/__tests__/org-write-gate.test.mjs`, following its existing cases: `rest` with no
method, `-X GET`, `-X post`, `--method=DELETE`, `-X PATCH` with a URL before the flags, `-f
request.json`; `graphql` with a query body file, a mutation body file, an unreadable body file.

## Task B — `/hean-harness:flow-version-cleanup`

**Invocation:** `/hean-harness:flow-version-cleanup [org alias or username] [--count <N>]`.

- **Org:** the first argument, or `-o <alias>`. When the user names the org in words instead ("in
  sharedqa"), match it against the logged-in orgs' alias, username and sandbox name; ask only when it
  matches more than one org or none. With no org given, use the CLI default org. Name the resolved
  org's alias and username before any query.
- **Count:** `--count` is optional: the number of oldest non-Active versions to delete per flow. It
  defaults to `5` and must be an integer `>= 1`; any other value is refused before the query runs.
  The dry-run table and the confirmation question state the count in use.
- **Autocomplete hint:** the skill's frontmatter sets
  `argument-hint: "[org alias or username] [--count <N, default 5>]"`, so the slash-command
  autocomplete shows both arguments and the count's default while the user types.
- **Flows are never asked for.** The skill finds the flows to clean itself (see Selection); it takes no
  flow name argument and never asks the user or a calling agent which flows to clean.

**Files:**

- `plugins/hean-harness/skills/flow-version-cleanup/SKILL.md` — the conversation: org, role check,
  confirmation, role reset, report.
- `plugins/hean-harness/scripts/flow-version-cleanup.mjs` — command-line entry: `plan` and `apply`.
- `plugins/hean-harness/scripts/lib/flow-version-cleanup.mjs` — selection, batch building, result
  parsing, report text.
- `plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs` — tests with a fake `sf` on
  `PATH`, as the existing script tests do.

### Selection

The skill gathers every flow in the org that has reached the platform limit of 50 versions per flow
(Salesforce Help, "General Flow Limits": maximum versions per flow is 50 in every edition). A flow
with 49 versions or fewer is left untouched. `50` is a named constant in the library, not an argument.

For each flow at the limit:

- **No Active version:** skip the flow. Delete nothing from it. List it in the report as skipped.
- **Otherwise:** every version whose `Status` is not `Active` is a candidate (`Obsolete`, `Draft`,
  `InvalidDraft`), whatever its number relative to the Active version.
- Sort candidates by `VersionNumber` ascending and select the first `N`.
- The Active version is never selected.

### Steps

1. **Query (read-only).** One Tooling query:
   `SELECT Id, DefinitionId, Definition.DeveloperName, VersionNumber, Status FROM Flow`. When the
   result reports `done: false` or fewer records than `totalSize`, stop with an error; never plan
   from a partial list.
2. **Plan (read-only).** `flow-version-cleanup.mjs plan` writes the plan to a JSON file in a
   temporary folder and prints the number of flows at the 50-version limit, then one row per flow
   with versions to delete (flow API name, versions present, versions to delete, version numbers as
   ranges), the totals, and the skipped flows. When no flow is at the limit, report that and stop.
3. **Org write check.** Read the org's saved role with `org-roles.mjs status`.
   - **Deploy target:** continue.
   - **Not a deploy target, or no saved role:** print a `!!` line saying the org is locked for writes,
     with its saved role. Record the exact previous state: role, deploy value and branch, or "no
     entry".
4. **One confirmation.** One `AskUserQuestion` call presents the plan totals and, when step 3 found
   the org locked, asks whether to allow writes for this run only. Without a yes, stop; nothing was
   written.
5. **Temporary permission.** When the user allowed it, run `org-roles.mjs set <alias> --role <previous
   role, or research when there was no entry> --deploy yes`, keeping any previous `--branch`.
6. **Delete.** `flow-version-cleanup.mjs apply <plan file>`:
   - Refuse before any request unless the org is a saved deploy target. The script's own `sf` calls
     never pass through the org write gate, so the script checks the same saved roles itself.
   - Query the planned Ids again and drop any version whose `Status` is now `Active`.
   - Send DELETE subrequests `v<api>/tooling/sobjects/Flow/<Id>` in batches of 25 (the Composite
     Batch limit) with `sf api request rest /services/data/v<api>/tooling/composite/batch -X POST
     --body @<batch file> -o <alias>`. `<api>` is the org's `apiVersion` from `sf org display`.
   - Send the batches one at a time: two requests in flight that delete versions of the same flow
     fail with `UNABLE_TO_LOCK_ROW` (observed in a live cleanup of 1,156 versions; all 25 such
     versions succeeded when retried alone).
   - Status `204` is a deleted version. Any other status is a failure, recorded with its error code and
     message (`DEPENDENCY_EXISTS` for a paused flow interview or a survey branding set,
     `FIELD_INTEGRITY_EXCEPTION`, `UNABLE_TO_LOCK_ROW`). Versions that failed with
     `UNABLE_TO_LOCK_ROW` are retried once, alone; no other failure is retried. `FlowInterview`
     records are never deleted.
   - A batch whose whole request fails is recorded as a failure for each of its versions, and the run
     continues with the next batch.
   - The final query decides: a failed version the org no longer holds counts as deleted, with a note
     (a request stopped mid-way still completes in the org).
7. **Reset.** When step 5 changed the role, restore it whatever step 6 returned: `org-roles.mjs set`
   with the previous role, deploy value and branch, or `org-roles.mjs remove` when there was no entry.
   Print `org-roles.mjs status` to show the restored state. If the reset fails, print a `!!` line with
   the exact command to run.
8. **Report.** Versions deleted, versions failed with reasons, flows skipped, and the before and after
   version counts for each touched flow from a new query.

### Prohibitions in SKILL.md

- No metadata deploy, no Apex (`sf apex run` or a script file), no Remote Site Setting, no Named
  Credential, no Connected App. State the reason: Apex reaches the Tooling API only through an HTTP
  callout, which needs one of those.
- Never change an org's role except through steps 5 and 7.
- Never delete `FlowInterview` records.

### Tests

- Selection: a flow with 49 versions is untouched and a flow with 50 is selected; a flow at the limit
  with no Active version is skipped; Drafts and Obsolete versions above the Active version are
  candidates; gaps in version numbers; `N` larger than a flow's candidates.
- Org resolution: a positional alias, `-o <alias>`, a sandbox name matching one org, a name matching
  two orgs (asks), no org given (CLI default).
- Partial query result stops the plan.
- Batch building: 0, 25, 26 and 51 versions.
- Result parsing: mixed `204` and error subrequests; a whole-request failure.
- Re-check before delete drops a version that became Active.
- Role reset command for each previous state: deploy target, locked with a role and branch, no entry.

## Verification

- `node plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs` and
  `node plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs` pass, and the full
  test loop passes.
- No live org run during plugin work: plugin work never runs plugin scripts or skills in client
  repositories.

## Out of scope

- Deleting `FlowInterview` records to unlock failed versions.
- Deleting whole flows.
- Retrying failed versions.
