---
name: env-release-pr
description: Release-train deployment PR for either environment — UAT (integration into release) or Production (release into master) — dedupes the commit range into one row per Linear story with title, assignee and sprint, names hotfix-deployed stories out loud, then opens or updates the PR
when_to_use: Any request to open, create, raise, draft, refresh or update a deployment PR between the long-lived branches — "UAT deployment PR", "UAT Deployment {PROJECT}.{date}", "Production Release PR", "prod release", "open the release PR into master", "merge release into master", "deploy integration to UAT", "update the release PR body" — and any agent that needs one, passing uat or prod only when the request names the environment ("open the release PR" names none, so pass no argument). Not for story PRs from work-* or hotfix-* into integration, which create-pr opens, nor a PR uat-hotfix opens or edits as one of its own steps.
argument-hint: "[uat|prod] [PR number] [--assignee <login>] [--reviewer <login>]"
arguments: [kind, pr]
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

You are executing the `/hean-harness:env-release-pr` skill. Work through the phases below in order.

This skill opens or updates the deployment PR between two long-lived branches, for one of two kinds:

| Kind | `HEAD` | `BASE` | PR |
|---|---|---|---|
| `uat` | `integration` (a hotfix re-deploy substitutes `hotfix-{WORK-ID}`) | `release` | the periodic UAT deployment PR |
| `prod` | `release` | `master` | the Production Release PR |

Phase 0 settles the kind before any range is computed. Once it is settled, the branch pair is fixed: no request wording redirects it, including words that name a deployment target or environment.

A PR from a `work-{WORK-ID}` or `hotfix-{WORK-ID}` branch into `integration` is a story PR, not a deployment PR. Do not use this skill for it. A PR `uat-hotfix` opens or edits as one of its own steps is not this skill's either. A UAT hotfix re-deploy requested outside `uat-hotfix` (`hotfix-{WORK-ID}` → `release`) is.

The same phases cover opening a new deployment PR and updating an existing one. Phase 1 decides which mode applies from the request's intent; Phases 6, 7, and 8 each behave differently under it. Every other phase is identical for both kinds and both modes, and the row set is derived the same way in all of them.

Phase 9 is separate from all of that. It offers to remove the worktree the run happened in, and it is reached only when the user has nothing further to raise.

## The output contract

The PR body IS exactly these parts, in this order, and nothing else:

1. The literal header line `Work ID | Subject | Assignee | Sprint`
2. The literal separator line `-- | -- | -- | -- |`
3. One row per story, `{work-id-link} | {subject} | {assignee} | {sprint-link}`
4. One blank line
5. The runlist line `[Runlist]({RUNLIST_URL})`

No title heading, no summary paragraph, no "What was done" section, no commit list, no trailing notes. The separator has no leading pipe and does have a trailing pipe — reproduce it byte for byte, with one `--` cell per column.

**The table has no column for how a story reached `BASE`.** Every row looks alike, by design — four
columns and nothing else. Whether a story was already deployed by a hotfix is stated in the closing report instead, never as a marker
in a cell, a footnote under the table, or a fifth column. Changing the table's shape breaks the
contract this section defines.

**Work ID and Sprint are always links, Assignee and Subject never are.** The Work ID cell links to the Linear issue, the Sprint cell to the Linear cycle. A bare work ID or a bare sprint name is a defect, not a style choice.

**Never hand-author presentation.** GitHub stripes alternating row backgrounds itself from its own stylesheet, from plain pipe-delimited markdown containing no HTML. Emitting a `<table>`, a `style` attribute, or a `class` to chase striping or column widths gets the attributes stripped on render and violates the contract above. Pipe-delimited markdown only.

## The architecture rule

**The git range defines the row set. Linear only enriches each row.**

Linear cannot tell you which stories are in `HEAD` but not yet in `BASE` — only the commit range can. Never build the row set by querying Linear for a cycle's issues, by reading a project board, or by asking which stories "should" ship. Enumerate the range first, then look each work ID up.

**Rows are stories, not commits.** Ten stories can produce a hundred commits. Deduplicating work IDs to one row each *is* the synthesis step — a row never restates a commit subject, and one story never occupies two rows.

