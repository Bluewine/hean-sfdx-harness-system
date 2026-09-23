---
name: commit-walk-sync
description: Commit-by-commit directory sync from a source branch (current or user-supplied) to a target branch via two git worktrees — walks a SHA range, copies changed directories per commit with full exclusion filtering, and replays original commit messages updated with the target branch work ID
---

You are executing the `/commit-walk-sync` skill. Work through the phases below in order. Do not create worktrees until Phase 4.

## Phase 1 — Gate

Extract `<start-sha>`, `<target-branch>`, and optional `<source-branch>` from the invocation arguments.

- If `<start-sha>` is absent: stop and ask "Which commit SHA should I start from?"
- If `<target-branch>` is absent: stop and ask "Which branch should I sync commits to?"
- Do not proceed until both are supplied.

Resolve `$SOURCE_BRANCH`:

If `<source-branch>` was provided:
- Set `$SOURCE_BRANCH = <source-branch>` and `$SOURCE_BRANCH_INFERRED = false`.
- Verify it exists locally: `git branch --list <source-branch>`. If empty, stop and report.

If `<source-branch>` was not provided:
- Run `git branch --show-current`. Set `$SOURCE_BRANCH_INFERRED = true`.
- If the output is empty (detached HEAD), stop and report — the skill requires a named branch.
- Set `$SOURCE_BRANCH` to the output.

Verify `<target-branch>` exists locally:
```
git branch --list <target-branch>
```
If empty, stop and report — never create the branch, never run `git fetch`.

Verify `<target-branch>` ≠ `$SOURCE_BRANCH`. If identical, stop and report: "Target branch `<target-branch>` is the same as the source branch — cannot sync to self."

Verify `<target-branch>` is not already checked out in another worktree:
```
git worktree list --porcelain
```
If `<target-branch>` appears as a `branch` entry in any worktree, stop and report: "Target branch `<target-branch>` is already checked out in another worktree — remove that worktree first."

Verify `<start-sha>` is reachable from `$SOURCE_BRANCH`:
```
git merge-base --is-ancestor <start-sha> $SOURCE_BRANCH
```
If this exits non-zero, stop and report: "`<start-sha>` is not reachable from `$SOURCE_BRANCH`."

Capture `$REPO_ROOT`:
```
git rev-parse --show-toplevel
```

## Phase 2 — Build commit list

```
git log --reverse --first-parent --no-merges <start-sha>^..$SOURCE_BRANCH --format="%H %s"
```

Record each SHA and its subject line in order (oldest first). This is the ordered walk list.

Note: the `^` suffix on `<start-sha>` (not on the branch) makes the range inclusive of `<start-sha>` itself.

## Phase 3 — Resolve work ID

Try to extract `$WORK_ID` by matching `W-\d+` (case-insensitive) in `<target-branch>`. If found, set `$WORK_ID` and proceed to Phase 4.

If not found in the branch name, scan all subject lines in the walk list for `@W-\d+:` prefixes (case-insensitive) and collect the distinct work IDs found.

- **Exactly one distinct ID found:** set `$WORK_ID` to that value.
- **Multiple distinct IDs found:** present the list to the user and ask which to use. Accept only a value matching `W-\d+` (case-insensitive); re-prompt on mismatch. Do not proceed to Phase 4 until a valid value is entered.
- **Zero found:** ask the user: "No work ID found in the target branch name or source commits. Please provide a work ID (format: W-followed by digits, e.g. W-12345678):". Accept only a value matching `W-\d+` (case-insensitive); re-prompt on mismatch. Do not proceed to Phase 4 until a valid value is entered.

`$WORK_ID` is fixed for the entire run once resolved here. It is never re-resolved per-commit.

## Phase 4 — Create worktrees

Use a timestamp suffix for path uniqueness (e.g. `date +%s`).

1. Create the source worktree in detached HEAD state at `<start-sha>`:
```
git worktree add /tmp/cwalk-src-<ts> --detach <start-sha>
```
Record the path as `$SRC_WT`.

