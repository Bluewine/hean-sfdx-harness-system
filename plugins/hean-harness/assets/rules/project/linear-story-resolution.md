---
paths:
  - "**/skills/create-pr/**"
  - "**/skills/update-pr/**"
  - "**/skills/release-pr/**"
  - "**/skills/open-work-report/**"
---

# Linear Story Resolution

Apply whenever resolving a work ID to a Linear issue, or an issue to its sprint cycle.

## Issue resolution

Call `get_issue` with the work ID. Take four fields:

- `title` — used verbatim, including any bracketed prefix (`[Bug] `, `[Spike] `)
- `url` — used verbatim
- `cycleId` — a UUID, not directly renderable
- `teamId` — required to resolve `cycleId`

**Never construct or slugify an issue URL.** Linear truncates and transforms slugs in ways not reproducible from the title: `[Bug] Work type sync fails on parent change` resolves to `.../ABC-120/bug-an-issue-slug`. A hand-built slug produces a broken link that still looks plausible.

## Cycle resolution

Map `cycleId` with `list_cycles`, called once per distinct `teamId`, matching on `id`.

- `title` — the sprint text, e.g. `2026.07c - TEAM - Project Name`
- `number` — the link target: `https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{number}`.
  Take `{WORKSPACE}` from the `url` the issue lookup returned, which has the form
  `https://linear.app/{WORKSPACE}/issue/...`. Never hardcode a workspace slug and never carry one
  over from another repository — a wrong slug yields a link that resolves to someone else's
  workspace, or to nothing.
- `startsAt` — the sort key

**Cycle numbers and titles are per-team and not comparable across teams.** Each team numbers its cycles from 1 on its own scheme. `ABC` cycle 6 is `2026.07c` running Jul 27–Aug 10; `XYZ` cycle 6 is `2026.7b` running Jul 27–Aug 3. Always call `list_cycles` for the story's own `teamId`.

A work ID from another team's prefix is a normal occurrence once a feature spans more than one repository, not an edge case.

## Ordering

Sort by `startsAt`, never by `number` — numbers restart per team, so ordering by number interleaves teams' sprints into the wrong blocks.

## Missing data

Cycles are not guaranteed to have a `title`; future and unstarted cycles routinely return `null`. Fall back to `number` and `startsAt` rather than emitting a blank or invented value.

Cycle assignment is read live. A report reflects Linear at generation time, not at merge time.

## Unresolvable IDs

Never silently drop an unresolvable ID and never guess a substitute. Common causes are a typo'd prefix in a commit subject (`ABD-117` for `ABC-117`) or a non-Linear tracker ID. Surface every unresolved ID and ask.
