---
name: open-work-report
description: Open work tracer for everything not yet merged to integration — lists one row per Linear story with subject, assignee, sprint, and whether its commits are fully pushed, partially pushed, or still only on this machine
---

You are executing the `/open-work-report` skill. Work through the phases below in order.

## The scope rule

**This skill owns everything *before* integration. `/release-pr` owns everything after it.**

A story appears here when it owns commits that have **not** reached `origin/integration`. Once merged, it stops being open work and becomes `/release-pr`'s business — that skill computes `origin/release..origin/integration` for the UAT deployment. The two never overlap, and neither recomputes the other's range.

The row set is defined by git, not by Linear. A Linear cycle cannot tell you what is unmerged; only the refs can. Linear is used solely to enrich each row with subject, assignee, and sprint.

## Phase 1 — Compute the row set

Everything this skill produces lives in `.claude/skills/open-work-report/output/`, which is gitignored. Clear last run's files first, so a run that dies partway cannot leave a stale intermediate that a later run reads as current:

```bash
mkdir -p .claude/skills/open-work-report/output
rm -f .claude/skills/open-work-report/output/open-work.json .claude/skills/open-work-report/output/open-work.md
git fetch origin
.claude/scripts/verify-remote-refs.sh integration || exit 1
node "${CLAUDE_PLUGIN_ROOT}/skills/open-work-report/scripts/open-work.mjs" \
  > .claude/skills/open-work-report/output/open-work.json
```

Never run the fetch under `--quiet` — it hides a failure, and a stale `origin/integration` silently inflates the report with work that is already merged.

**The verify step is not optional and its failure is not advisory.** `origin/integration` is a local copy of the remote, only as fresh as the last *successful* fetch, and a failed fetch is silent — the stale ref simply keeps answering. `verify-remote-refs.sh` compares it against what GitHub actually has and exits non-zero on any mismatch; stop the run there rather than reporting merged stories as open work. The same script guards `/release-pr`, so the check lives in one place and cannot drift between the two skills.

The script emits `{ integration, rows, mentionOnly }`:

- `rows` — one per owning work ID, each with `branches`, `commits`, `pushed`, `pushState`, and `alsoInIntegration`.
- `mentionOnly` — IDs that appear only inside another story's subject. They are cross-references, not work in flight, and get no row. Report them if non-empty.

`pushState` is computed from how many of that story's unmerged commits are reachable from any remote ref:

- **fully pushed** — all of them; the whole team can see this work
- **partially pushed** — some commits exist only in this clone
- **fully local** — none pushed; the work exists on one machine and nowhere else

**`aliases.json` is optional, local-only, and gitignored.** It folds a typo'd work ID into the real one — `ABD-117` into `ABC-117` — but which IDs were ever typo'd is a property of one clone's history at one moment, so the file is never committed. Its absence is the normal case and the script says nothing about it. Most runs need no aliases at all: a typo is usually caught and corrected before the work merges, and this skill only ever looks at pre-integration work.

Create it only when a typo'd ID actually shows up as its own bogus row, as `{"WRONG-1": "RIGHT-1"}` beside `scripts/`. If the file exists but cannot be parsed the script says so and continues without folding — that warning means an alias you intended is not being applied, so fix the file and re-run rather than reading the row set as-is.

## Phase 2 — Resolve each row in Linear

Read `.claude/rules/linear-story-resolution.md` first.

Call `get_issue` for each row's ID and take `title`, `url`, `assignee`, `cycleId`, and `teamId`. Copy `url` verbatim — never construct or slugify one.

An unassigned story renders `—`. An ID that does not resolve is surfaced, never dropped: the usual cause is a typo'd prefix, and if it maps to an ID that is already a row, the two are one story and stay one row.

## Phase 3 — Resolve the sprint

Map each `cycleId` with `list_cycles`, called once per distinct `teamId`. Take `title` for the cell, `number` for the link, and `startsAt` for the sort.

