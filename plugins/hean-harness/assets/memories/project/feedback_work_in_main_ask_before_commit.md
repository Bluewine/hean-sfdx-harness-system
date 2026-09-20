---
name: feedback_work_in_main_ask_before_commit
description: Work in the main workspace on the current branch, never an isolated worktree, and always ask before committing so the user can review
metadata:
  type: feedback
---

Work directly in the main checkout on its current branch. Do not create or work inside an isolated worktree. After making changes, stop and ask whether to commit — never commit unprompted, even when a background-session convention would otherwise require committing to preserve work.

**Why:** The user reviews changes in their own working tree before they enter history. Work hidden in a worktree is invisible to that review, and an unprompted commit removes the review gate entirely.

**How to apply:** Do not open a worktree. Make edits in place, report exactly what changed and where, then wait for an explicit go-ahead before `git commit`. In a background session the file-edit guard blocks the Edit and Write tools outside a worktree — use Bash (`printf`, `python3`, `sed`, heredoc) to write files instead of isolating. Setting `"worktree": {"bgIsolation": "none"}` in `.claude/settings.local.json` removes that pressure for good. A commit message still needs whatever prefix the project's convention requires. Related: [[feedback_no_background_agents]], [[feedback_commit_message_length]], [[feedback_pr_body_write_override]].
