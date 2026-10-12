# Per-story manifest checked at every commit

Status: design for the user's review (2026-10-07). Nothing is built.

## Problem

In a Salesforce SFDX client repository the user works in this order: implement, deploy, commit, push and verify by hand, and only then ask for a pull request. Today the per-story manifest `.claude/manifest/<WORK-ID>.xml` is first built and committed by `create-pr` or `update-pr`. The pull request therefore adds one more commit, one more push and one more Jenkins pipeline run. Later rounds of changes on the same story leave the manifest out of date until the next pull request skill runs.

## Decisions taken with the user

| Decision | Choice |
|---|---|
| Where the guarantee lives | A check on every `git commit` that touches metadata, not in `/hean-harness:finish-implementation` |
| What the committed manifest lists | What the commit records: every component added or changed between the branch's merge-base and the commit's tree. Never uncommitted or untracked files |
| When the check cannot run (`sf` missing, too slow, no base branch) | The commit goes through, with a `!!` line naming the reason the manifest was not checked |
| Hotfix and back-merge branches (`*-HF`, `*-BM`, `hotfix-*`) | Skipped |
| A manifest left with nothing to list | Deleted in that commit; `sfdx-deployer`'s no-delete rule changes to allow exactly this case |
| `create-pr` / `update-pr` manifest step | Kept as the safety net (commits nothing when the manifest is current) |
| Terminal commits | A git `pre-commit` hook, installed only where the plugin owns `.githooks/` (the repository tracks nothing there). A tracked `.githooks/` stays the repository's; `rews-field-service` is not covered for terminal commits |
| Deploy visibility | `sfdx-deployer`'s report states when the manifest was rebuilt and how many components it lists; no path warning in the org write gate |

## Components

### 1. `branch-manifest.mjs`: a mode that reads what the commit records

`plugins/hean-harness/skills/branch-manifest/scripts/branch-manifest.mjs` gains `--from-index`:

- The change list is `git diff --cached --name-status <merge-base>` (merge-base against the index), not the working tree, and untracked files are not read.
- File contents that the script reads (custom labels, to list only new or changed labels) come from the index (`git show :<path>`), not from disk.
- `--output-dir` (already supported) writes into a temporary folder.
- Without the flag the script behaves exactly as today, so `branch-manifest` run by hand, `sfdx-deployer` and the pull request skills are unchanged.

### 2. Claude Code hook `manifest-commit-check.mjs`

New `PreToolUse` hook on `Bash`, registered in `hooks/hooks.json` next to the other commit checks, with its logic in `scripts/lib/manifest-check.mjs` so the git hook in section 3 runs the same code.

**Applies only when all hold** (otherwise allow and print nothing):
- the command contains a `git commit` (parsed with `scripts/lib/command-line.mjs`), run in the repository the commit targets (`repoOf`);
- that repository's root has `sfdx-project.json`;
- the branch name contains a work ID, and the branch is not `*-HF`, `*-BM` or `hotfix-*`;
- no merge, cherry-pick, revert or rebase is in progress (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, a rebase folder);
- the commit is not `--dry-run`, and not an `--amend` that records nothing new;
- `.claude/manifest/<WORK-ID>.xml` is not git-ignored (`git check-ignore`);
- the commit records a change (added, modified or deleted) under a `packageDirectories` path.

**What the commit records** is worked out the way `hooks/flow-description-gate.mjs` already does (`stagingOf`, `flowsStagedBy`): the index, plus files staged earlier in the same command (`git add … && git commit`), plus `-a` (tracked changes), or only the named paths for `git commit … <paths>`.

**The check:**
1. Rebuild the manifest with `--from-index --output-dir <temporary folder>`. For a commit that stages files in the same command, or a commit by path, build from a temporary index that reflects what the commit will record.
2. Compare the rebuilt file with the copy of `.claude/manifest/<WORK-ID>.xml` that the commit will record (the index entry; the named path for a commit by path).
3. **Equal** → allow.
4. **Different or missing** → copy the rebuilt file into `.claude/manifest/` and refuse with:
   - `!! The per-story manifest .claude/manifest/<WORK-ID>.xml is out of date for this commit. It was rebuilt; add it to the commit and run the commit again.` followed by the exact command: `git add .claude/manifest/<WORK-ID>.xml` for an index commit, or the same commit with the manifest path added to the path list for a commit by path. The refusal lists the components added and dropped.
   - The file is written into place only on this refusal, never when the commit is allowed or refused by another check, so a commit another check refuses leaves no new change behind.
5. **Nothing left to list** (`not written`) while the committed manifest exists → refuse with the exact `git rm .claude/manifest/<WORK-ID>.xml` (or the path-list equivalent).
6. **Same-command staging already includes the rebuilt file** → allow (the file was written before `git add` runs).
7. **The check cannot run** (`sf` missing, timeout, `Error:` from the script, no base branch) → allow, with `!! The per-story manifest was not checked: <reason>.`