Cycle numbers restart per team, so never reuse one team's cycle list for another team's `cycleId`. A story with no cycle renders `—` and is called out in the summary.

## Phase 4 — Order the rows

Same order as `/release-pr`, so the two reports read alike:

1. **Sprint block, descending by cycle `startsAt`.** Never sort on cycle `number`.
2. **Within a block, work ID ascending** — team key ascending, then the numeric part compared **as a number**: `ABC-96` precedes `ABC-146`.

## Phase 5 — Render

The report goes to `.claude/skills/open-work-report/output/open-work.md`, beside the JSON from Phase 1. Phase 1 already created the directory and cleared the previous run.

The table is:

```
Work ID | Branch | Subject | Assignee | Sprint | Push status
-- | -- | -- | -- | -- | -- |
```

**Work ID and Sprint are links; Branch, Subject, Assignee and Push status are not** — otherwise the same rule `/release-pr` follows. Escape any `|` inside a title or assignee as `\|`.

Render `branches` as inline code, comma-separated when a story spans more than one. Local and remote copies of the same branch are one name — `refs/heads/foo` and `refs/remotes/origin/foo` collapse to `foo`.

**The branch column is a label, never a determinant.** No row exists, and no push state is assigned, because of a branch name; the column only tells you where to go and look. That distinction matters when a name disagrees with the work. A row whose branches are all named for something other than its own work ID is the visible symptom of that ID having been reused.

Render `pushState` with its commit counts, e.g. `partially pushed (2/4)`. A row whose `alsoInIntegration` is true gets `⚠ also in integration — check for work-ID reuse` appended to its Push status cell: the story itself may already be merged while unrelated commits reused its ID.

Write the file with a heredoc, then report the counts in chat.

## Phase 6 — Answer the question

State how many rows, the breakdown by push state, and anything surfaced in Phases 1–3: mention-only exclusions, unresolved IDs, missing assignees or cycles. Point at `.claude/skills/open-work-report/output/open-work.md` for detail.

Regenerating is cheap and the output is gitignored — re-run rather than trusting an earlier file.

## Interpreting the output

- **fully pushed** — merged nowhere yet, but visible to the team and backed up.
- **partially pushed** — part of the story exists only in this clone; a teammate reading the branch sees less than you do.
- **fully local** — nothing is pushed. Losing this clone loses the work.
- **⚠ also in integration** — commits with this ID exist on both sides of integration. Usually work-ID reuse, not partial delivery. Read the commit subjects before drawing a conclusion.

The **Branch** column is where to go and look, and it is often the fastest tell that something is off. A story on a branch named after a different work ID — or on two unrelated branches — is almost always ID reuse rather than one effort spread thin.

Push state says nothing about delivery — every row here is unmerged by definition. It describes only how widely the work exists.

## Common mistakes

| Mistake | Correction |
|---|---|
| Row set built from a Linear cycle | Only the git refs know what is unmerged; Linear enriches, never selects |
| Including work already in integration | That is `/release-pr`'s range; this skill stops at integration |
| Treating `fully local` as a delivery problem | It is a visibility and backup problem; nothing here is delivered either way |
| Reading `⚠ also in integration` as partial delivery | It usually means two different efforts share one work ID |
| Scanning `--all` instead of `--branches --remotes` | `--all` walks the stash and tags; a stash entry is not work in flight |
| Skipping `git fetch`, or running it `--quiet` | A stale `origin/integration` reports merged work as still open |
| Continuing past a non-zero `verify-remote-refs.sh` | A failed fetch is silent and the stale ref keeps answering; stop and re-fetch instead |
| Reading `origin/integration` as "my local integration branch" | It is the remote's state as of the last fetch; the local branch can be many merges behind |
| Sorting work IDs as text | Compare the numeric part as a number — `-96` precedes `-146` |
| Giving a mention-only ID a row | Require that it owns a commit; resolving in Linear proves nothing |
| Deriving a row or a state from the Branch column | It is a label for navigation; every row and state comes from commit subjects and ancestry |
