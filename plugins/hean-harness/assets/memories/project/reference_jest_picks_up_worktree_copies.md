---
name: reference-jest-picks-up-worktree-copies
description: npx jest with a path filter also runs same-named suites inside .claude/worktrees/*, reporting other branches' failures as if they were this branch's
metadata:
  type: reference
---

`jest.config.js` ignores only `.localdevserver`, so `npx jest <component-path>` treats the filter as a regex and also matches the copies of that component under `.claude/worktrees/<branch>/force-app/...`. Those worktrees are other branches' checkouts, so their failures appear in the same run and inflate the failed-suite count.

**Why:** A CSS-only change on the Experience Cloud site page showed "4 failed, 1 passed" suites; all 4 failures were worktree copies and the real suite passed.

**How to apply:** Read the FAIL lines' paths before attributing any failure to the current branch; only suites under the repo's own `force-app/` count. Related: [[feedback_jest_run_command]].