**What a row asserts:** *this story's change deploys with this release.* That sentence decides every borderline case, and `BASE` is the test for it — whatever is already on `BASE` has already been deployed. A story whose change already reached `BASE` fails the assertion no matter how many commits it owns in the range; a story whose change is small, non-functional, or infrastructural still satisfies it as long as the change has not reached `BASE` yet.

## Phase 0 — Settle the kind

Settle the kind before Phase 1. The only GitHub call here is rule 2's read of a named PR's base. The first rule that decides sets the kind, but rule 2 still runs whenever a PR is named — even after rule 1 decided — so the check under "When two sources disagree" can compare the two:

1. **Argument.** `$kind` is `uat`, `prod` or `production` (`production` means `prod`). Any other value decides nothing. An all-digit `$kind` is a PR number for rule 2, as in `/hean-harness:env-release-pr 684`.
2. **An existing PR.** The request names a PR by number (`$pr` when it is all digits, or a number in its words) or by title. Read its base branch:

   ```bash
   gh pr view {PR} --json baseRefName,title --jq '.baseRefName + " " + .title'
   ```

   A PR named only by title: find its number first with `gh pr list --state all --search "{TITLE} in:title" --json number,title,baseRefName`, take the exact title match, and stop and ask when there is none or more than one.

   `release` → `uat`. `master` → `prod`. Any other base: stop and tell the user this PR is not a deployment PR, naming its base. This PR is also `PR_NUMBER` for Phase 1, so the run is in update mode.
3. **Words in the request.** "UAT" → `uat`. "prod", "production" or "master" → `prod`. Words for both kinds, or for neither, decide nothing. "release" alone decides nothing, so "open the release PR" decides nothing: it appears in "Production Release" and is also the UAT base branch.
4. **Ask.** When no rule decided:
   - **Inside a subagent** — `AskUserQuestion` is neither in your tool list nor listed as a deferred tool name you can load with `ToolSearch`; Claude Code removes it from every subagent. Stop before any git or GitHub call. Your whole reply is this one line and nothing else — no question, no options, no explanation:

     `needs input: kind — uat (integration → release) or prod (release → master)`

     The caller asks the user, or calls again with `uat` or `prod`.
   - **Otherwise** — `AskUserQuestion` is in your tool list, or listed as a deferred tool name (load it with `ToolSearch` first). Ask one question with it: "UAT (`integration` → `release`) or Production (`release` → `master`)?"

**When two sources disagree, stop.** A `$kind` or request words that name one kind and a named PR whose base belongs to the other: never pick one. Ask which is meant the way rule 4 asks — with `AskUserQuestion`, or, inside a subagent, by making your whole reply `needs input: kind — {first source} says {its kind}, PR #{number} targets {its base}`.

**Never decide the kind from** the current branch, which PRs happen to be open, the calendar or the release cadence, or an earlier PR's body. Each can point either way, and a wrong guess opens a PR into the wrong environment.

Set `{KIND_FILE}` from the kind: `uat` → `uat`, `prod` → `production`. It names the review file in Phases 7 to 9.

Phase 6 states the kind and both branches every run, including when the request decided it.

## Phase 1 — Resolve inputs and verify refs

Collect these. Take any the invoking request already supplied.

