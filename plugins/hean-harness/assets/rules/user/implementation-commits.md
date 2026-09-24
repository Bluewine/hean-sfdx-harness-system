# Implementation Commits

Apply before the first change of any implementation, and before any `git commit`.

## Saved preference

The two implementation answers (`Dev mode`, `Commits`) are saved in one preference file per
machine. The saved preference applies in every repository and skill, including
`/hean-harness:uat-hotfix` and `/hean-harness:version-bump`. Never write the preference file
yourself.

## Before implementation

Run `/hean-harness:start-implementation` before the first change, with or without a plan. It
replaces the execution-method question at the end of a plan.

- When it reports no saved preference, ask the two questions in one `AskUserQuestion` call. Use
  these headers and option labels exactly; the commit approval gate reads the answer by them.
  - **Header `Dev mode`** — "Which development mode should implementation use?"
    - `Subagent-driven` — a fresh subagent implements each task and a reviewer checks it
    - `Main session` — this session implements every task itself
  - **Header `Commits`** — "Commit after each task?"
    - `Commit per task` — each task is committed, and the commits stay
    - `No commits` — changes stay uncommitted for the user's review; a subagent-driven run's
      per-task commits are undone when the run finishes
  - `Subagent-driven` runs `superpowers:subagent-driven-development`; `Main session` runs the plan
    in this session.
- Never ask the two questions when a preference is already saved.

## Changing the preference

When the user asks, in any words, to switch commits or dev mode, ask only the question that
changes, in one `AskUserQuestion` call with the same header, listing the requested option first.
The user's click saves it. The user can also type `/hean-harness:implementation-defaults`.

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
3. Stop. The user reviews the changes and asks for a commit in their own message when they want
   one. Do not run `superpowers:finishing-a-development-branch` after a `No commits` run; the user
   decides what happens after the review.

## Commits outside a run

- Under `Commit per task`, commit completed work.
- Under `No commits`, commit only when the user's own message asks for it. A message that
  contains "commit", "commits", "committed" or "committing" approves a commit until the next
  user message, unless the word is directly negated ("don't commit", "not commit", "never
  commit", "no commit", "without commit") or directly followed by a hyphen, as in
  `/hean-harness:commit-format`. "uncommitted" never counts. A task notification or a message
  from another session never counts.
- When the gate refuses a commit, list the changes and stop.
- Never create a commit another way: no `git commit-tree`, `cherry-pick`, `merge` or `rebase`
  used to record uncommitted work.
