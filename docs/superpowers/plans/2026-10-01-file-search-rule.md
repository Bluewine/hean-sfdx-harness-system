# File Search Rule Plan

Spec: user-approved design in session (2026-10-01), revised by the user's answer "Allow cd to a root".

**Goal:** Ship a global user rule that makes every file search start from the project root and cover the whole root, so a session standing in a subfolder never reports "not found" for a file elsewhere in the project.

## Global Constraints

- The rule file lives at `plugins/hean-harness/assets/rules/user/file-search.md`. Setup copies every file in that folder to `~/.claude/rules/`; no setup code changes.
- File content is exactly the text in Task 1, ending with one newline and no trailing blank lines (user rule `no-body-separators-or-trailing-blanks.md`). No `---` lines.
- `docs/wiki-coverage.md` gets one row in the Rules table, in alphabetical order among the `global` rows: `| file-search.md | global | Global Rules | documented |`.
- Commit by explicit path. Subject `@HEAN-1: Add the file search rule for root-wide searches`. No trailers of any kind.
- No version bump in this task.

## Task 1: Add the file search rule and its coverage row

**Files:**
- Create: `plugins/hean-harness/assets/rules/user/file-search.md`
- Modify: `docs/wiki-coverage.md` (Rules table)

- [ ] **Step 1: Create the rule file with exactly this content**

```markdown
# File Search

Apply before every search for a file, a folder, or text inside files, in every repository.

## Rules

- **Root first**: Before the first search, compare the current directory with the project root
  (`git rev-parse --show-toplevel`). In a worktree, the root is the worktree's top folder.
  When the two differ, search from the root.
- **No `cd` into subfolders**: Never `cd` into a subfolder. The working directory carries over to
  every later call. A step that must change directory goes only to a repository or worktree
  root. Use paths that start at the project root.
- **Whole root**: Search the entire project root. Narrow to a subfolder only after a search of
  the whole root, never in place of it. Leave out only `.git`, `node_modules` and
  `.claude/worktrees` (other branches' copies).
- **Search tools**: When Grep or Glob is given a path, give the project root or a folder chosen
  after a whole-root search.
- **Empty results**: Before reporting that something does not exist, run the same search for a
  file known to exist. When that search also returns nothing, the search is broken. Fix it
  before answering.
- **Report**: A "not found" answer names the folder searched and the search used.
- **Refused command**: When a hook or guard refuses a command because of its path, return to
  the project root and rerun the search with a root-relative path. Do not keep rewriting the
  same command.
```

- [ ] **Step 2: Add the coverage row**

Insert `| file-search.md | global | Global Rules | documented |` into the Rules table of `docs/wiki-coverage.md`, after `| claude-md-authoring.md | global | Global Rules | documented |`.

- [ ] **Step 3: Verify**

- The file ends with exactly one newline: `tail -c 1` prints a newline and the last line is not blank.
- No line in the rule file is `---`.
- Run every plugin test file, one at a time, none in parallel: each `*.test.mjs` under `plugins/hean-harness/hooks/__tests__/` and `plugins/hean-harness/scripts/__tests__/`, with `node`. All pass. Never commit `plugins/hean-harness/assets/rules/user/zz-test-dropped-rule.md`, which one test writes briefly.

- [ ] **Step 4: Commit**

Stage only the two files by path and commit with the subject in Global Constraints.
