---
name: sync-to-branch
description: Full directory mirror from current branch to target branch via git worktree — bit-for-bit replication of specified paths excluding non-SFDX files, one commit per directory
---

You are executing the `/sync-to-branch` skill. Work through the phases below in order. Do not create a worktree until Phase 3.

## Phase 1 — Gate

Extract the target branch name and directory paths from the invocation arguments.

- If the target branch is absent: stop and ask "Which branch should I sync these directories to?"
- If no directories are specified: stop and ask "Which directories should I sync to `<target-branch>`?"
- Do not proceed until both are supplied explicitly.

Capture `$REPO_ROOT` via `git rev-parse --show-toplevel`.

For each specified directory: verify it exists physically on disk at `$REPO_ROOT/<dir>`. Use `test -d "$REPO_ROOT/<dir>"`. If a path does not exist on disk, mark it `SKIPPED — not found` and continue with the remaining paths. If all paths are missing, stop entirely.

Record the current source branch via `git branch --show-current`. Store as `$SOURCE_BRANCH`.

Verify the target branch exists locally: run `git branch --list <target-branch>`. If the output is empty, stop and report the error — never create the branch, never run `git fetch`.

Verify the target branch is not the same as `$SOURCE_BRANCH`. If they are identical, stop and report: "Target branch `<target-branch>` is the same as the current branch — cannot sync to self."

Also run `git worktree list --porcelain` and check whether the target branch appears as a `branch` entry in any existing worktree. If it does, stop and report: "Target branch `<target-branch>` is already checked out in another worktree — remove that worktree first."

Extract the work ID by matching `W-\d+` (case-insensitive) in the target branch name. Record as `$WORK_ID` if found. If not found, leave unset — never fabricate a work ID.

## Phase 2 — Build file inventory

For each directory that passed Phase 1 validation, enumerate all files recursively from the physical filesystem:

```
find "$REPO_ROOT/<dir>" -type f
```

Do not consult git at this stage. The worktree does not exist yet.

Apply the exclusion filter to every file in the result:

**Hard exclusions — never copy:**
- Any file whose path contains `/.claude/` at any depth
- Any file named `CLAUDE.md` at any path
- Any file with a `.sh` extension
- Any file with a `.py` extension
- Any file under a directory whose name contains `claude`, `mcp`, `memory`, or `prompt` (case-insensitive), or is exactly `.mcp`, `.memory`, or `.prompts`

Record every excluded file and the rule that triggered exclusion.

If a directory's filtered result is empty after exclusion, mark it `SKIPPED — all files excluded` and continue with remaining directories.

The filtered result per directory is the **incoming inventory** for that directory.

Strip the `$REPO_ROOT/` prefix from every path in the incoming inventory so all paths are repo-relative — this ensures direct comparison with `git -C "$WT" ls-files` output in Phase 3.

## Phase 3 — Create worktree and capture pre-sync target state

1. Create the worktree:
   ```
   git worktree add /tmp/sync-<timestamp> <target-branch>
   ```
   Use a timestamp suffix (e.g. `date +%s`). Record the path as `$WT`. If this command fails for any reason, report the error and stop — do not proceed to Phase 4 or 5. Do not attempt cleanup of a worktree that was never created.

2. Verify the source branch is unchanged:
   ```
   git -C "$REPO_ROOT" branch --show-current
   ```
   The output must match `$SOURCE_BRANCH`. If it does not, run `git worktree remove "$WT" --force` and abort the entire run.

3. For each directory in the incoming inventory, capture the pre-sync target file list:
   ```
   git -C "$WT" ls-files <dir>
   ```
   Files present in this list but absent from the incoming inventory are **removed-from-target** entries for that directory. Record them per directory.

4. For each directory, run a pre-flight content check:

   First, check whether the target directory exists in the worktree: `test -d "$WT/<dir>"`.
   - If **absent** → record `pre-flight: new` without running the diff.
   - If **present** → run `git diff --no-index -w --quiet "$REPO_ROOT/<dir>" "$WT/<dir>"`:
     - Exit code **0** → record `pre-flight: likely-in-sync`
     - Exit code **1** → record `pre-flight: has-changes`

   This check runs before any copy and does not modify the worktree.

## Phase 4 — Draft commit messages and confirm

For each directory, draft a commit message:

- Compare the incoming inventory against the pre-sync target file list:
  - **New files:** present in incoming, absent from target list
  - **Removed files:** present in target list, absent from incoming
  - **Present in both:** assumed modified
- Write a subject line describing the conceptual content change — what was added, modified, or removed — as if the work happened directly on the target branch. Never mention the source branch, the sync operation, or any git mechanics.
- Format: `@$WORK_ID: Capitalized subject` when `$WORK_ID` is set; plain `Capitalized subject` otherwise. Subject must be under 6 words, first word capitalized after the work ID tag.
- Never add a co-author line anywhere in the commit message.

When the directory carries `pre-flight: likely-in-sync`, include the pre-flight warning line in the confirmation block; omit it for `has-changes` and `new` directories.

Present the confirmation prompt **one directory at a time**, in invocation order. For each directory, show its block (included files, excluded files, will-be-removed-from-target, proposed commit message) followed by `Proceed? (yes / no / edit message)`. Wait for the user's response before moving to the next directory.

