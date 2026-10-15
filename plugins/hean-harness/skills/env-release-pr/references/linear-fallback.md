# Linear fallback

**Linear MCP unavailable** (per work ID, asking one message per work ID):

```
Linear MCP is not connected. For {WORK-ID}, please provide:
1. Issue title (copy from Linear, including any bracketed prefix):
2. Linear issue URL (copy from browser):
3. Assignee as Linear shows it, or "unassigned":
4. Sprint name, or "none":
5. Sprint URL (copy from browser), or "none":
6. Sprint start date as YYYY-MM-DD, or "none":
```

Wait for the response; use the values verbatim. If any value is empty, re-ask for that value until provided. `"unassigned"` renders `—`; `"none"` for items 4 to 6 leaves that story's sprint unresolved.

The six values replace what `get_issue` and `list_cycles` would have returned, so items 4 to 6 also discharge Phase 4 for that story: the sprint name is its **Sprint** cell, the sprint URL is that cell's link target verbatim, and the start date is its Phase 5 sort key. Do not construct the sprint link from parts in this path — take the URL as pasted, for the same reason the issue URL is never slugified.
