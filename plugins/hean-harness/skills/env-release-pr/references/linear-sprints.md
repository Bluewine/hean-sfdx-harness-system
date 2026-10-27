# Linear sprints

`get_issue` returns `cycleId` as a UUID, which is not directly renderable. Map it with the Linear MCP `list_cycles` tool, called once per distinct `teamId` in the row set, and match on `id`:

- `title` → the **Sprint** column text, verbatim.
- `number` → the sprint link target: `https://linear.app/{WORKSPACE}/team/{TEAM_KEY}/cycle/{number}`, where `TEAM_KEY` is the letter prefix of that story's work ID (`ABC-126` → `ABC`).
- `startsAt` → the sort key for Phase 5.

**Take `{WORKSPACE}` from the `url` Phase 3 returned**, which has the form `https://linear.app/{WORKSPACE}/issue/...`. Do not hardcode a workspace slug and do not carry one over from another repository — a wrong slug yields a link that resolves to someone else's workspace or to nothing.

**Cycle numbers and titles are per-team and are not comparable across teams.** Each team numbers its own cycles from 1 and names them on its own scheme, so two teams' cycle 6 can be different date ranges with unrelated titles. Always call `list_cycles` for the story's own `teamId`, and never reuse one team's cycle list to resolve another team's `cycleId`.

## Project fallback

**When it applies:** the story's cycle has no `title`, or the story has no `cycleId`. A story whose cycle has a `title` always shows the sprint, never the project.

- Call the Linear MCP `get_project` tool once per distinct `projectId` in the row set, passing the `projectId` as `query`.
- Cell text: `[Project: {PROJECT_NAME}]({PROJECT_URL})`. `{PROJECT_NAME}` is `get_issue`'s `project`, verbatim except that every `[` becomes `\[`, every `]` becomes `\]` and every `|` becomes `\|`. Example: `[Project: Billing Migration](https://linear.app/{WORKSPACE}/project/billing-migration-1a2b3c4d5e6f)`.
- `{PROJECT_URL}` is `get_project`'s `url`, copied verbatim. Never build it from the name: the URL ends in a slug plus a hash that the name does not reproduce, for the same reason the issue URL is never slugified.
- Ordering does not change. A story whose cycle has a `startsAt` but no `title` keeps its place by `startsAt`. A story with no cycle stays in the final no-start-date block, ordered by work ID.
- A story with no `projectId`, or whose `get_project` result has no `url`, has no project either: raise it at the Phase 6 checkpoint.

Cycle assignment is read live and issues do get re-assigned between cycles, so a row's sprint reflects Linear at generation time, not at merge time.
