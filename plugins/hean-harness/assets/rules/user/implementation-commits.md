# Implementation Commits

Apply before the first change of any implementation, and before any `git commit`.

## Implementation questions

Before the first change, ask two questions in one `AskUserQuestion` call. Use these headers and
option labels exactly; the commit approval gate reads the answer by them.

- **Header `Dev mode`** — "Which development mode should implementation use?"
  - `Subagent-driven` — a fresh subagent implements each task and a reviewer checks it
  - `Main session` — this session implements every task itself
- **Header `Commits`** — "Commit after each task?"
  - `Commit per task` — each task is committed, and the commits stay
  - `No commits` — changes stay uncommitted for the user's review; a subagent-driven run's per-task
    commits are undone when the run finishes

Rules for the questions:

- Ask them in place of the execution-method question at the end of a plan. The `Dev mode` answer
  is the execution method: `Subagent-driven` runs `superpowers:subagent-driven-development`,
  `Main session` runs the plan in this session.
- Ask them even when the user already stated a preference in text. The gate reads only this
  answer.
- Ask them for implementation without a plan too.

## During the run

- **`Commit per task`:** commit each task as the plan says.
- **`No commits`, `Main session`:** skip every commit step in the plan. The gate refuses commits.
- **`No commits`, `Subagent-driven`:** let each task commit, because its review reads the task's
  commits. Never push and never run `git reset --hard`; the gate refuses both until the run
  finishes.

## Finish

1. After the last task and after any final whole-branch review, run
   `/hean-harness:finish-implementation`. For a `No commits` subagent-driven run it undoes the
   per-task commits and leaves every change unstaged in the working tree.
2. List every file created, changed or deleted, with one line on why.
3. Stop. Do not run `superpowers:finishing-a-development-branch` after a `No commits` run; the
   user decides what happens after the review.

## Commits outside a run

- Commit only in a turn where the user typed `/hean-harness:commit`, or inside
  `/hean-harness:uat-hotfix` or `/hean-harness:version-bump`, whose commits are their job.
- When the gate refuses a commit, list the changes and stop. Tell the user to type
  `/hean-harness:commit` after reviewing them.
- Never create a commit another way: no `git commit-tree`, `cherry-pick`, `merge` or `rebase` used
  to record uncommitted work.
