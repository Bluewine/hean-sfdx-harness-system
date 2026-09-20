---
name: deprecate-flow
description: Flow deprecation utility for Jenkins pre/post deploy manifests — collects the flow name, version count, and intent up front, then deactivates the flow, clears errored flow interviews, removes the source from force-app, and lists every version down to 1 in destructiveChanges
---

# Deprecate Flow

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

## Overview

Deprecating most Salesforce metadata is uniform: list the component in a destructive-changes manifest and deploy. Flows are the exception. Listing a flow's bare API name deletes nothing. A flow must be deactivated first, and every version must be listed individually as `FlowName-N`.

This skill generates only that flow-specific delta. Removing references to the flow — subflow calls, quick actions, layouts, flexipages, permission-set `flowAccesses`, Apex — is out of scope and remains the caller's responsibility. Resolve those before invoking.

## Task list

Before Phase 1, create a task list holding one task per phase below, Phase 1 through Phase 10. Mark a task `in_progress` when its phase begins and `completed` when it ends. Never batch completions at the end, and never collapse phases into one task — the list is how the user watches a destructive run advance.

Every user input is collected in Phase 1. Phases 2 through 10 run serially, pausing only at the Phase 4 confirmation gate.

## Failure-Mode Asymmetry

| Condition | Result |
|---|---|
| Overshoot — list a version that does not exist | Logged warning in CI. Deploy succeeds. Harmless. |
| Undershoot — omit a version that does exist | Deploy succeeds. Versions survive. Flow is not deleted. Silent. |

Undershoot is the only dangerous mode. Never undershoot. Because overshoot costs nothing, the version list runs from a top that always exceeds the highest version found in the connected org, all the way down to 1. Listing versions that do not exist is deliberate. Phase 1 lets the user widen that range; Phase 2's arithmetic denies them any way to narrow it below the connected org's highest version. No arithmetic can rule out a higher version in an environment the query never saw — that residual risk is Phase 10's caveat, and only a larger `requestedVersions` reduces it.

CI deploys destructive changes with `ignoreWarnings: true`, so a member naming a nonexistent version is logged and skipped. A local `sf project deploy start` needs `--ignore-warnings` or it fails on those members.

## Phase 1 — Input collection

Collect every user input here. Do not defer a question to a later phase. Once Phase 2 starts, the run is a serial chain of org queries and file writes, broken only by the Phase 4 confirmation gate; any other prompt strands the user between a query and a destructive artifact.

Resolve `flowApiName` first. It is the flow's `DeveloperName`, taken from the invocation arguments. If absent, ask the user and stop until answered.

Use the org the Salesforce CLI is already connected to. Do not require a second org, and do not hardcode an alias — this skill runs on any teammate's machine against their own connected org.

Show the user which org will be queried before querying it:

```bash
sf org display --json | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(r["alias"], r["username"])'
```

Accept an explicit `-o <alias>` override if the user passes one. Otherwise proceed with the connected org.

Then make exactly one `AskUserQuestion` call collecting both remaining inputs. Name the resolved org alias in the question text.

- `requestedVersions` — how many versions to list. Default `5`. Phase 2 reads it as a margin above the org's highest version, or as an absolute top version when it exceeds that highest. Reject any answer that is not an integer `>= 1` and ask again.
- `intent` — `deprecation` or `rebuild`. Default `deprecation`. Phase 3 derives the destructive target from it, and Phase 8 asserts against it.

One question governs both manifests. `requestedVersions` sizes the same version list whether Phase 3 targets `destructiveChangesPre.xml` or `destructiveChangesPost.xml`. Do not ask a second time for the other target.

The org choice does not need justifying. Counting down to `1` covers every environment holding a lower version than the connected org, whatever its numbering. `requestedVersions` governs the other end of the range: it guarantees headroom above the highest version, which absorbs the version the deploy itself mints when Phase 7's staged source lands during `pre.metadata`.

## Phase 2 — Version enumeration

Ask the org for the flow's highest version number, then list every version from the top down to `1`.

Derive the top from `requestedVersions`:

| Condition | Top version listed |
|---|---|
| `requestedVersions > highest` | `requestedVersions` |
| `requestedVersions <= highest` | `highest + requestedVersions` |

