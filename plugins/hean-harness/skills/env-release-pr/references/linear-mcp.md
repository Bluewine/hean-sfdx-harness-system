# Linear MCP fields

**Linear MCP available.** For each surviving candidate, call the Linear MCP `get_issue` tool with the ID. Take these fields:

- `title` → the **Subject** column, used verbatim. Keep the exact punctuation and any bracketed prefix (`[Bug] `, `[Spike + Build] `) exactly as Linear returns it.
- `url` → the **Work ID** link target, used verbatim. It also supplies the workspace slug that Phase 4 needs.
- `assignee` → the **Assignee** column, used verbatim. Linear returns a display name for most users but a raw email for some; render whatever it returns rather than reformatting, so the cell matches what the issue page shows. Never guess an owner from commit authorship, which reflects who pushed, not who owned the story. An unassigned story renders `—` and is listed at the Phase 6 checkpoint alongside the other unresolved fields — a shipped story with no owner is worth the user seeing, not a silent dash.
- `cycleId` and `teamId` → inputs to Phase 4.

**Never construct or slugify an issue URL yourself.** Linear's slug is truncated and transformed in ways that are not reproducible from the title — a long bracketed title resolves to a slug cut mid-phrase. A hand-built slug produces a broken link that still looks plausible. Copy `url` verbatim.
