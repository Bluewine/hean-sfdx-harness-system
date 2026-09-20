---
name: jest-scans-nested-worktrees
description: bare npx jest <relative-path> matches the same relative path inside every .claude/worktrees/* checkout, inflating fail counts
metadata:
  type: reference
---

`.claude/worktrees/<name>/` holds full nested git worktrees of this repo, each
containing its own copy of `force-app/`. `jest.config.js` has no
`testPathIgnorePatterns` for that directory, so `npx jest
force-app/main/.../Component.test.js` (a relative-path regex) matches the same
test file inside every nested worktree checkout as well as the primary one --
one file appeared to fail across "7 test suites" when only the primary
worktree's copy was actually relevant to the change under review.

**How to apply:** when scoping a Jest run to one component during
verification, pass the full absolute path
(`/Users/.../your-sfdx-repo/force-app/...test.js`) rather than a relative
one. The absolute prefix does not appear inside
`.claude/worktrees/<name>/force-app/...`, so only the primary worktree's copy
matches. Confirm suite/test counts look sane (one suite, not N) before trusting
a pass/fail number from this repo.
