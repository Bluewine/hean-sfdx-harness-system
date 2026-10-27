# Existing PR update

**Updating an existing PR** — `PR_NUMBER` set:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
gh pr edit {PR_NUMBER} \
  --body-file "$BODY_FILE"
```

The `Resolves {ID}` line in the existing body keeps its ID unless the user names another release issue.

Append one `--add-assignee <login>` per named assignee and one `--add-reviewer <login>` per named reviewer. Never pass `--remove-assignee` or `--remove-reviewer`: people already on the PR stay.

**Pass only `--body-file` on edit, plus the named people.** Never pass `--title`, even when it appears unchanged — the title is the deployment's scheduled identity and this skill has no reason to rewrite it. Never pass `--base` or `--head` either; retargeting an open deployment PR is not this skill's job.