Worked: org highest `5`, answer `10` → top `10`. Org highest `10`, answer `5` → top `15`.

Because `requestedVersions >= 1`, the top exceeds `highest` in both branches. The user's answer widens the range; it cannot truncate it below a version live in the connected org. Undershoot against the connected org is therefore structurally impossible whatever they answer, which is why Phase 1 is free to ask. It is not impossible against every org: a version above the top still survives in an environment the query never saw. Phase 10 states that caveat.

Headroom above `highest` bottoms out at exactly `1`, reached whenever `requestedVersions == highest + 1`. Phase 7's staged source mints exactly one version, so one is sufficient for the connected org — but there is no slack beneath it. Never weaken the `>= 1` floor on `requestedVersions`.

That headroom is also the entire cushion against a higher version in another environment, and on the `requestedVersions > highest` branch it can fall below `5`: a flow at `highest = 4` answered with the default `5` lists a top of `5`, a cushion of `1`. Raising `requestedVersions` is the only lever that widens it. Say so at the Phase 4 gate whenever the cushion lands under `5`.

Take the highest version regardless of status. Do **not** take the highest *inactive* version. The active version must be listed too — the Phase 5 `FlowDefinition` deactivates it so it can be deleted. Omitting it is the single most common cause of a deprecation that reports success and leaves the flow alive.

```bash
F="<flowApiName>"; REQ=<requestedVersions>
sf data query --use-tooling-api --json \
  -q "SELECT VersionNumber FROM Flow WHERE Definition.DeveloperName = '$F'" \
| python3 -c '
import json, sys
flow, req = sys.argv[1], int(sys.argv[2])
if req < 1:
    sys.exit("ERROR: requestedVersions must be an integer >= 1")
vs = [r["VersionNumber"] for r in json.load(sys.stdin)["result"]["records"]]
if not vs:
    sys.exit(f"ERROR: no versions found for {flow} — flow does not exist in the connected org")
highest = max(vs)
top = req if req > highest else highest + req
print(f"SUMMARY: {len(vs)} versions present, highest {highest}, listing {top} down to 1", file=sys.stderr)
print("    <types>")
for n in range(top, 0, -1):
    print(f"        <members>{flow}-{n}</members>")
print("        <name>Flow</name>")
print("    </types>")
' "$F" "$REQ"
```

The command omits `-o`, so it uses the connected org. Add `-o <alias>` only if the user asked for a specific org.

Counting down from the top covers every version that exists, including any hidden by gaps in the numbering, and any version minted after the manifest was written. Phase 7 stages the flow source, which the pipeline deploys during `pre.metadata` — that mints a fresh version above the highest one seen here. The headroom above `highest` absorbs it.

If the command exits with `ERROR: no versions found`, stop. The flow does not exist in the connected org and there is nothing to deprecate.

Retain the generated block on stdout and the `SUMMARY:` line on stderr. Phase 4 presents them to the user.

## Phase 3 — Destructive target selection

The deploy runs `pre.metadata` → `pre.runAnonymousScriptFromDir` → `pre.runSFCommandFromFile` → `pre.metadata-destruct` → main deploy → `post.metadata-destruct`.

The target is chosen by the caller's **intent**, not by whether the flow file is currently in `force-app`. Do not use `test -f` as the discriminator: at this point the flow is normally still in `force-app`, because Phase 7 of this skill is what moves it. Inferring from the file's presence would route every ordinary deprecation down the rebuild path.

`intent` was collected in Phase 1. Derive the target from it. Do not ask again.

- **Deprecation** (default) — the flow is being retired for good. Target `deletePackage/post/destructiveChangesPost.xml`. Phase 7 removes the flow source from `force-app`, so the main deploy no longer contains it and cannot recreate it. Deleting after the main deploy is therefore safe.
- **Rebuild** — the flow stays in `force-app` and the main deploy will recreate it from source. Target `deletePackage/pre/destructiveChangesPre.xml`, and skip Phase 7. Deleting in `post` would destroy the version the main deploy had just created.