- `BASE` — `release` for `uat`, `master` for `prod`, from the kind Phase 0 settled. There is no other value: never infer, substitute, or resolve it from a branch→environment mapping table or from deployment-target language in the request.
- `HEAD` — for `uat`, `integration`, except for a hotfix re-deploy, where it is that hotfix's `hotfix-{WORK-ID}` branch instead; for `prod`, always `release`, because a production hotfix also reaches `master` through `release`. Every later phase is unchanged. Confirm the kind and both branches at the Phase 6 checkpoint regardless — stating them back to the user catches a mismatched request before Phase 2 computes a range from the wrong pair.
- `PR_NUMBER` — the deployment PR being updated. **Mode is set by the request's intent, not by this value.** A request to update an existing deployment PR is update mode even when it names no number; `PR_NUMBER` is merely the number that intent resolves to, discovered from the `gh pr list` call in Phase 6 and confirmed at the checkpoint rather than guessed. Absent any such intent the mode is create, and `PR_NUMBER` stays unset. Decide the mode here, in Phase 1, so Phase 6 never has to infer it — an update run that silently falls through to create mode opens a second PR for a deployment that already has one. When Phase 0 already read a PR, that PR is `PR_NUMBER`.
- `ASSIGNEES` and `REVIEWERS` — only the people the requester named. When the requester names anyone to assign or to review, by argument or in words, read `${CLAUDE_SKILL_DIR}/references/assignees-and-reviewers.md` and collect them by it. Usually empty. `$pr` counts as a PR number only when it is all digits, so `prod --assignee <login>` never reads `--assignee` as a PR.
- `RUNLIST_URL` — the deployment runlist spreadsheet link. If the request did not include it, request it at the Phase 6 checkpoint. Do not invent a URL. Do not reuse one from a *different* deployment — but when updating an existing PR, the runlist already in that PR body is the same deployment's runlist and is the correct default.
- `DEPLOY_DATE` — the deployment date as `YYYY.MM.DD`. **Never compute this and never default it to today.** Deployment dates are set by release champions, not by the day the PR happens to be drafted, so the system clock is not a source for it and neither is any inference from recent activity or the previous deployment's cadence. When opening a new PR, request it at the Phase 6 checkpoint. **When updating, take it from the existing PR's title** — that title already carries the champion's date, and recomputing renames the PR away from the deployment it names and orphans the review file the previous run wrote.

**The range is only as correct as the refs it is computed from**, so verify freshness rather than assuming it. Never run the fetch under `--quiet`, which hides the failure:

```bash
git fetch origin
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-remote-refs.mjs" {BASE} {HEAD} || exit 1
```

Run `git fetch origin` and the script as two separate commands. Never join them with `&&`: a failed fetch would then skip the check, and nothing after it may run until the script exits 0.

When `verify-remote-refs.mjs` exits non-zero, or before changing a Phase 1 command, read `${CLAUDE_SKILL_DIR}/references/command-rationale.md`.

A failing `git fetch` is tolerable on its own — SSH auth breaks routinely while `gh` keeps working over HTTPS. **A stale ref is not**: stop and tell the user the range would be wrong. Only continue when the script exits 0.

## Phase 2 — List the work IDs in the range and sort them out

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

Assign `CANDIDATES` here so the two tests below are self-contained and run in the same shell invocation. `{BASE}` and `{HEAD}` are placeholders you substitute; `$CANDIDATES` is a real shell variable this command creates.

Before changing the work-ID regex or a Phase 2 loop, read `${CLAUDE_SKILL_DIR}/references/command-rationale.md`.

This list is `CANDIDATES`, not yet the row set. Its order carries no meaning — Phase 5 sorts rows deterministically from sprint and work ID, so nothing downstream depends on `git log` order.

### Test 1 — does the story have commits of its own here?

A candidate earns a row only if it *owns* at least one commit — appearing as the `@ID:` subject prefix, or as the `work-ID` branch name in a merge subject. A candidate that appears only inside another story's subject is a cross-reference, not shipped work:

```bash
printf '%s\n' "$CANDIDATES" | while IFS= read -r id; do
  [ -z "$id" ] && continue
  own=$(git log --format='%s' origin/{BASE}..origin/{HEAD} \
        | grep -cE "(^@?${id}:|work[-_]${id}([^0-9]|\$))")
  printf '%-14s owning=%s\n' "$id" "$own"
done
```

`owning=0` → drop it from the row set and report it at the Phase 6 checkpoint with the subjects it appeared in. This is a real case, not a hypothetical: an ID has reached a range solely through subjects like `@ABC-96: Adjust Profile according to XYZ-205`, where `XYZ-205` is delivered in a different repository. Do not relax this test because the ID resolves in Linear — resolving proves the issue exists, not that it shipped here.

Commits carrying no work ID produce no row. Release plumbing such as `Update Release Version`, `Deprecate Runbook from UAT Deployment ...`, and bare `Merge pull request #N from <org>/work-updateVersion` lines is expected here and correctly excluded.

### Test 2 — how each story reached `BASE`

**Every story Test 1 kept gets a row. This test never removes one.** It works out how each story's
work reached `BASE`, because one of the three answers has to be said out loud in the closing report.
Nothing here filters anything.

Run the mirror of Test 1 against `BASE` history, over the candidates Test 1 kept:

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

Every story is one of three kinds. All three get a row.

