# Linear sprints

`get_issue` returns `cycleId` as a UUID, which is not directly renderable. Map it with the Linear MCP `list_cycles` tool, called once per distinct `teamId` in the row set, and match on `id`:

- `title` → the **Sprint** column text, verbatim.
- `number` → the sprint link target: `https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{number}`, where `TEAM_KEY` is the letter prefix of that story's work ID (`ABC-126` → `ABC`).
- `startsAt` → the sort key for Phase 5.

**Take `{WORKSPACE}` from the `url` Phase 3 returned**, which has the form `https://linear.app/{WORKSPACE}/issue/...`. Do not hardcode a workspace slug and do not carry one over from another repository — a wrong slug yields a link that resolves to someone else's workspace or to nothing.

**Cycle numbers and titles are per-team and are not comparable across teams.** Each team numbers its own cycles from 1 and names them on its own scheme, so two teams' cycle 6 can be different date ranges with unrelated titles. Always call `list_cycles` for the story's own `teamId`, and never reuse one team's cycle list to resolve another team's `cycleId`.

Cycle assignment is read live and issues do get re-assigned between cycles, so a row's sprint reflects Linear at generation time, not at merge time.