Never pair a `post` target with a flow left in `force-app`, and never pair a `pre` target with Phase 7's move. Either combination deletes the versions and then lets the main deploy recreate the flow: the deploy reports success and the flow survives.

Rebuild is outside this skill's stated scope. It also rests on an unconfirmed assumption: that the deploy runner iterates `metadata` before `metadata-destruct` within the `pre` phase. Warn the user before proceeding down it.

## Phase 4 — Confirmation gate

Do not write any file before the user confirms. Present:

- the flow API name, and the alias and username of the org queried
- how many versions the org holds, and the highest version number
- the full range about to be listed: the Phase 2 top down to `1`
- the headroom above `highest`, and — when it is under `5` — that this is the whole cushion against a higher version in an environment the query never saw
- whether this is a deprecation or a rebuild, the destructive target that follows from it, and why

Confirm the destructive target only. `requestedVersions` and `intent` were both set in Phase 1 — report them, do not reopen them, and do not ask about any org other than the one queried. The gate reports the range; it does not put the range up for negotiation.

Proceed only on explicit confirmation.

## Phase 5 — FlowDefinition deactivation artifact

An active flow version cannot be deleted. The platform rejects it even when the deploy sets `ignoreWarnings`:

> You cannot delete this flow version because it is active. Deactivate it, and try again.

Deactivation is mandatory. Write `runbooks/pre-deploy/metaData/flowDefinitions/<flowApiName>.flowDefinition-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
    <activeVersionNumber>0</activeVersionNumber>
</FlowDefinition>
```

This file deploys during `pre.metadata`, before either destructive step.

## Phase 6 — Error flow-interview cleanup artifact

Deactivation alone does not make a flow deletable. `FlowInterview` records in `InterviewStatus = 'Error'` pin their flow versions, and the destructive step fails while they exist.

Do not delete interviews directly against an org. That would fix only the org queried and leave QA, UAT, and PROD failing. Emit a scoped anonymous Apex script instead.

Never place this script in `runbooks/pre-deploy/apex/`. The pipeline's `runAnonymousScriptFromDir` step (`deploy.yml`'s `pre.runAnonymousScriptFromDir`) executes every file there through a jsforce connection that never sets an API version, so jsforce's own hardcoded default of `42.0` governs the call, in every environment, permanently. `FlowDefinitionView`, `FlowVersionView`, and `FlowInterview.InterviewStatus` do not exist as Apex types at `42.0` — the script fails to compile with `Invalid type: Schema.FlowDefinitionView` before a single query runs. No rewrite of the Apex fixes this: the schema this cleanup depends on did not exist on the platform yet at that API version. Confirmed by testing the identical script against the connected org's Tooling `executeAnonymous` at versions `42.0` (invalid type), `49.0` (type exists, `InterviewStatus` field does not), and `58.0` (compiles and runs).

Write the script instead to `runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex`, and add a line to `runbooks/pre-deploy/sf/commands.txt`:

```
apex run --file ./runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex
```

`runSFCommandFromFile` shells out to the real `sf` CLI as a subprocess, which resolves the org's or project's own API version — unaffected by the jsforce default. `deploy.yml` runs `runSFCommandFromFile` immediately after `runAnonymousScriptFromDir` and before `metadata-destruct`, so the ordering this cleanup depends on (after deactivation, before the destructive step) is unchanged.

```apex
List<String> flowNames = new List<String>{ '<flowApiName>' };

Set<String> defIds = new Set<String>();
for (FlowDefinitionView d : [SELECT DurableId FROM FlowDefinitionView WHERE ApiName IN :flowNames]) {
    defIds.add(d.DurableId);
}

Set<String> versionIds = new Set<String>();
for (FlowVersionView v : [SELECT DurableId FROM FlowVersionView WHERE FlowDefinitionViewId IN :defIds]) {
    versionIds.add(v.DurableId.substring(0, 15));
}

if (!versionIds.isEmpty()) {
    List<FlowInterview> doomed = [
        SELECT Id FROM FlowInterview
        WHERE InterviewStatus = 'Error' AND FlowVersionViewId IN :versionIds
    ];
    System.debug(LoggingLevel.INFO, 'Deleting ' + doomed.size() + ' Error flow interviews');
    if (!doomed.isEmpty()) {
        delete doomed;
    }
} else {
    System.debug(LoggingLevel.INFO, 'No flow versions matched; nothing to delete');
}
```