2. Create the target worktree on `<target-branch>`:
```
git worktree add /tmp/cwalk-tgt-<ts> <target-branch>
```
Record the path as `$TGT_WT`.

If either creation fails: remove the worktree that succeeded (if any) before stopping — do not attempt to remove a worktree that was never created. Report the error and stop. Do not proceed to Phase 5.

When `$SOURCE_BRANCH_INFERRED` is true, verify the source branch is still current:
```
git branch --show-current
```
The output must match `$SOURCE_BRANCH`. If not, remove both worktrees and abort the entire run.

## Phase 5 — Commit loop (per-commit)

For each SHA in the walk list, in order:

**a. Advance source worktree:**
```
git -C "$SRC_WT" checkout <sha>
```

**b. Derive changed file list:**
```
git diff <sha>^ <sha> --name-only
```

**c. Apply exclusion filter to file list.**

Exclude any file whose path:
- Contains `/.claude/` at any depth
- Is named `CLAUDE.md` at any path
- Has extension `.sh` or `.py`
- Is under a directory whose name contains `claude`, `mcp`, `memory`, or `prompt` (case-insensitive), or is exactly `.mcp`, `.memory`, or `.prompts`
- Starts with `manifest/`
- Starts with `docs/superpowers/`

Record every excluded file and the rule that triggered exclusion.

If all files for this commit are excluded after filtering, record the commit as `SKIPPED — all files excluded` and continue to the next SHA.

**d. Derive directories from remaining file list.**

Take the parent directory (`dirname`) of each remaining file path. Deduplicate: if directory A is a subdirectory of directory B in the list, drop A and keep B. A is a subdirectory of B only if A starts with B followed immediately by `/` — a plain string-prefix match is not sufficient (e.g. `force-app/main/foo/` must not match against `force-app/main/foobar/baz/`). The result is the minimal covering directory set.

If the set is empty after deduplication, record this commit as `SKIPPED — all files excluded` and continue to the next SHA.

**e. Pre-flight content check.**

For each directory in the set:

- Absent in `$SRC_WT` (deleted in this commit) → record `pre-flight: deleted`. Skip the diff below.
- Present in `$SRC_WT`, absent in `$TGT_WT` → record `pre-flight: new`. Skip the diff below.
- Present in both → run `git diff --no-index -w --quiet "$SRC_WT/<dir>" "$TGT_WT/<dir>"`:
  - Exit 0 → record `pre-flight: likely-in-sync`
  - Exit 1 → record `pre-flight: has-changes`

This check is informational only. It does not modify the worktree.

**f. Per-commit confirmation prompt.**

Compose the proposed commit message:
- Strip any leading `@W-\d+:\s*` prefix from the source commit's subject line to get the bare subject.
- Proposed message = `@$WORK_ID: <bare subject>`.

Present the following block and wait for `yes / no / edit message` before proceeding:

```
## Commit N of M — <sha>

Source branch: `<source-branch>` at `<sha>`
Target branch: `<target-branch>`

**Proposed commit message:** `<composed message>`
**Directories to copy (N):**
- <dir>
- ...

**Excluded files (N):**
| File | Reason |
|------|--------|
| <file> | <rule> |

**Pre-flight notes:**
- <dir>: ⚠️ likely-in-sync — may produce no real changes

Proceed? (yes / no / edit message)
```

- `no` → remove both worktrees and stop the entire run.
- `edit message` → record the updated message, re-present the same block with the updated message, ask again.
- `yes` → proceed to step g.

**g. Execute copy for each confirmed directory (in order):**

For each directory, first check whether it exists in `$SRC_WT` at the current SHA:
```
test -d "$SRC_WT/<dir>"
```

**If the directory is absent** (deleted in this commit):
```
rm -rf "$TGT_WT/<dir>"
git -C "$TGT_WT" add -A -- <dir>
```
Verify all staged paths are under `<dir>`: run `git -C "$TGT_WT" diff --cached --name-only`. If any path outside `<dir>` appears: run `git -C "$TGT_WT" reset HEAD`, remove both worktrees, abort the entire run.
Record the directory as `deleted` and continue to the next directory.

