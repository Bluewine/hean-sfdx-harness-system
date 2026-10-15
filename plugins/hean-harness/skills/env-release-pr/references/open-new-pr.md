# New PR creation

**Opening a new PR** — `PR_NUMBER` unset:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
gh pr create \
  --base {BASE} \
  --head {HEAD} \
  --title "{PR_TITLE}" \
  --body-file "$BODY_FILE"
```

Append one `--assignee <login>` per named assignee and one `--reviewer <login>` per named reviewer. With nobody named, run the command as shown: the PR opens unassigned with no reviewers.