If the file already exists from a prior deprecation, add the new flow name to the `flowNames` list rather than overwriting it. Another flow may already be queued in the same release. Do not add a second `apex run --file` line to `commands.txt` in that case — the existing line already invokes the updated script.

Scope rules, all load-bearing:

- `AND InterviewStatus = 'Error'` excludes every `Paused` interview. `Paused` interviews are in-flight user work, and any connected org may hold some unrelated to this cleanup. Never delete them.
- Scope is carried by the query, not by the `!versionIds.isEmpty()` guard. `IN :emptySet` matches zero rows — it narrows, it does not widen. The guard is defence in depth against a future edit dropping a clause.
- `FlowVersionView.Id` returns the placeholder `000000000000000AAA` and is unusable. Use `DurableId`.
- `FlowInterview.FlowVersionViewId` is 15 characters; `FlowVersionView.DurableId` is 18. The `substring(0, 15)` is mandatory, not cosmetic.
- `FlowVersionView` rejects subquery filters (`a filter on a reified column is required`). Definition ids must be resolved first and bound. This is why the cleanup is Apex, not one SOQL statement.
- A single `delete` is capped at 10,000 rows. A flow with more Error interviews needs chunking. Not implemented. State the ceiling in the skill's report.

## Phase 7 — Flow source staging

Deprecation (`post` target) only. Skip this phase entirely for a rebuild — removing the source from `force-app` would defeat the rebuild. Copy the flow source into the staging directory, delete it from `force-app`, and set the staged copy's status to `Obsolete`.

This skill performs the move directly. That is a sanctioned exception to the project rule requiring all `force-app/` changes to route through the `developer` agent. The user approved it explicitly when this skill was designed. Do not delegate this move, and do not re-litigate the exception.

The flow is normally still in `force-app` at this point. Move it. If it is already absent — a prior run moved it, or the caller moved it by hand — say so and skip this phase. Do not stop the run: the flow being gone from `force-app` is the state this phase exists to produce.

```bash
SRC="force-app/main/default/flows/<flowApiName>.flow-meta.xml"
DST="runbooks/pre-deploy/metaData/flows/<flowApiName>.flow-meta.xml"
if [ -f "$SRC" ]; then
    mkdir -p "$(dirname "$DST")"
    cp "$SRC" "$DST" || { echo "ERROR: cp failed" >&2; exit 1; }
    if [ ! -f "$DST" ]; then echo "ERROR: $DST missing after cp" >&2; exit 1; fi
    rm "$SRC" || { echo "ERROR: rm failed" >&2; exit 1; }
    if [ -f "$SRC" ]; then echo "ERROR: $SRC still present after rm" >&2; exit 1; fi
elif [ -f "$DST" ]; then
    echo "already staged at $DST — skipping the move"
else
    echo "ERROR: flow source found in neither force-app nor runbooks" >&2; exit 1
fi
```

If the flow is in neither location, stop. The manifest would delete a flow whose source has vanished from the repo.

Copy first, delete second, and assert each step. Do not use `git mv`: it aborts on an untracked source or when both paths already exist, printing to stderr while leaving the flow in `force-app`. Plain `cp` and `rm` need no index entry, and git records the rename at commit time from content similarity — commit `8e3154c` shows it as `R099`. Proceeding from a failed removal writes a `post` manifest for a flow the main deploy still contains, which deletes the versions and then recreates them: the deploy reports success and the flow survives. Phase 8 is the backstop for exactly that.

Then set the staged file's status to `Obsolete`. Do not assume the current status is `Active` — a flow may be `Draft`. Substitute whatever status is present, and assert the file actually changed:

```bash
TARGET="runbooks/pre-deploy/metaData/flows/<flowApiName>.flow-meta.xml"
python3 - "$TARGET" <<'PY'
import re, sys
p = sys.argv[1]
src = open(p).read()
new, n = re.subn(r"<status>[^<]*</status>", "<status>Obsolete</status>", src, count=1)
if n != 1:
    sys.exit("ERROR: no <status> element found — cannot mark flow Obsolete")
if new == src:
    print("WARNING: status was already Obsolete")
open(p, "w").write(new)
PY
```