**If the directory is present**, execute:

1. Wipe target directory:
```
rm -rf "$TGT_WT/<dir>"
```

2. Ensure parent exists:
```
mkdir -p "$TGT_WT/$(dirname <dir>)"
```

3. Copy from source worktree:
```
cp -r "$SRC_WT/<dir>" "$TGT_WT/$(dirname <dir>)/"
```
If `cp` exits non-zero: remove both worktrees, report the failing directory, abort.

4. Re-apply exclusion filter on the copy:
```
find "$TGT_WT/<dir>" -name "CLAUDE.md" -delete
find "$TGT_WT/<dir>" -name "*.sh" -delete
find "$TGT_WT/<dir>" -name "*.py" -delete
find "$TGT_WT/<dir>" -path "*/.claude/*" -delete
find "$TGT_WT/<dir>" -type d -iname "*claude*" -exec rm -rf {} + 2>/dev/null || true
find "$TGT_WT/<dir>" -type d -iname "*mcp*" -exec rm -rf {} + 2>/dev/null || true
find "$TGT_WT/<dir>" -type d -iname "*memory*" -exec rm -rf {} + 2>/dev/null || true
find "$TGT_WT/<dir>" -type d -iname "*prompt*" -exec rm -rf {} + 2>/dev/null || true
```

5. Stage:
```
git -C "$TGT_WT" add -A -- <dir>
```

6. Verify staged paths are all under `<dir>`: run `git -C "$TGT_WT" diff --cached --name-only`. If any path outside `<dir>` appears: run `git -C "$TGT_WT" reset HEAD`, remove both worktrees, abort the entire run.

All directories for this SHA are staged before the commit in step h. The commit is once per visited SHA, not once per directory.

**h. Commit (once, after all directories for this SHA are staged):**

Check for real changes:
```
git -C "$TGT_WT" diff --cached -w --quiet
```
Exit 0 → no real changes. Run `git -C "$TGT_WT" reset HEAD`, record this commit as `SKIPPED — no real changes`, and continue to the next SHA.

If exit non-zero, commit:
```
git -C "$TGT_WT" commit -m "<confirmed message>"
```
Record the resulting SHA. If the commit exits non-zero: remove both worktrees, report failure, stop. Any commits already made in this run are left as-is on the target branch — include them in the failure report.

## Phase 6 — Cleanup and report

Remove both worktrees unconditionally:
```
git worktree remove "$SRC_WT" --force
git worktree remove "$TGT_WT" --force
```

Output the final report:

```
## Commit-Walk-Sync Result

**Status:** SUCCESS | PARTIAL — N of M committed | BLOCKED — reason
**Source branch:** `<branch>` (unchanged)
**Target branch:** `<target-branch>`

| # | Source SHA | Message | Directories | Target SHA | Status |
|---|-----------|---------|-------------|-----------|--------|
| 1 | `<sha>` | `<msg>` | N | `<sha>` | committed |
| 2 | `<sha>` | `<msg>` | — | — | SKIPPED — <reason> |

## Excluded Files
| File | Reason |
|------|--------|
| `<file>` | <rule> |
```

**Abort report** (output when the run is aborted mid-execution due to a Phase 5 failure):

```
## Commit-Walk-Sync Result

**Status:** PARTIAL — N of M committed | BLOCKED — reason
**Source branch:** `<branch>` (unchanged)
**Target branch:** `<target-branch>`

| # | Source SHA | Message | Directories | Target SHA | Status |
|---|-----------|---------|-------------|-----------|--------|
| 1 | `<sha>` | `<msg>` | N | `<sha>` | committed |
| 2 | `<sha>` | `<msg>` | — | — | FAILED — <step>: <reason> |
| 3 | `<sha>` | `<msg>` | — | — | not reached |

## Excluded Files
| File | Reason |
|------|--------|
| `<file>` | <rule> |
```

Never include deployment instructions in any output section.