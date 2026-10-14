# Implementation Commits

Apply before the first change of any implementation, and before any `git commit`.

## Saved preference

The two implementation answers (`Dev mode`, `Commits`) are saved in one preference file per
machine. The saved preference applies in every repository, to implementation runs started by
`/hean-harness:start-implementation`. Never write the preference file yourself.

## Before implementation

Run `/hean-harness:start-implementation` before the first change, with or without a plan. It
replaces the execution-method question at the end of a plan.

- When it reports no saved preference, ask the two questions in one `AskUserQuestion` call. Use
  these headers and option labels exactly; the hook that saves the preference reads the answer by them.
  - **Header `Dev mode`** — "Which development mode should implementation use?"
    - `Subagent-driven` — a fresh subagent implements each task and a reviewer checks it
    - `Main session` — this session implements every task itself
  - **Header `Commits`** — "Commit after each task?"
    - `Commit per task` — each task is committed, and the commits stay
    - `No commits` — changes stay uncommitted for the user's review; the run's per-task
      commits are undone when the run finishes, in either dev mode
  - `Subagent-driven` runs `superpowers:subagent-driven-development`; `Main session` runs the plan
    in this session.
- Never ask the two questions when a preference is already saved.

## Preference changes

When the user asks, in any words, to switch commits or dev mode, ask only the question that
changes, in one `AskUserQuestion` call with the same header, listing the requested option first.
The user's click saves it. The user can also type `/hean-harness:implementation-defaults`.
Switching commits during a no-commits run that is waiting for its undo does not
stop `/hean-harness:finish-implementation` from undoing that run's commits; the changes stay in
the working tree.

## During the run

- **`Commit per task`:** commit each task as the plan says.
- **`No commits`, either dev mode:** commit each task as the plan says, because reviews and
  `/hean-harness:test-changed` read the run's commits. Never push and never run `git reset --hard`; the gate refuses both until the run
  finishes.

## Finish

1. After the last task, after any final whole-branch review, and after any check a project rule
   requires before finishing, run `/hean-harness:finish-implementation`. For a `No commits`
   run it undoes the per-task commits and leaves every change unstaged in the working tree.
2. List every file created, changed or deleted, with one line on why.
3. Stop. The user reviews the changes and asks for a commit when they want one.
   Do not run `superpowers:finishing-a-development-branch` after a `No commits` run.
   The user decides what happens after the review.

## Commits outside a run

- Commit only when the user asked for a commit, in any wording, including an earlier message of
  the same request. The saved preference does not apply outside a run, and no hook blocks the
  commit.
- Reason: `No commits` exists so a plan's per-task commits do not pile up. They are undone at the
  end and the user commits the result.
- Never create a commit another way: no `git commit-tree`, `cherry-pick`, `merge` or `rebase`
  used to record uncommitted work.
