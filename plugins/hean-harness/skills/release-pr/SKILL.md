---
name: release-pr
description: Release-train PR merging the integration branch into a release branch for a UAT deployment — dedupes the commit range into one row per Linear story carrying title, assignee, and sprint, excludes hotfix back-merge tails whose work already shipped, then opens or updates the deployment PR
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

You are executing the `/release-pr` skill. Work through the phases below in order.

This skill has one fixed branch pair: head `integration`, base `release` — the periodic UAT deployment PR. A hotfix re-deploy substitutes that hotfix's `hotfix-{WORK-ID}` branch for `HEAD`; `BASE` never changes. No request wording redirects this pair, including words that name a deployment target or environment:

- A PR from a `work-{WORK-ID}_...` branch into `integration` is a story PR, not a deployment PR. Do not use this skill for it.
- A PR from `release` into `master` is the Production Release PR — this repository's separate prod-track deployment, titled `Production Release {PROJECT}.{date}`. A request naming a date alongside "prod", "master", or "production" is describing that PR, not this one. Do not use this skill for it.

The same phases cover opening a new deployment PR and updating an existing one. Phase 1 decides which mode applies from the request's intent; Phases 6, 7, and 8 each behave differently under it. Every other phase is identical, and the row set is derived the same way in both modes.

## The output contract

The PR body IS exactly these parts, in this order, and nothing else:

1. The literal header line `Work ID | Subject | Assignee | Sprint`
2. The literal separator line `-- | -- | -- | -- |`
3. One row per story, `{work-id-link} | {subject} | {assignee} | {sprint-link}`
4. One blank line
5. The runlist line `[Runlist]({RUNLIST_URL})`

No title heading, no summary paragraph, no "What was done" section, no commit list, no trailing notes. The separator has no leading pipe and does have a trailing pipe — reproduce it byte for byte, with one `--` cell per column.

**Work ID and Sprint are always links, Assignee and Subject never are.** The Work ID cell links to the Linear issue, the Sprint cell to the Linear cycle. A bare work ID or a bare sprint name is a defect, not a style choice.

**Never hand-author presentation.** GitHub stripes alternating row backgrounds itself from its own stylesheet, from plain pipe-delimited markdown containing no HTML. Emitting a `<table>`, a `style` attribute, or a `class` to chase striping or column widths gets the attributes stripped on render and violates the contract above. Pipe-delimited markdown only.

## The architecture rule

**The git range defines the row set. Linear only enriches each row.**

Linear cannot tell you which stories are in the integration branch but not yet in the release branch — only the commit range can. Never build the row set by querying Linear for a cycle's issues, by reading a project board, or by asking which stories "should" ship. Enumerate the range first, then look each work ID up.

**Rows are stories, not commits.** Ten stories can produce a hundred commits. Deduplicating work IDs to one row each *is* the synthesis step — a row never restates a commit subject, and one story never occupies two rows.

**What a row asserts:** *this story's change deploys with this release.* That sentence decides every borderline case, and `BASE` is the test for it — whatever is already on `BASE` has already been deployed. A story whose change already reached `BASE` fails the assertion no matter how many commits it owns in the range; a story whose change is small, non-functional, or infrastructural still satisfies it as long as the change has not reached `BASE` yet.

## Phase 1 — Resolve inputs and verify refs

Collect these. Take any the invoking request already supplied.

- `BASE` — always `release`. There is no other value: never infer, substitute, or resolve it from a branch→environment mapping table or from deployment-target language in the request.
- `HEAD` — `integration`, except for a hotfix re-deploy, where it is that hotfix's `hotfix-{WORK-ID}` branch instead; every later phase is unchanged. Confirm both at the Phase 6 checkpoint regardless — stating them back to the user catches a mismatched request before Phase 2 computes a range from the wrong pair.
- `PR_NUMBER` — the deployment PR being updated. **Mode is set by the request's intent, not by this value.** A request to update an existing deployment PR is update mode even when it names no number; `PR_NUMBER` is merely the number that intent resolves to, discovered from the `gh pr list` call in Phase 6 and confirmed at the checkpoint rather than guessed. Absent any such intent the mode is create, and `PR_NUMBER` stays unset. Decide the mode here, in Phase 1, so Phase 6 never has to infer it — an update run that silently falls through to create mode opens a second PR for a deployment that already has one.
- `RUNLIST_URL` — the deployment runlist spreadsheet link. If the request did not include it, request it at the Phase 6 checkpoint. Do not invent a URL. Do not reuse one from a *different* deployment — but when updating an existing PR, the runlist already in that PR body is the same deployment's runlist and is the correct default.
- `DEPLOY_DATE` — the deployment date as `YYYY.MM.DD`. **Never compute this and never default it to today.** Deployment dates are set by release champions, not by the day the PR happens to be drafted, so the system clock is not a source for it and neither is any inference from recent activity or the previous deployment's cadence. When opening a new PR, request it at the Phase 6 checkpoint. **When updating, take it from the existing PR's title** — that title already carries the champion's date, and recomputing renames the PR away from the deployment it names and orphans the review file the previous run wrote.

