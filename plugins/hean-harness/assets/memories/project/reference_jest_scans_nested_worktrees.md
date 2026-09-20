---
name: reference_jest_scans_nested_worktrees
description: "Jest scans the branch checkouts under .claude/worktrees/, so a bare run or a path pattern mixes other branches' specs into the totals"
metadata:
  type: reference
---

Other branch checkouts live under `.claude/worktrees/`, inside the repository, so Jest treats
their spec files as part of this project. A bare run, or a positional path pattern, therefore
reports totals spanning several branches at once — and failures belonging to a branch nobody
is working on.

Run the current branch alone by excluding that directory:
`npx jest --testPathIgnorePatterns '/node_modules/' '/.claude/worktrees/'`

`/node_modules/` must be repeated, because the flag **replaces** Jest's default ignore list
rather than adding to it.

**The trap that wasted a round:** `--testPathIgnorePatterns` accepts multiple values, so a
positional path pattern placed after it is swallowed as one more ignore pattern instead of
narrowing the run. Adding a Experience Cloud site path that way silently excluded those specs and
reported the 9 unrelated suites as the whole result. Put the path pattern before the flag, or
read the totals against the whole-repo run, which is unambiguous.

Numbers that reconcile on this branch: 33 suites and 576 tests repo-wide, of which 24 suites
are the Experience Cloud site and 9 are everything else.

**Why it matters:** a bare run here reported 16 failed suites, none of them on this branch.
Treating that as a regression sends you debugging another branch's code.