| Is any of it in `BASE` already? | How it got there | What that means | Say so at the end |
|---|---|---|---|
| no | — | none of this story has been deployed yet | no |
| yes | through an earlier `HEAD` → `BASE` merge | part of it went out last time, the rest goes out now | no |
| yes | through a `hotfix-*` branch | the fix is already live; this range only carries the commit that copies it back to `integration` | **yes, name the story** |

When any story shows `shipped` ≥ 1, read `${CLAUDE_SKILL_DIR}/references/hotfix-stories.md` to tell the last two kinds apart.

**Do not decide this by looking at the diff.** The tempting shortcut is to judge by whether the range
commits touch deployable metadata. A story whose whole content is a version-file correction has no
metadata diff and has still never been deployed. The size of the change answers nothing here.

**What to say about an already-live fix.** It reached `BASE` earlier — on its own branch for `uat`, through an earlier production release for `prod` — and is deployed there
now; this PR is not what delivers it. What this range carries is the commit that copies it back to
`integration`. It gets a row because the story is part of what this deployment contains, and the closing report
names it so nobody reads the table as a claim that the fix goes out today.

**A prior release PR's body is not evidence.** Citing one as precedent reproduces whatever it got
wrong, and compounds it, because each run then finds one more prior body agreeing. Re-derive the row
set and these answers from the range every time.

## Phase 3 — Resolve each story in Linear

Read `.claude/rules/linear-story-resolution.md` first.

**Check Linear MCP availability:** attempt a Linear MCP tool call (search or fetch issue by ID). If it responds successfully, resolve every candidate through it. If unavailable or an auth error, use the manual fallback at the end of this phase, and Phase 4's fallback with it.

When Linear MCP responds, read `${CLAUDE_SKILL_DIR}/references/linear-mcp.md` and take each surviving candidate's fields by it.

A surviving candidate from another team is a legitimate row — Phase 4 resolves its sprint against its own team. Team prefix decides nothing; the two Phase 2 tests already did.

**When an ID does not resolve**, never silently drop it and never guess a substitute. Common causes are a typo'd prefix in a commit subject, or an ID belonging to a non-Linear tracker. Collect every unresolved ID with the subject it came from and carry it to the Phase 6 checkpoint. If the user maps one to a corrected ID that is already a row, the two are one story and stay one row.

**Say what this costs before starting.** Six values per story, one story at a time, and a release range routinely carries ten. Tell the user the count up front and that connecting Linear removes the questions entirely — `/hean-harness:doctor` reports whether a server is declared, and `/mcp` in a session signs in to one. A user who knows both facts can choose; one who is asked sixty questions without being told cannot.

When Linear MCP is unavailable, say that cost first, then read `${CLAUDE_SKILL_DIR}/references/linear-fallback.md` and ask for each work ID by it.

**Every unresolved or "none" answer goes to the Phase 6 checkpoint**, exactly as an unresolved field from Linear does. The fallback changes where a value comes from. It does not lower the bar for a blank or an invented cell.

## Phase 4 — Resolve the sprint for each story

**Skip this phase for any story resolved through the Phase 3 fallback** — items 4 to 6 of that prompt already carry its sprint name, link and start date. Run it for the stories that came from `get_issue`, which is all of them whenever Linear is connected.

For the stories that came from `get_issue`, read `${CLAUDE_SKILL_DIR}/references/linear-sprints.md` and map each `cycleId` by it.

Cycles are not guaranteed to have a `title` — future and unstarted cycles routinely return none. If a story's cycle has no title, or the story has no `cycleId` at all, raise it at the Phase 6 checkpoint rather than emitting a blank or invented cell.

## Phase 5 — Order the rows

The sort is total and deterministic — the same range and the same Linear state always produce the same row order.

1. **Sprint block, descending by cycle `startsAt`.** Sort on `startsAt`, never on `number` — numbers restart per team, so ordering by number interleaves two teams' sprints into the wrong blocks. Cycles from different teams sharing a `startsAt` form separate blocks, ordered by team key ascending.

   A story with no start date — no cycle, or `"none"` given at the Phase 3 fallback — cannot join a block, because there is nothing to compare. Those stories form one block of their own, placed last, ordered by work ID under rule 2. Never guess a date to slot one into a real block: the row then sits under a sprint heading that Linear does not agree with, and nothing in the finished table shows it was placed rather than read.
