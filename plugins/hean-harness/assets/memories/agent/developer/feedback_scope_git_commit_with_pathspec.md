---
name: scope-git-commit-with-pathspec
description: Always restrict git commit to an explicit pathspec in this repo, not just
  the prior git add
metadata:
  type: feedback
---

Run `git commit -m "..." -- <file1> <file2> ...` (pathspec after `--`) whenever committing
a specific set of files in this repo, never a bare `git commit -m "..."` after `git add`-ing
only those files.

**Why:** This is a shared working directory — other concurrent sessions or agents can leave
unrelated files already staged before this session even starts. `git add <my files>` only
adds to whatever is already in the index; it does not clear it. A follow-up
`git commit -m "..."` with no pathspec commits the entire index — the intended files plus
every pre-existing staged file — silently pulling unrelated, unreviewed work into the commit.

**How to apply:** Before committing, run `git status --porcelain` and compare it against the
file list expected for this task. If unrelated staged entries exist, leave them untouched —
don't `git reset` them away either, in case another process depends on that staged state —
and scope the commit itself with `-- <pathspec>`. Verify with `git show --stat HEAD`
immediately after committing that only the intended files appear; if not,
`git reset --soft HEAD~1` (safe: restores the index exactly as it was, undoes only the
commit) and redo the commit with `--`.