**The range is only as correct as the refs it is computed from**, so verify freshness rather than assuming it. Never run the fetch under `--quiet`, which hides the failure:

```bash
git fetch origin
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-remote-refs.mjs" {BASE} {HEAD} || exit 1
```

`verify-remote-refs.mjs` compares each `origin/<branch>` against what the GitHub API reports and exits non-zero on any mismatch, missing ref, or unreadable branch. It never exits 0 on a check it could not perform.

**Do not inline this check or reimplement it with `sed`.** The extraction it performs — pulling `owner/repo` out of the remote URL — was previously written with a lazy quantifier `[^/]+?`, which is not valid POSIX regex: BSD sed rejects it outright while GNU sed may accept it. Because sed writes its error to stderr, the command substitution captured an empty string and the run continued, turning every call into a request against an empty repo path and returning 404. The comparison then printed a JSON error blob where a SHA belonged, so the guard looked broken rather than triggered, and the freshness check was silently dead on one platform for as long as it was there.

A failing `git fetch` is tolerable on its own — SSH auth breaks routinely while `gh` keeps working over HTTPS. **A stale ref is not**: stop and tell the user the range would be wrong. Only continue when the script exits 0.

## Phase 2 — Enumerate the range and classify work IDs

```bash
git log --format='%s' origin/{BASE}..origin/{HEAD}
```

This is every commit in `HEAD` not yet in `BASE`. Extract candidate work IDs from the **full subject line**, then dedupe preserving first appearance:

```bash
CANDIDATES=$(git log --format='%s' origin/{BASE}..origin/{HEAD} \
  | grep -oE '\b[A-Z]{2,}-[0-9]+' \
  | awk '!seen[$0]++')
printf '%s\n' "$CANDIDATES"
```

Assign `CANDIDATES` here so the classification snippets below are self-contained and run in the same shell invocation. `{BASE}` and `{HEAD}` are placeholders you substitute; `$CANDIDATES` is a real shell variable this command creates.

Scanning the whole subject (not just an anchored `@WORK-ID:` prefix) is deliberate — some stories reach the range only through a merge subject that carries the ID in the branch name, e.g. `Merge pull request #NNN from <org>/work-ABC-120_Fix_...`. Anchoring to the prefix drops those rows.

**The regex has no trailing `\b`, and must not gain one.** Branches follow `work-{WORK-ID}_{description}`, and `_` is a word constituent, so there is no word boundary between `120` and `_Fix` — a trailing `\b` makes the pattern fail on exactly the merge subjects it exists to catch. The symptom is a story silently missing from the release PR, and it hides whenever that story also has `@WORK-ID:` commits in range. Leaving the pattern open-ended is safe: `[0-9]+` is greedy, so `ABC-1206` matches in full rather than truncating to `ABC-120`.

This list is `CANDIDATES`, not yet the row set. Its order carries no meaning — Phase 5 sorts rows deterministically from sprint and work ID, so nothing downstream depends on `git log` order.

### Test 1 — owning vs mention-only

A candidate earns a row only if it *owns* at least one commit — appearing as the `@ID:` subject prefix, or as the `work-ID` branch name in a merge subject. A candidate that appears only inside another story's subject is a cross-reference, not shipped work:

```bash
printf '%s\n' "$CANDIDATES" | while IFS= read -r id; do
  [ -z "$id" ] && continue
  own=$(git log --format='%s' origin/{BASE}..origin/{HEAD} \
        | grep -cE "(^@?${id}:|work[-_]${id}([^0-9]|\$))")
  printf '%-14s owning=%s\n' "$id" "$own"
done
```

Iterate with `while read`, not `for id in $CANDIDATES`. Under zsh an unquoted parameter expansion is not word-split, so `for` would run once with the entire newline-joined list as a single `id`, build a nonsense pattern, and report every candidate as owning. The failure is silent and inverts the filter, so mention-only IDs sail through into the table.

