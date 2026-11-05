# Linear fallback

**Linear MCP unavailable** (per work ID, asking one message per work ID):

```
Linear MCP is not connected. For {WORK-ID}, please provide:
1. Issue title (copy from Linear, including any bracketed prefix):
2. Linear issue URL (copy from browser):
3. Assignee as Linear shows it, or "unassigned":
4. Sprint name, or "none":
5. Sprint URL (copy from browser, even when the sprint has no name), or "none":
6. Sprint start date as YYYY-MM-DD, or "none":
7. Project name, or "none" (needed only when item 4 is "none"):
8. Project URL (copy from browser), or "none":
```

Wait for the response; use the values verbatim. If any value is empty, re-ask for that value until provided; items 7 and 8 are exempt from the re-ask when item 4 is not `"none"`, and item 8 is exempt when item 7 is `"none"`. `"unassigned"` renders `—`; `"none"` for item 4 with `"none"` for item 7 or item 8 and a sprint URL in item 5 that ends in `/cycle/{number}` gives the cell `[Cycle {number}]({item 5})`, the cycle-number fallback; with `"none"` for item 5 as well it leaves that story's sprint unresolved; item 4 naming a sprint while item 5 is `"none"` is also unresolved and goes to the Phase 6 checkpoint, because the sprint link has no target; a named sprint in item 4 with a sprint URL needs no project, so `"none"` for items 7 and 8 is then not unresolved.

The eight values replace what `get_issue` and `list_cycles` would have returned, so items 4 to 6 also discharge Phase 4 for that story: the sprint name is its **Sprint** cell, the sprint URL is that cell's link target verbatim, and the start date is its Phase 5 sort key. Do not construct the sprint link from parts in this path — take the URL as pasted, for the same reason the issue URL is never slugified. A pasted project URL is taken verbatim too, and so is the sprint URL in the cycle-number cell: only the number is read from it, for the cell text. When item 4 is `"none"` and item 7 names a project, the Sprint cell is `[Project: {item 7}]({item 8})`, with item 7 escaped as in `${CLAUDE_SKILL_DIR}/references/linear-sprints.md`; item 6 still decides the ordering. Item 7 named with item 8 `"none"` is no usable project: use the cycle-number fallback when item 5 ends in `/cycle/{number}`, otherwise the story goes to the Phase 6 checkpoint, as a project with no `url` does in `linear-sprints.md`.
