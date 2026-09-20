---
name: linear-start-issue
description: Branch setup for new Linear issues — parses issue ID from a Linear link, fetches latest integration, and creates a work-{ISSUE-ID} branch ready for development
---

You are executing the `/linear-start-issue` skill. Work through the phases below in order.

## Phase 1 — Parse the Linear link

The user has provided a Linear issue link. Extract the issue ID by matching `([A-Z]+-\d+)` from the input. This is `ISSUE_ID` (e.g. `ABC-24`).

Accepted input formats:
- Markdown link: `[ABC-24: Title](https://linear.app/...)`
- Plain URL: `https://linear.app/salesforce-det/issue/ABC-24/...`
- Bare ID: `ABC-24`

If no issue ID can be extracted, stop and tell the user: "Could not parse a Linear issue ID from your input. Please provide a link like `[ABC-24: Title](https://linear.app/...)` or a plain issue ID."

The branch name will be: `work-{ISSUE_ID}` (e.g. `work-ABC-24`).

## Phase 2 — Check for uncommitted changes

Run:
```bash
git status --porcelain
```

If the output is non-empty, list the changed files to the user and ask:
```
You have uncommitted changes:
  <list files from git status --porcelain output>

Would you like to:
  1. Continue — the skill will create and check out work-{ISSUE_ID}, and your changes will travel with you
  2. Stop here so you can commit or stash them first
```

Wait for the user's choice.

- If **1 (continue)**: proceed to Phase 3.
- If **2 (stop)**: tell the user "Commit or stash your changes, then re-run /linear-start-issue." and exit.

## Phase 3 — Check branch does not already exist

Run:
```bash
git branch --list work-{ISSUE_ID}
```

If the output is non-empty, stop and tell the user:
```
Branch work-{ISSUE_ID} already exists locally. Check it out with:
  git checkout work-{ISSUE_ID}
```

## Phase 4 — Create branch via worktree and check it out

Fetch the latest integration state:
```bash
git fetch origin integration
```

Create a temporary worktree rooted at `origin/integration` to build the branch without disturbing the current branch:
```bash
git worktree add /tmp/work-{ISSUE_ID} -b work-{ISSUE_ID} origin/integration
```

Remove the worktree immediately — the branch persists after removal:
```bash
git worktree remove /tmp/work-{ISSUE_ID}
```

Check out the new branch (any uncommitted changes travel with the checkout):
```bash
git checkout work-{ISSUE_ID}
```

## Phase 5 — Report

Tell the user:
```
Branch work-{ISSUE_ID} created from the latest integration and checked out.
You are now on work-{ISSUE_ID} and ready to develop.
```