2. **Within a block, work ID ascending** — team key ascending first, then the numeric part compared **as a number, not as text**. `ABC-96` sorts before `ABC-146`; a string sort would wrongly place `ABC-101` first.

Nothing here depends on commit order, so the ordering is reproducible from the finished table alone.

## Phase 6 — One consolidated checkpoint

Everything the user must see or decide goes in **one message**. Do not ask in stages — a run that interrupts three separate times to confirm a branch, then an exclusion, then a URL, wastes the user's turn budget and buries the decisions.

One message does not mean one answer. Each thing that needs deciding is asked as its own numbered item and needs its own answer back.

Work `PR_TITLE` out as far as the known inputs allow, so the checkpoint can show it. It is not always finishable at this point, and that is expected.

**When `PR_NUMBER` is set, `PR_TITLE` is that PR's current title, unchanged.** Do not recompute it. That title already carries the release champion's deployment date, and rewriting it separates the PR from the deployment it names.

**When opening a new PR**, read `${CLAUDE_SKILL_DIR}/references/new-pr-title.md` before writing the checkpoint, and work the title out by it.

The checkpoint message carries context first, then decisions.

**What you found — shown, not asked.** Label these rather than numbering them, so the numbers belong to
the questions alone:

- **Range** — the kind (`uat` or `prod`), the two branches, and how many work IDs are in the range.
- **People** — the assignees and reviewers the requester named, or `none`.
- **Table** — the proposed rows in final order: Work ID, Subject, Assignee, Sprint. When updating, show
  this as a difference against the existing PR body — rows added, rows removed, rows that moved — not as
  a fresh table. The user already approved the rows that are staying.
- **Title** — the `PR_TITLE`, and whether it was kept from the existing PR or worked out.

**What you need answered — numbered 1, 2, 3, each needing its own answer.**

Every unsettled thing gets its own numbered line, saying what it is, what the evidence is, and which
answers it accepts. One thing, one number, one answer. Never put two on one line, and never write one as
a passing remark.

| What is unsettled | Show the user | Ask it like this |
|---|---|---|
| A work ID that appears only inside some other story's commit message | that commit subject | "I would leave `{ID}` out. Answer: `leave out`, or `include`" |
| A story whose fix already reached `BASE` through a hotfix | the `hotfix-*` merge subject | "`{ID}` already went live through `{BRANCH}`, so this PR only carries the commit copying it back. It stays in the table either way. Answer: `right`, or `no, some of its work is still going out now`" |
| A work ID that is not in the issue tracker | the commit subject it came from | "I cannot find `{ID}`. Answer: the correct ID, or `leave out`" |
| A story missing its sprint or its assignee | which one is missing | "`{ID}` has no {field}. Answer: the value, or `leave blank`" |
| Something the run needs and was not given — the deployment date, the runlist link, which PR to update, or confirmation of the two branches | what is missing and why it is needed | ask for it directly |

**Write the question out in plain words every time.** No internal shorthand in anything the user reads:
no counters like `owning=0`, no labels this file uses internally, no phase numbers. The person answering
has the commit subject in front of them and nothing else; a word they have to work out is a word that
gets the wrong answer.

**Every numbered question needs its own answer before the body is written.** This is what the checkpoint
is for, and there is one specific way it fails: a story you would leave out is shown as a note, the user
answers the deployment date, and a finished exchange gets read as a settled checkpoint. Nobody ever
decided about the story. It stays out on a default nobody chose, and the finished table gives no sign of
it.

**A reply that answers some of them is a partial answer, not approval.** Say which numbers came back,
list exactly which are still open, and ask again for only those. Do not re-ask the ones already answered
— that reads as not having listened — and do not add anything new to the re-ask.

**Never work out an answer for the user.** Not from silence, not from what they said about a different
question, not from a general `yes` or `looks good`, and not from their tone. A `yes` here approves
nothing on its own: the go-ahead to publish comes later, after the body is written, and it is a separate
answer.

**When there is nothing to ask** — nothing being left out, nothing missing, nothing still needed — skip
the checkpoint, write the body, and let the `yes` on the draft be the one approval.

Nothing has touched GitHub at this point and nothing may until Phase 8.

## Phase 7 — Render and write the review file

