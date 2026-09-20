---
name: head-moves-midtask-use-index-baseline
description: HEAD can be rewritten underneath a session at any time by any actor, so prove
  a scoped change against the index rather than HEAD; `MM` in git status is the tell
metadata:
  type: reference
---

Prove a "changed only X" constraint by diffing the working tree against the **index**
(`git show :<path>`), never against HEAD. Assume HEAD can move under you at any moment —
a reset, amend, squash or rebase by a coordinating agent, another worktree sharing the
repository, or the user — with nothing said about it in the task. `MM` for a file in
`git status`, staged and unstaged changes at once, is the observable tell that the two
baselines have already diverged; do not wait for anyone to state an intention to rewrite
history, because the statement usually never comes.

**Why:** A rewrite while an edit is in progress silently changes what "the previous state"
means. When HEAD is reset backwards mid-edit, a value the task is reasoning about can be
absent from the HEAD blob while present and
staged in the index. A HEAD-based check therefore reports edits the session never made.
`git diff` with no arguments already compares against the index, which is why the
authoritative diff and a hand-rolled HEAD comparison disagreed.

**How to apply:** For a constraint such as "comment text only" or "no declaration changed",
strip the excluded content from both sides and diff index against working tree — for CSS,
`diff <(git show :$f | perl -0777 -pe 's{/\*.*?\*/}{}gs') <(perl -0777 -pe '...' $f)`.
Identical output is positive proof no declaration, value or selector moved, and it stays
valid however HEAD is rewritten underneath. Never reach for `git checkout`, `git restore`
or `git stash` to tidy a diverged baseline; the staged state may be someone else's
in-flight work. See [[scope-git-commit-with-pathspec]] for the related hazard of a shared
index carrying other sessions' staged files.
