# New PR title

**When opening a new PR**, discover the title convention from the repository's own release PRs rather than assuming it:

```bash
gh pr list --base {BASE} --state all --limit 20 --json number,title,headRefName
```

Take the prevailing title stem from those results, then resolve `{DEPLOY_DATE}` into it **only once the date is known**. If the date is still open, show the stem with `{DEPLOY_DATE}` left unresolved, request it as its own numbered question, and finalize the title from the answer. Never fill the placeholder with today's date just to have something to display — a date shown at the checkpoint reads as decided, and the user approves it without noticing it was invented.

Two things drive a suffix, and they are independent:

- `HEAD` is a `hotfix-*` branch (`uat` only) → append ` (Fixes)`. The suffix marks the deployment as a fix, not a same-day counter, and appears on hotfix deployments that are the only deployment for their date.
- A PR with the identical title already exists:
  - `uat` → append ` (Fixes)`, then ` (Extra Fixes)` for a third. This is the same-day re-cut case.
  - `prod` → list the suffixes this repository's earlier production titles in the `gh pr list` result used — for example ` (Fixes)`, ` v2`, ` (fix)`, ` (Hotfix)` — and ask which to append, as its own numbered question. Never pick one.

The convention is not perfectly uniform in history — older PRs predate it, and some hotfixes carry no suffix. Treat the rule as the default and take the user's correction.