**Speed:** the hook's limit in `hooks.json` is 60 seconds (the other Bash hooks use 10; `sf` alone starts in about 1.4 seconds). The check keeps its own 50-second deadline: past it, it stops and allows the commit with `!! The per-story manifest was not checked: the rebuild took longer than 50 seconds.`, so Claude Code never cuts it off silently. No client repository is measured; a project with slow rebuilds sees the message on its first commit.

### 3. Git `pre-commit` hook for terminal commits

- Shipped as `assets/githooks/pre-commit`, a short POSIX `sh` script that runs `node "$HOME/.claude/hean-harness/hooks/manifest-check.mjs" --git-hook` and exits with its code. Inside a git hook, git has already built the index the commit will record (including `-a` and commits by path, through `GIT_INDEX_FILE`), so the check reads that index directly.
- Setup copies `manifest-check.mjs` and the library code it needs to the fixed path `~/.claude/hean-harness/hooks/`, refreshed on every setup run, the way the status line is copied. The git hook never points into the versioned plugin folder, which is removed after updates.
- If that script is missing (plugin uninstalled), the git hook does nothing and exits 0.
- Installed only when the repository tracks nothing in `.githooks/`, and only when `.githooks/pre-commit` does not exist. An existing file is kept, with a `!!` line, exactly as `commit-msg` is today.
- Recorded in the install record with its hash. Uninstall deletes it only when unchanged since install (otherwise it is backed up first), and restores a file it replaced.

### 4. Git hooks recognised by recorded hash (`commit-msg` too)

Today `scripts/lib/commit-format.mjs` treats an installed hook as the plugin's only when it is byte-identical to the plugin's current copy. After a plugin update changes the hook, setup keeps the old copy with `!! KEPT — NOT CHANGED … run setup again with --replace-githook`, the same message it shows for someone else's hook. With this change both git hooks are recognised by the hash setup recorded when it wrote them:

| Installed file at a setup rerun | Result |
|---|---|
| Unchanged since install, plugin copy now newer | Updated, and reported as updated |
| The plugin's copy, edited since install | Kept; the message says it is the plugin's copy edited since install; `--replace-githook` replaces it with a backup |
| Not written by the plugin | Kept, as today |
| `.githooks/` tracked by the repository | Untouched, as today |

### 5. `sfdx-deployer` agent

- Its report adds the rebuild time and the component count: `**Manifest:** .claude/manifest/<WORK-ID>.xml, rebuilt at HH:MM, N components`.
- Its rule "A file under `.claude/manifest/` is never deleted" gains one exception: the commit check may require deleting a manifest that has nothing left to list.

### 6. Unchanged on purpose

- `create-pr` and `update-pr` keep their manifest step: stop when package folders have uncommitted files, rebuild, commit the manifest only when git shows it changed. With the commit check working it commits nothing.
- `branch-manifest` run by hand, `.gitignore` handling, uninstall's treatment of `.claude/manifest/`, `feedback_manifest_location.md`, `apex-tester`'s temporary `manifest/coverage-run.xml`.

## Tests

- `branch-manifest.test.sh`: `--from-index` lists only staged changes; an untracked file and an unstaged edit are absent; labels read from the index.
- New `hooks/__tests__/manifest-commit-check.test.mjs`, with a fake `sf` and a temporary SFDX git repository: allow when current; refuse and write when stale; refuse with `git rm` when empty; `git add … && git commit` including the manifest allowed in one call; `git commit -a`; commit by path with and without the manifest; merge in progress skipped; `*-HF` branch skipped; no work ID skipped; ignored manifest skipped; `--dry-run` skipped; `sf` missing allowed with the `!!` line; another check refusing leaves no manifest change.
- `setup-twice.test.mjs`: `pre-commit` installed only for an untracked `.githooks/`; an unchanged older plugin copy is updated on rerun; an edited copy is kept with the new message; uninstall deletes or restores it.
- The full test loop passes.

## Not covered

- Commits typed in a terminal in a repository that tracks `.githooks/` (rews-field-service).
- `git commit --no-verify` in a terminal (Claude never uses it: the commit-message rule forbids it).
- History rewrites (a rebase that drops commits) until the next commit that touches metadata.
- Deleted components: they belong in `destructiveChanges`, not the per-story manifest.

## Open points for the user

None. The `commit-msg` hook moves to recognition by recorded hash in the same change (section 4), approved 2026-10-07. The time limit is set without measuring a client repository (section 2).

## Release

One plugin release. The check takes effect after `/reload-plugins` or a restart. The `pre-commit` git hook, the fixed-path script copy and the hash recognition take effect when `/hean-harness:setup` runs again in each repository.
