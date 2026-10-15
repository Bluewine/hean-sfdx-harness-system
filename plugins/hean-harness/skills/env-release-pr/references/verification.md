# Verification

Confirm each against real output, not intent:

- The row count derives as `work IDs in range − mentioned-in-passing − not found in the tracker − left out by the user`, and every subtraction was shown at the checkpoint. Check the derivation, not a fixed number — a new reason for leaving a story out must appear as a reported subtraction rather than silently changing the count. Test 2 subtracts nothing: every story it looks at gets a row.
- Every story whose fix already reached `BASE` through a hotfix has a row, and every one of them is named in the closing report.
- Every `Work ID` href is a string that came out of Linear — returned by `get_issue`, or pasted by the user from the browser — and never one you assembled from the title.
- Every sprint link either uses that row's own team key with the workspace slug taken from Linear's `url`, or is a URL the user pasted whole. A link built from parts in the fallback path is a defect: nothing there supplies a verified slug.
- The separator line is exactly `-- | -- | -- | -- |`, and every row has exactly four cells.
- Every Work ID cell and every Sprint cell is a markdown link; no Assignee cell is.
- Rows are sorted on all three keys in order: cycle `startsAt` descending, then team key ascending, then work ID numerically ascending.
- The runlist line is the last line, preceded by a blank line.
- Both reports give the body file as an absolute path ending in `:1`, so it is clickable from the terminal.
- Every numbered question at the checkpoint got its own answer, and none was settled by an answer to a different one, by a general `yes`, or by silence.
- No worktree was removed without an explicit `remove` from the user, and none was removed while a question was still open.
- Where a worktree was removed, the body file was copied into the main working copy first and its new path was reported.
- `gh pr create` returned a URL and the new PR has exactly the assignees and reviewers the requester named (none when none were named), or `gh pr edit` succeeded and re-reading the PR shows the intended body, an unchanged title, the earlier assignees and reviewers, and any named ones added.
- The kind was settled by a Phase 0 rule, never by the current branch, open PRs or the calendar, and the checkpoint stated it with both branches.