Build each row as:

```
[{WORK-ID}]({ISSUE_URL}) | {TITLE} | {ASSIGNEE} | [{CYCLE_TITLE}](https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{NUMBER})
```

A `|` inside a Linear title or assignee name would break the row; escape it as `\|`. Nothing else in either is escaped.

Write the body with a shell heredoc, never the Write tool:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
mkdir -p "$(dirname "$BODY_FILE")"
cat > "$BODY_FILE" << 'BODY'
Work ID | Subject | Assignee | Sprint
-- | -- | -- | -- |
{ROWS}

[Runlist]({RUNLIST_URL})
BODY
echo "$BODY_FILE:1"
```

Quote the heredoc delimiter. Linear titles routinely contain backticks and `$`; an unquoted delimiter runs them as command substitution and silently empties the cell.

Updating writes to the same `{KIND_FILE}-{DEPLOY_DATE}.md` path the previous run used, overwriting it. That is intended — the file is the review artifact for one deployment, and `DEPLOY_DATE` came from the existing PR title precisely so the path stays stable.

**Verify the rendered body before telling the user.** Read the file back and confirm no Claude attribution reached it:

```bash
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
grep -nEi 'co-authored-by|generated with \[?claude|claude-session|claude\.(ai|com)/(code/session|claude-code)' "$BODY_FILE"
```

Expect no output. The template carries none of these, so any hit was introduced while rendering — strip the offending lines, including the blank line and any `---` separator that preceded them, rewrite the file, and re-run the check. Never submit a body containing a `Co-Authored-By` trailer, a "Generated with Claude Code" line, or a session URL.

Then tell the user, giving the path as an **absolute path followed by `:1`**:

```
PR body written to {ABSOLUTE_PATH}:1
{N} stories, ordered by sprint descending then work ID ascending.
{H} of them already deployed to {BASE} by hotfix: {HOTFIX_IDS}
Title: {PR_TITLE}
Review or edit the file, then type `yes` to submit.
```

Leave the hotfix line out entirely when no story was already deployed by one. A line reading `0 of them` is noise.
When there is one, name every ID — a count alone tells the reader something is there and not what.

`{ABSOLUTE_PATH}` is what the write command's closing `echo` printed. That `echo` sits inside the
same command deliberately: a shell variable does not survive into the next one, so a separate command
would print `:1` and nothing else.

**The `:1` and the absolute path are both load-bearing.** Claude Code turns a `path:line` reference
into something the reader can click straight from the terminal; a bare path is plain text they have
to copy out and open by hand. A relative path resolves against the session's working directory,
which is not always the repository root, so give the path in full.

Print exactly one form. A path repeated as plain text, a `file://` URL and a clickable reference
makes the reader work out which one to use.

Wait for an explicit `yes` before Phase 8.

Anything other than `yes` is a revision request, not an approval: apply the change, rewrite the file with the same heredoc, report it again, and wait again. Loop until the user approves. Never read approval into silence, a question, or a comment that merely sounds positive. Confirming an input — a branch, a title, a date, a runlist — is answering a question, not approving the publish.

The user may also edit that file by hand during review. Phase 8 submits that file with `--body-file`, so hand edits are what get published — after a `yes`, re-read the file and submit it as it stands rather than re-rendering it from the Linear data. Run the same attribution check from Phase 7 on the file as it stands, because a hand edit can add a line the first check never saw.

## Phase 8 — Open or update the PR

Confirm `gh` is authenticated:

```bash
gh auth status
```

If it is not, stop and tell the user to run `gh auth login`.

Use the `PR_TITLE` the user approved. Do not recompute it here.

**Set `BODY_FILE` again in this phase's own command.** A shell variable does not survive from one
command to the next, so the one Phase 7 set is gone by now. An unset variable expands to nothing and
`--body-file ""` publishes a PR with an empty body, which looks like the render failed rather than
like a variable was lost.

Run the Phase 7 attribution check on the body file as it stands, and continue only when it prints nothing.

When `PR_NUMBER` is unset, read `${CLAUDE_SKILL_DIR}/references/open-new-pr.md` and open the PR by it. When `PR_NUMBER` is set, read `${CLAUDE_SKILL_DIR}/references/update-existing-pr.md` and update the PR by it.

