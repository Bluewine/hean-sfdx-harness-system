# Runbook stage guardrail

Status: approved by the user on 2026-10-08 (all three parts; warn at write time, refuse at commit).

## Problem

Each client repository's `deploy.yml` lists the steps the shared Jenkins library runs in the `pre` and `post` stages, and the library runs only the listed steps. Repositories differ. `rews-corrigo-integration` has no `pre` `metadata-destruct`, and its `post` stage runs only `runSFDXCommandFromFile`. A file placed under a stage folder whose step is not listed is never deployed, and nothing reports it: a session added `runbooks/post-deploy/metaData/flowDefinitions/…flowDefinition-meta.xml` in corrigo, tested it with a hand deploy, and only a PR review bot caught that the flow would stay active.

Verified `deploy.yml` contents (origin/integration, 2026-10-08):

| Step | rews-field-service | rews-base | rews-corrigo-integration |
|---|---|---|---|
| `pre.metadata[].sourceFolder: ./runbooks/pre-deploy/metaData/` | yes | yes | yes |
| `pre.runAnonymousScriptFromDir: runbooks/pre-deploy/apex` | yes | yes | yes |
| `pre` commands file `runbooks/pre-deploy/sf/commands.txt` | `runSFCommandFromFile` | `runSFDXCommandFromFile` | `runSFDXCommandFromFile` |
| `pre.metadata-destruct[].destructiveChangesXml: deletePackage/pre/destructiveChangesPre.xml` | yes | yes | no |
| `post.metadata[].sourceFolder: ./runbooks/post-deploy/metaData/` | yes | yes | no |
| `post.runAnonymousScriptFromDir: runbooks/post-deploy/apex` | yes | yes | no |
| `post` commands file `runbooks/post-deploy/sf/commands.txt` | `runSFCommandFromFile` | `runSFDXCommandFromFile` | `runSFDXCommandFromFile` |
| `post.metadata-destruct[].destructiveChangesXml: deletePackage/post/destructiveChangesPost.xml` | yes | yes | no |

## Path → required step

`<stage>` is `pre` or `post`, from `runbooks/<stage>-deploy/` or `deletePackage/<stage>/`.

| Path written or staged | Required in `deploy.yml` |
|---|---|
| `runbooks/<stage>-deploy/metaData/**` (any file except `.keep`) | `<stage>.metadata[].sourceFolder` naming that folder (compare after removing a leading `./` and a trailing `/`) |
| `runbooks/<stage>-deploy/apex/*.apex` | `<stage>.runAnonymousScriptFromDir` equal to that folder (same normalisation) |
| `runbooks/<stage>-deploy/sf/commands.txt` with a line other than blank, a comment, or the placeholder `version`; or any other file under `runbooks/<stage>-deploy/sf/` | `<stage>.runSFCommandFromFile` or `<stage>.runSFDXCommandFromFile` equal to `runbooks/<stage>-deploy/sf/commands.txt` |
| an added `<members>` entry in `deletePackage/<stage>/destructiveChanges<Stage>.xml` (compared with HEAD) | `<stage>.metadata-destruct[].destructiveChangesXml` equal to that file |

A path whose step exists in the other stage gets that stage named in the message ("`pre` runs this step; `post` does not").

## Parts

### 1. Shared library `scripts/lib/deploy-steps.mjs`
- Reads `<repo root>/deploy.yml` from the working tree. No YAML dependency: a small parser for this file's fixed shape (top-level `pre:`/`deploy:`/`post:`, two-space nested keys, scalar values with or without quotes, `- key: value` list items with continuation keys). Comment lines and blank lines are ignored.
- `requiredStep(path, repoRoot) → { stage, key, value } | null` for the table above, and `stepPresent(steps, req) → boolean`.
- No `deploy.yml`, or a file it cannot parse → returns "unknown", and every caller allows (fails open) with no message for "no file" and a `!!` line for "cannot read".

### 2. Commit-time refusal (new Claude Code PreToolUse Bash hook `hooks/runbook-stage-gate.mjs`)
- Applies to `git commit` in a repository with `deploy.yml` at its root. Works out what the commit records with `scripts/lib/staging.mjs` (`stagingOf`), as the manifest check does; unnameable staging → allow with a `!!` line.
- For every recorded path in the table (for `commands.txt` and `deletePackage` files, compare the recorded content with HEAD to decide whether a real line or a new `<members>` entry was added), refuse when the required step is missing. One refusal lists every offending path with the missing key and, when it exists, the stage that has the step, and says to move the file to a stage that runs that step or to add the step to `deploy.yml` (a change the user decides).
- Files only deleted from a stage folder are never refused.
- Registered in `hooks/hooks.json` next to the other commit checks with a 10-second timeout (no `sf` call).

### 3. Write-time warning
- The existing `hooks/runbook-compile-check.mjs` PostToolUse Write/Edit path (it already runs for every Write and Edit) gains a call into the same library for the written path, adding a `!!` warning as additional context when the step is missing. It never blocks. A runbook `.apex` file in a stage that does not run it is not compiled (the warning replaces the compile).

### 4. Skills and rule follow `deploy.yml`
- `assets/rules/project/runbook-deployment-steps.md`:
  - "Stage mechanics" says the repository's `deploy.yml` decides which steps each stage runs, lists the four step kinds in the order the library runs them (metadata, anonymous Apex, commands file, metadata-destruct), names both commands-file keys, and says a stage folder whose step is missing is never deployed.
  - "Automatic rows" derives a row only for a step `deploy.yml` lists; a changed file in a folder whose step is missing gets a `!!` line instead of a row.
- `skills/create-pr/SKILL.md` and `skills/update-pr/SKILL.md`: where they derive automatic rows, read `deploy.yml` first and apply the rule above.
- `skills/deprecate-flow/SKILL.md`: before choosing the destructive target and the commands file, read `deploy.yml`; use only a stage whose step exists. When the stage the deprecation intent needs (Deprecation → `post` destruct; Rebuild → `pre` destruct; the interview cleanup → `pre` commands file) lacks its step, stop before writing anything and report which `deploy.yml` key is missing; never switch stages on its own, because a different stage changes when the deletion runs relative to the main deploy. Replace the field-service-only key name with "the commands-file step (`runSFCommandFromFile` or `runSFDXCommandFromFile`)".

## Tests
- `scripts/__tests__/deploy-steps.test.mjs`: the parser on the three verified shapes (field-service, base, corrigo, copied as fixtures), quotes, `./` and trailing `/` normalisation, comments, a missing file, an unparsable file.
- `hooks/__tests__/runbook-stage-gate.test.mjs` with temporary git repositories: corrigo shape refuses `runbooks/post-deploy/metaData/…`, `runbooks/post-deploy/apex/x.apex`, an added `<members>` in `deletePackage/post/destructiveChangesPost.xml` and `deletePackage/pre/destructiveChangesPre.xml`; allows `runbooks/pre-deploy/metaData/…`, `runbooks/post-deploy/sf/commands.txt` with a real line, `.keep`, deletions, a placeholder-only `commands.txt`; field-service shape allows all; no `deploy.yml` allows; `-a`, commit by path, same-call `git add` handled.
- `hooks/__tests__/runbook-compile-check.test.mjs`: the write-time warning appears for the corrigo shape and not for the field-service shape; no compile for a stage that does not run `apex`.

## Release
One plugin release. Hooks take effect after `/reload-plugins` or a restart; the rule reaches a repository when `/hean-harness:setup` runs there again.