- If the user says **no** for any directory: run `git worktree remove "$WT" --force` and stop the entire run.
- If the user **edits a message**: record the updated message for that directory, then re-present the same directory's block with the updated message and ask `Proceed? (yes / no / edit message)` again.
- If the user says **yes**: record confirmation and move to the next directory.

Only proceed to Phase 5 after every directory has received a `yes` confirmation.

The confirmation prompt format for each directory:

```
## Sync Plan — Directory N of M

Source branch: `<branch>`
Target branch: `<target-branch>`

### Directory: <path>

**Included (N files)**
- <file>
- ...

**Excluded (N files)**
| File | Reason |
|------|--------|
| <file> | <rule> |

**Will be removed from target (N files)**
| File |
|------|
| <file> |

**Proposed commit message:** `@W-12345678: <subject>`
**Pre-flight:** ⚠️ likely no real changes — will skip at commit time

Proceed? (yes / no / edit message)
```

## Phase 5 — Execute

For each confirmed directory in invocation order, execute the following steps in sequence. Any failure at any step triggers worktree removal and aborts the entire run — previously committed directories in the same run remain committed on the target branch.

**a. Wipe target directory:**
```
rm -rf "$WT/<dir>"
```

**b. Ensure parent directory exists:**
```
mkdir -p "$WT/$(dirname <dir>)"
```

**c. Copy source directory:**
```
cp -r "$REPO_ROOT/<dir>" "$WT/$(dirname <dir>)/"
```
If `cp` exits non-zero: run `git worktree remove "$WT" --force`, report the failing directory, and abort. Do not continue to the next directory.

**d. Re-apply exclusion filter on the copy:**
```
find "$WT/<dir>" -name "CLAUDE.md" -delete
find "$WT/<dir>" -name "*.sh" -delete
find "$WT/<dir>" -name "*.py" -delete
find "$WT/<dir>" -path "*/.claude/*" -delete
find "$WT/<dir>" -type d -iname "*claude*" -exec rm -rf {} + 2>/dev/null || true
find "$WT/<dir>" -type d -iname "*mcp*" -exec rm -rf {} + 2>/dev/null || true
find "$WT/<dir>" -type d -iname "*memory*" -exec rm -rf {} + 2>/dev/null || true
find "$WT/<dir>" -type d -iname "*prompt*" -exec rm -rf {} + 2>/dev/null || true
```

**e. Stage all changes:**
```
git -C "$WT" add -A -- <dir>
```

**f. Verify staged set:**
Run `git -C "$WT" diff --cached --name-only`. Every path listed must be under `<dir>`. If any path outside `<dir>` appears:
```
git -C "$WT" reset HEAD
git worktree remove "$WT" --force
```
Abort the entire run and report the unexpected path. Any directories already committed earlier in this run are left as-is on the target branch — include them in the abort report as committed.

**g. Commit:**
Before committing, run `git -C "$WT" diff --cached -w --quiet`. If the exit code is 0 (no real changes staged — whitespace differences ignored), unstage with `git -C "$WT" reset HEAD -- <dir>`, record this directory as `SKIPPED — no real changes`, and continue to the next directory. Only treat a non-zero `git commit` exit as a failure.

```
git -C "$WT" commit -m "<confirmed message>"
```
Record the resulting SHA. If the commit exits non-zero: run `git worktree remove "$WT" --force`, report the failure, and stop. Any directories already committed in this run are left as-is on the target branch — include them in the final report as committed.

## Phase 6 — Cleanup and report

Remove the worktree unconditionally:
```
git worktree remove "$WT" --force
```

Output the final report:

```
## Sync Result

**Status:** SUCCESS | PARTIAL — N of M committed | BLOCKED — reason
**Source branch:** `<branch>` (unchanged)
**Target branch:** `<target-branch>`

| Directory | Files synced | Removed from target | Commit SHA | Message | Status |
|-----------|-------------|---------------------|------------|---------|--------|
| `<path>` | N | N | `<sha>` | `<message>` | committed |
| `<path>` | — | — | — | — | SKIPPED — <reason> |

## Excluded Files
| File | Reason |
|------|--------|
| `<file>` | <rule> |
```

**Abort report** (output when the run is aborted mid-execution due to a failure in Phase 5):

```
## Sync Result

**Status:** PARTIAL — N of M committed | BLOCKED — reason
**Source branch:** `<branch>` (unchanged)
**Target branch:** `<target-branch>`

| Directory | Files synced | Removed from target | Commit SHA | Message | Status |
|-----------|-------------|---------------------|------------|---------|--------|
| `<path>` | N | N | `<sha>` | `<message>` | committed |
| `<path>` | — | — | — | — | FAILED — <step>: <reason> |
| `<path>` | — | — | — | — | not reached |

## Excluded Files
| File | Reason |
|------|--------|
| `<file>` | <rule> |
```

Rows that were committed before the failure appear with their SHAs. The failing directory row shows `FAILED — <step>: <reason>`. Directories not yet processed appear as `not reached`.

Never include deployment instructions in any output section. Deployment is the user's responsibility.