The substitution matches any status value, not just `Active`; a `Draft` flow is handled. It exits non-zero if no `<status>` element exists. Do not use a checksum to detect the change — `md5 -q` is BSD-only and `md5sum` is GNU-only, so either choice breaks on the other platform.

If the command errors, stop. Staging a source whose status is not `Obsolete` defeats the purpose of the move.

`FlowDefinition` alone is sufficient to deactivate; the staged source is not strictly required. It is retained for fidelity with commit `8e3154c`, the pattern proven through the real pipeline. Do not drop it. If staging the source creates an additional flow version, the headroom above `highest` absorbs it.

## Phase 8 — force-app clearance gate

Run this before writing any manifest. It is the assertion that makes the Phase 3 target safe, and it runs on both paths.

```bash
F="<flowApiName>"
find force-app -name "$F.flow-meta.xml"
```

- **Deprecation** — the command must print nothing. Any hit is a hard stop: the main deploy still carries the flow and would recreate it after `post` deleted every version. The deploy reports success and the flow survives.
- **Rebuild** — the command must print at least one path. An empty result is a hard stop: `pre` would delete every version and the main deploy would have no source to recreate the flow from.

Search all of `force-app`, not one guessed path. A second copy of the flow under another package directory satisfies a `test -f` on the canonical path while still feeding the main deploy.

Query the working tree, not the git index. Do not substitute `git ls-files` — it reads the index, so it keeps printing the flow's path after Phase 7's `rm` and until the deletion is staged. It would fail this gate on every deprecation.

Stop on failure. Do not repair the tree and continue — Phase 7 owns the removal, and a violation here means its assertions were bypassed.

Deprecation leaves the deletion unstaged. Tell the user in Phase 10 to stage it (`git add -A`) when they commit: a commit that omits the deletion ships a `post` manifest against a flow the main deploy still contains.

## Phase 9 — Manifest merge

Insert the Phase 2 `<types>` block into the target manifest, immediately before the `<version>` element. Preserve existing `<types>` blocks for other metadata types.

Save the Phase 2 block to a file, then run:

```bash
python3 - "$TARGET_MANIFEST" "$BLOCK_FILE" <<'PY'
import sys
manifest, block_file = sys.argv[1], sys.argv[2]
src = open(manifest).read()
block = open(block_file).read().rstrip("\n")
if "<name>Flow</name>" in src:
    sys.exit("ERROR: manifest already contains a Flow types block — merge by hand")
marker = "    <version>"
if marker not in src:
    sys.exit("ERROR: no <version> element found in manifest")
open(manifest, "w").write(src.replace(marker, block + "\n" + marker, 1))
print(f"merged Flow block into {manifest}")
PY
```

If the command reports an existing `Flow` block, merge the members by hand rather than overwriting — another flow may already be queued for deletion in the same release.

## Phase 10 — Report

Print the artifacts written, then state all three caveats verbatim.

- The manifest deliberately names versions that do not exist. That is safe in CI, which deploys destructive changes with `ignoreWarnings: true` via `CICD_node-metadata-deploy-lib` and only logs undeleted components. A local `sf project deploy start` against this manifest requires `--ignore-warnings` or it fails on those members.
- The version list is generated from the connected org, counting down to `1`. That covers every environment holding a lower version. A version above the top listed in Phase 2 in some other environment would survive silently.
- A single `delete` is capped at 10,000 rows. A flow with more Error interviews than that needs chunking, which the emitted Apex does not implement. State this ceiling.

Remind the user that `deletePackage/` and `runbooks/pre-deploy/metaData/` are transient release scratch space, emptied after a release ships. This skill appends to them; it does not own their lifecycle.

Do not commit. The user commits manually. On the deprecation path, tell them to stage the `force-app` deletion — `git add -A`, not `git add <file>` — and show them `git status --short` for the flow. Git records the move as a rename once both the deletion and the staged copy are staged together.