Before the closing report, read `${CLAUDE_SKILL_DIR}/references/verification.md` and confirm each item against real output.

Close with the links and, when there are any, the hotfix stories:

```
PR: {PR_URL}
Body: {ABSOLUTE_PATH}:1

Already deployed to {BASE} by hotfix, listed in this PR for completeness:
  {WORK-ID}  {TITLE}
  {WORK-ID}  {TITLE}
These went live earlier — on their own hotfix branches for uat, through an earlier production release for prod. This PR only carries the commits that copy them back.
```

The PR URL is what was published. The body file is what was published *from*, and it stays on disk
after the run as the review artifact for that deployment — so the closing report names it in the same
clickable form Phase 7 used, rather than leaving the reader to scroll back for it.

**Say the hotfix block out loud, every time there is one.** The table cannot carry the distinction: it
has four fixed columns and a hotfix row looks exactly like any other. Somebody reading it will take
every row as work this deployment delivers. That is true of every other row and false of this one, and
here is the only place the difference can be said. Omit the block when no story was already deployed by
a hotfix; never omit it to keep the report short.

**Name the stories, do not summarise them.** `2 hotfix stories included` tells the reader a category
exists. `ABC-285 Fix work type sync` tells them which story to go and check.

Do not merge the PR — this skill prepares the deployment PR and never merges it.

Phase 9 follows, but only once the user has nothing further to raise.

## Phase 9 — Wind up the worktree

**This phase runs last, and only when the user has nothing further to raise.** Do not enter it while
any question is open — a revision to the body, a row the user is still checking, a `gh` command that
failed. Removing the working copy underneath an unfinished conversation destroys the artifact the
conversation is about.

**Ask, and default to keeping.** Never remove anything on your own judgement, and never treat the
user's `yes` to publishing as consent to clean up. They are separate decisions.

### Step 1 — Is there a worktree at all?

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git worktree list --porcelain | awk '/^worktree /{print $2; exit}'
git rev-parse --show-toplevel
git branch --show-current
```

The two `rev-parse` answers differ only inside a linked worktree. When they match, this session is in
the main working copy: say so in one line and stop. There is nothing to wind up, and offering to
anyway invites a yes to a question that has no safe answer.

The third command prints the main working copy's path — where Step 4 must be run from.

### Step 2 — Say what would be lost

```bash
git status --porcelain
git log --oneline @{upstream}..HEAD 2>/dev/null || git log --oneline main..HEAD
```

Two things live in a worktree and die with it:

- **Uncommitted and untracked files.** The review artifact is one of them. `.claude/skills/*/output/`
  is ignored by git, so the body file this run wrote is untracked, and removing the worktree deletes
  it. `git worktree remove` refuses while any such file is present, which is the safety net — do not
  reach for `--force` to get past it, read what it is protecting.
- **Commits not on any other branch.** They are reachable only from this branch, and Step 4 deletes
  the branch.

### Step 3 — Ask

Show the path, the branch, and everything from Step 2, then ask:

```
Finished with this worktree?

  worktree  {WORKTREE_PATH}
  branch    {BRANCH}
  would go  {N} untracked file(s), {M} commit(s) not on another branch

Removing it deletes the directory and the branch. The body file goes with it unless it is
copied out first — say `keep` to leave everything as it is, or `remove` to clean up.
```

Wait for the answer. Anything other than an explicit `remove` means keep. Silence means keep. A
comment that merely sounds agreeable means keep.

### Step 4 — Carry the artifact out, then remove

On `remove`, read `${CLAUDE_SKILL_DIR}/references/worktree-removal.md` and follow it before Step 5. When `ExitWorktree` refuses and lists uncommitted or unmerged work, show that list to the user and pass `discard_changes: true` only after a second explicit answer.

### Step 5 — Report

Name the main working copy the session is now in, the body file's new clickable path, and the PR URL
again — the PR is the durable result and the reader is one message away from having lost sight of it.

When the user chose `keep`, say what was left and where, and that the worktree is theirs to remove
whenever they want.

## Verification

After Phase 9, read `${CLAUDE_SKILL_DIR}/references/verification.md` again and confirm each item against real output.

When a Verification item fails, read `${CLAUDE_SKILL_DIR}/references/common-mistakes.md` and apply the matching correction.
