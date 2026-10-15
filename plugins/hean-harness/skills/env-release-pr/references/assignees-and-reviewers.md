# Assignees and reviewers

Release champions lead UAT and Production releases, and any developer may open the PR. So the skill never chooses people itself: it adds no assignee and no reviewer of its own, and never assigns `@me` because the person running it opened the PR.

It passes only the people the requester names. The requester is the user, or the agent that called the skill.

- **Arguments:** `--assignee <login>` and `--reviewer <login>`, each repeatable; a comma-separated list also works.
- **Words:** the requester's own request naming who to assign or ask for review — "assign it to <login>", "request review from <login>".
- **`@me`:** only when the requester writes `@me` or asks to be assigned.

Never take people from earlier release PRs, CODEOWNERS, commit authors, Linear assignees, or the GitHub account running the session.

Collect them in Phase 1 and show them at the Phase 6 checkpoint as **People**, or `none`.