`owning=0` → drop it from the row set and report it at the Phase 6 checkpoint with the subjects it appeared in. This is a real case, not a hypothetical: an ID has reached a range solely through subjects like `@ABC-96: Adjust Profile according to XYZ-205`, where `XYZ-205` is delivered in a different repository. Do not relax this test because the ID resolves in Linear — resolving proves the issue exists, not that it shipped here.

Commits carrying no work ID produce no row. Release plumbing such as `Update Release Version`, `Deprecate Runbook from UAT Deployment ...`, and bare `Merge pull request #N from <org>/work-updateVersion` lines is expected here and correctly excluded.

### Test 2 — shipped vs pending

**Test 1 looks at one side only.** The range can prove a story has commits *pending*; it structurally cannot prove a story already *shipped*. A hotfix reaches `BASE` first, on its own branch, and is back-merged into `HEAD` afterwards — so its functional commits are already in `BASE`, and what survives into the range is bookkeeping: a version bump, a swimlane reset, the back-merge commit itself. Those still score `owning ≥ 1`. A row built on them claims a deployment that already happened.

The hotfix path uses branch names the `work-{WORK-ID}_{description}` convention does not cover:

| Branch | Merges into | Meaning |
|---|---|---|
| `hotfix-{WORK-ID}` | `BASE` | the deployed fix |
| `work-{WORK-ID}-HF` | `hotfix-{WORK-ID}` | work on the fix |
| `work-{WORK-ID}-BM` | `HEAD` | the back-merge |

Run the mirror of Test 1 against `BASE` history. Apply it only to the candidates Test 1 kept — an ID already dropped as mention-only must not also be reported here, because the same ID appearing under two exclusion classes at the checkpoint reads as two separate problems:

```bash
printf '%s\n' "$CANDIDATES" | while IFS= read -r id; do
  [ -z "$id" ] && continue
  shipped=$(git log --format='%s' origin/{BASE} \
        | grep -cE "(^@?${id}:|work[-_]${id}([^0-9]|\$))")
  backmerge=$(git log --format='%s' origin/{BASE}..origin/{HEAD} \
        | grep -cE "work[-_]${id}-BM")
  printf '%-14s shipped=%s backmerge=%s\n' "$id" "$shipped" "$backmerge"
done
```

`shipped = 0` → nothing to consider; the story is entirely new to `BASE`.

`shipped ≥ 1` → **default-drop, never auto-drop.** Report it at the Phase 6 checkpoint as its own exclusion class, quoting the `BASE`-side merge subject as evidence, and take the user's override. `backmerge ≥ 1` corroborates but is not required — a back-merge can arrive through a differently-named branch.

**`shipped ≥ 1` has two causes and they need opposite handling.** Do not collapse them:

- **Straddle** — the story's earlier commits reached `BASE` through a previous `HEAD` → `BASE` merge, and more of its work landed on `HEAD` afterwards. The remaining range commits are real work. **Keep the row.** A story legitimately appears in two consecutive release PRs this way; that is not a dedupe failure.
- **Back-merge tail** — the story's commits reached `BASE` through a `hotfix-*` branch that `HEAD` never saw first. The remaining range commits are bookkeeping. **Drop the row.**

The discriminator is provenance, so inspect the `BASE`-side commits: arriving under a `hotfix-*` merge subject means a tail; arriving under a `HEAD` → `BASE` merge means a straddle.

**Do not substitute a diff test for the provenance test.** The tempting shortcut is to drop any story whose range commits touch no deployable metadata. It is wrong, and the counterexample is common: a story whose entire content is a version-file correction has no metadata diff and still belongs in the table, because that correction has never been in `BASE`. Payload size is not the question. Whether the work already reached `BASE` is.

**A prior release PR's body is not evidence.** If a story was wrongly included last time, citing that body as precedent reproduces the error on every subsequent run, and the error compounds because each run finds one more prior body agreeing with it. Re-derive the row set from the range and both tests every time.

## Phase 3 — Resolve each story in Linear

Read `.claude/rules/linear-story-resolution.md` first.

For each surviving candidate, call the Linear MCP `get_issue` tool with the ID. Take these fields:

