# Apex class list input path

**Goal:** Move the Apex coverage script's input from `<repo root>/.claude/scripts/apex-classes.txt` to `<repo root>/.claude/inputs/apex-classes.txt`, and make uninstall delete it.

**Spec:** user decision on 2026-10-05: keep the script in `plugins/hean-harness/scripts/`; input at `.claude/inputs/apex-classes.txt`; never tracked, git-ignored, one per repository (each worktree keeps its own, as today).

## Global constraints

- The file stays git-ignored through setup's existing `.claude/*` line (`scripts/lib/gitignore.mjs` `IGNORE_LINES`). Verified on 2026-10-05: `git check-ignore -v .claude/inputs/apex-classes.txt` matches `.claude/*` in rews-field-service and rews-base. Do not change `.gitignore` handling and do not add a negation.
- The path is read from the repository root (git top level of the working directory), as `apex-coverage.mjs` already does — never from the main checkout. Never add it to worktree sharing.
- No other file under `.claude/inputs/` is created or deleted by the plugin.
- The working tree already holds the uncommitted Apex coverage script change (script, lib, test, `runbook-compile.mjs`, `apex-tester.md`); this task edits those files in place.

## Task 1: Move the input path and clean it up on uninstall

**Files:**
- `plugins/hean-harness/scripts/apex-coverage.mjs`: input file `join(root, '.claude', 'inputs', 'apex-classes.txt')`; header comment updated.
- `plugins/hean-harness/scripts/lib/apex-coverage.mjs`: any comment or message naming the old path.
- `plugins/hean-harness/scripts/__tests__/apex-coverage.test.mjs`: fixtures write the new path; the missing-input test expects the new path in its message.
- `plugins/hean-harness/agents/apex-tester.md`: every `.claude/scripts/apex-classes.txt` becomes `.claude/inputs/apex-classes.txt` (Write tool usage, step 6, checklists, failure modes). `grep -n 'claude/scripts' plugins/hean-harness/agents/apex-tester.md` returns nothing afterwards.
- `plugins/hean-harness/scripts/lib/manifest.mjs` `clearPluginFiles`: also collect `<.claude>/inputs/apex-classes.txt` (that one file, not the folder's other files) as a plugin file, under the same rules as `hean-harness.json` (skip when git tracks it; never follow a symlink; dry run deletes nothing). The existing prune removes `.claude/inputs/` when it is left empty and keeps it when the user put other files there. Update the function's doc comment.
- `plugins/hean-harness/skills/uninstall/SKILL.md`: the three places that list what uninstall deletes from the repository `.claude` folder (`.claude/hean-harness.json`, skill output under `.claude/skills/*/output/`, …) also name `.claude/inputs/apex-classes.txt`.
- `plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`: next to the skill-output checks (a second setup keeps it; uninstall deletes it), add the same two checks for `.claude/inputs/apex-classes.txt`, plus one check that a user's own file in `.claude/inputs/` survives uninstall.

**Verify:** `grep -rn 'claude/scripts/apex-classes' plugins/ README.md` returns nothing; the full test loop passes (every `plugins/hean-harness/hooks/__tests__/*.test.mjs` and `plugins/hean-harness/scripts/__tests__/*.test.mjs` with node, one at a time).

**Commit** by explicit path: `@HEAN-1: Move the Apex class list to .claude/inputs`.