- `title` → the **Subject** column, used verbatim. Keep the exact punctuation and any bracketed prefix (`[Bug] `, `[Spike + Build] `) exactly as Linear returns it.
- `url` → the **Work ID** link target, used verbatim. It also supplies the workspace slug that Phase 4 needs.
- `assignee` → the **Assignee** column, used verbatim. Linear returns a display name for most users but a raw email for some; render whatever it returns rather than reformatting, so the cell matches what the issue page shows. Never guess an owner from commit authorship, which reflects who pushed, not who owned the story. An unassigned story renders `—` and is listed at the Phase 6 checkpoint alongside the other unresolved fields — a shipped story with no owner is worth the user seeing, not a silent dash.
- `cycleId` and `teamId` → inputs to Phase 4.

**Never construct or slugify an issue URL yourself.** Linear's slug is truncated and transformed in ways that are not reproducible from the title — a long bracketed title resolves to a slug cut mid-phrase. A hand-built slug produces a broken link that still looks plausible. Copy `url` verbatim.

A surviving candidate from another team is a legitimate row — Phase 4 resolves its sprint against its own team. Team prefix decides nothing; the two Phase 2 tests already did.

**When an ID does not resolve**, never silently drop it and never guess a substitute. Common causes are a typo'd prefix in a commit subject, or an ID belonging to a non-Linear tracker. Collect every unresolved ID with the subject it came from and carry it to the Phase 6 checkpoint. If the user maps one to a corrected ID that is already a row, the two are one story and stay one row.

## Phase 4 — Resolve the sprint for each story

`get_issue` returns `cycleId` as a UUID, which is not directly renderable. Map it with the Linear MCP `list_cycles` tool, called once per distinct `teamId` in the row set, and match on `id`:

- `title` → the **Sprint** column text, verbatim.
- `number` → the sprint link target: `https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{number}`, where `TEAM_KEY` is the letter prefix of that story's work ID (`ABC-126` → `ABC`).
- `startsAt` → the sort key for Phase 5.

**Take `{WORKSPACE}` from the `url` Phase 3 returned**, which has the form `https://linear.app/{WORKSPACE}/issue/...`. Do not hardcode a workspace slug and do not carry one over from another repository — a wrong slug yields a link that resolves to someone else's workspace or to nothing.

**Cycle numbers and titles are per-team and are not comparable across teams.** Each team numbers its own cycles from 1 and names them on its own scheme, so two teams' cycle 6 can be different date ranges with unrelated titles. Always call `list_cycles` for the story's own `teamId`, and never reuse one team's cycle list to resolve another team's `cycleId`.

Cycles are not guaranteed to have a `title` — future and unstarted cycles routinely return none. If a story's cycle has no title, or the story has no `cycleId` at all, raise it at the Phase 6 checkpoint rather than emitting a blank or invented cell.

Cycle assignment is read live and issues do get re-assigned between cycles, so a row's sprint reflects Linear at generation time, not at merge time.

## Phase 5 — Order the rows

The sort is total and deterministic — the same range and the same Linear state always produce the same row order.

1. **Sprint block, descending by cycle `startsAt`.** Sort on `startsAt`, never on `number` — numbers restart per team, so ordering by number interleaves two teams' sprints into the wrong blocks. Cycles from different teams sharing a `startsAt` form separate blocks, ordered by team key ascending.
2. **Within a block, work ID ascending** — team key ascending first, then the numeric part compared **as a number, not as text**. `ABC-96` sorts before `ABC-146`; a string sort would wrongly place `ABC-101` first.

Nothing here depends on commit order, so the ordering is reproducible from the finished table alone.

## Phase 6 — One consolidated checkpoint

Everything the user must see or decide goes in **one message**. Do not ask in stages — a run that interrupts three separate times to confirm a branch, then an exclusion, then a URL, wastes the user's turn budget and buries the decisions.

Work `PR_TITLE` out as far as the known inputs allow, so the checkpoint can show it. It is not always finishable at this point, and that is expected.

**When `PR_NUMBER` is set, `PR_TITLE` is that PR's current title, unchanged.** Do not recompute it. That title already carries the release champion's deployment date, and rewriting it separates the PR from the deployment it names.

**When opening a new PR**, discover the title convention from the repository's own release PRs rather than assuming it:

```bash
gh pr list --base {BASE} --state all --limit 20 --json number,title,headRefName
```

Take the prevailing title stem from those results, then resolve `{DEPLOY_DATE}` into it **only once the date is known**. If the date is still open, show the stem with `{DEPLOY_DATE}` left unresolved, request it as item 7, and finalize the title from the answer. Never fill the placeholder with today's date just to have something to display — a date shown at the checkpoint reads as decided, and the user approves it without noticing it was invented.

Two things drive a suffix, and they are independent:

- `HEAD` is a `hotfix-*` branch → append ` (Fixes)`. The suffix marks the deployment as a fix, not a same-day counter, and appears on hotfix deployments that are the only deployment for their date.
- `HEAD` is the integration branch and a PR with the identical title already exists → append ` (Fixes)`, then ` (Extra Fixes)` for a third. This is the same-day re-cut case.

The convention is not perfectly uniform in history — older PRs predate it, and some hotfixes carry no suffix. Treat the rule as the default and take the user's correction.

The checkpoint message carries, in this order:

1. The range and its candidate count.
2. Every mention-only exclusion (`owning=0`), each with the subject(s) it appeared in.
3. Every shipped exclusion (`shipped ≥ 1` judged a back-merge tail), each with the `BASE`-side merge subject that proves it already deployed.
4. Every unresolved ID, each with the subject it came from, plus every story with an unresolved field — no sprint title, or no assignee.
5. The proposed row set in final order, showing Work ID, Subject, Assignee, and Sprint. When updating, present this as a diff against the existing PR body — rows added, rows removed, rows whose position changed — not as a fresh table. The user has already approved the rows that are staying.
6. The `PR_TITLE`, and whether it was preserved from the existing PR or computed.
7. Requests for exactly the open inputs — `DEPLOY_DATE` whenever a new PR is being opened and the request did not carry it, `RUNLIST_URL` if not already supplied, `PR_NUMBER` if update mode was inferred rather than given, and confirmation of `BASE`/`HEAD`.

If no item in 2, 3, 4, or 7 has content — no exclusions, nothing unresolved, every input already given — there is nothing to decide: skip straight to Phase 7 and let the draft's own `yes` gate serve as the single approval.

Wait for the answer. Nothing has touched GitHub at this point and nothing may until Phase 8.

## Phase 7 — Render and write the review file

Build each row as:

```
[{WORK-ID}]({ISSUE_URL}) | {TITLE} | {ASSIGNEE} | [{CYCLE_TITLE}](https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{NUMBER})
```

A `|` inside a Linear title or assignee name would break the row; escape it as `\|`. Nothing else in either is escaped.

Write the body with a shell heredoc, never the Write tool:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$REPO_ROOT/.claude/skills/release-pr/output"
cat > "$REPO_ROOT/.claude/skills/release-pr/output/release-{DEPLOY_DATE}.md" << 'BODY'
Work ID | Subject | Assignee | Sprint
-- | -- | -- | -- |
{ROWS}

[Runlist]({RUNLIST_URL})
BODY
```

Quote the heredoc delimiter. Linear titles routinely contain backticks and `$`; an unquoted delimiter runs them as command substitution and silently empties the cell.

Updating writes to the same `release-{DEPLOY_DATE}.md` path the previous run used, overwriting it. That is intended — the file is the review artifact for one deployment, and `DEPLOY_DATE` came from the existing PR title precisely so the path stays stable.

Then tell the user:

```
PR body written to .claude/skills/release-pr/output/release-{DEPLOY_DATE}.md
{N} stories, ordered by sprint descending then work ID ascending.
Title: {PR_TITLE}
Review or edit the file, then type `yes` to submit.
```

Wait for an explicit `yes` before Phase 8.

Anything other than `yes` is a revision request, not an approval: apply the change, rewrite the file with the same heredoc, report it again, and wait again. Loop until the user approves. Never read approval into silence, a question, or a comment that merely sounds positive. Confirming an input — a branch, a title, a date, a runlist — is answering a question, not approving the publish.

The user may also edit `.claude/skills/release-pr/output/release-{DEPLOY_DATE}.md` by hand during review. Phase 8 submits that file with `--body-file`, so hand edits are what get published — after a `yes`, re-read the file and submit it as it stands rather than re-rendering it from the Linear data.

## Phase 8 — Open or update the PR

Confirm `gh` is authenticated:

```bash
gh auth status
```

If it is not, stop and tell the user to run `gh auth login`.

Use the `PR_TITLE` the user approved. Do not recompute it here.

**Opening a new PR** — `PR_NUMBER` unset:

```bash
gh pr create \
  --base {BASE} \
  --head {HEAD} \
  --title "{PR_TITLE}" \
  --body-file "$REPO_ROOT/.claude/skills/release-pr/output/release-{DEPLOY_DATE}.md" \
  --assignee @me
```

**Updating an existing PR** — `PR_NUMBER` set:

```bash
gh pr edit {PR_NUMBER} \
  --body-file "$REPO_ROOT/.claude/skills/release-pr/output/release-{DEPLOY_DATE}.md"
```

**Pass only `--body-file` on edit.** Never pass `--title`, even when it appears unchanged — the title is the deployment's scheduled identity and this skill has no reason to rewrite it. Never pass `--base` or `--head` on edit either; retargeting an open deployment PR is not this skill's job.

Report the PR URL. Do not merge the PR — this skill prepares the deployment PR and stops there.

## Verification

Confirm each against real output, not intent:

- The row count derives as `candidates − mention-only − shipped-tails − unresolved-or-folded − user-skipped`, and every subtraction was reported at the checkpoint. Check the derivation, not a fixed equality — a new exclusion class must show up as a reported subtraction rather than silently breaking the count.
- Every `Work ID` href is a string Linear returned, not one you assembled.
- Every sprint link uses that row's own team key and the workspace slug taken from Linear's `url`.
- The separator line is exactly `-- | -- | -- | -- |`, and every row has exactly four cells.
- Every Work ID cell and every Sprint cell is a markdown link; no Assignee cell is.
- Rows are sorted on all three keys in order: cycle `startsAt` descending, then team key ascending, then work ID numerically ascending.
- The runlist line is the last line, preceded by a blank line.
- `gh pr create` returned a URL, or `gh pr edit` succeeded and re-reading the PR shows the intended body and an unchanged title.

## Common mistakes

| Mistake | Correction |
|---|---|
| Rows built from commit subjects | Rows are stories; dedupe work IDs and use the Linear title |
| One story split across several rows | Dedupe on work ID — many commits, one row |
| Row set pulled from a Linear cycle or board | Only `git log {BASE}..{HEAD}` defines the row set |
| Mention-only ID given a row because it resolves in Linear | Resolving proves the issue exists, not that it shipped here; require `owning` ≥ 1 |
| Hotfix back-merge tail given a row | Its work is already in `BASE`; run the `shipped` test and drop the tail |
| Straddling story dropped as a back-merge tail | Provenance decides: reached `BASE` via a `HEAD` → `BASE` merge means keep |
| Rows filtered by whether the diff touches deployable metadata | Wrong discriminator — a version-only fix still ships; ask whether it reached `BASE` |
| A prior release PR's body cited as precedent | Prior bodies reproduce prior errors; re-derive from the range every run |
| Stale refs after a failed fetch | Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-remote-refs.mjs" {BASE} {HEAD}`; a non-zero exit stops the run |
| Reimplementing the freshness check inline | It lives in one shared script so it cannot drift; a `sed`-based rewrite already broke it silently on one platform |
| Issue URL slugified from the title | Copy `url` from `get_issue` verbatim |
| Workspace slug hardcoded in the sprint link | Take it from the `url` Linear returned |
| Sprint cell filled with the `cycleId` UUID | Map via `list_cycles`; use `title` and `number` |
| Sprint blocks ordered by cycle `number` | Numbers restart per team; order blocks by `startsAt` |
| Work IDs sorted as text within a sprint | Compare the numeric part as a number — `-96` precedes `-146` |
| Assignee inferred from commit author | Use Linear's `assignee`; commit author is who pushed, not who owned |
| Unresolvable work ID quietly dropped | Surface it at the checkpoint; never guess a substitute |
| Decisions asked in three separate messages | One consolidated checkpoint carries every open item |
| Deployment/environment wording ("prod", "master", "production") read as an instruction to change `BASE` | `BASE`/`HEAD` are fixed to `release`/`integration`; that wording names the separate Production Release PR (`release` → `master`), not this one — confirm scope, don't substitute a branch |
| Runlist URL reused from a prior PR | It is per-deployment; ask for it. The same PR's own runlist is not a prior PR's |
| `DEPLOY_DATE` defaulted to today | Release champions set deployment dates; ask for it, never read the clock |
| Placeholder date shown at the checkpoint to fill the title | An invented date reads as decided and gets approved unnoticed; leave it unresolved |
| Title recomputed when updating | Take it from the existing PR; it already carries the champion's date |
| `--title` passed to `gh pr edit` | Body only; the title is the deployment's identity |
| Update presented as a fresh table | Show it as a diff — rows added, removed, moved |
| Extra headings or a summary added to the body | The body is the table plus the runlist line, nothing else |
| PR opened without the review gate | Write the file, wait for an explicit `yes`, then submit |
| An answered input mistaken for approval | Confirming a branch or title is not `yes` |
| User's hand edits re-rendered away | After `yes`, submit the file as it stands |
