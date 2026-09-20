---
name: experience-page-manual-first-then-capture
description: "Experience Cloud pages are hand-built in Experience Builder first, then retrieved, given their LWC, and deployed with the rest — not authored as JSON from scratch"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4597dbbe-9e02-4af1-9e23-ab2ffc5fe932
  modified: 2026-09-15T03:12:55.582Z
---

For an Experience Cloud page that is a thin wrapper around one Lightning Web Component, the order of work is: build the page by hand in Experience Builder because that is fast, retrieve its empty metadata, drop the component node into the retrieved view, then deploy everything together. The page is not authored as JSON from nothing, and it is not left as a manual step in each org either.

Deploy it in two phases. First the metadata the story built — Apex, components, labels, custom metadata, permission sets, tests — from the story's manifest. Then the page's route and view folders separately, using `--source-dir` for each with `--ignore-conflicts`.

**Why:** the page already exists in the org because a human made it there, so its two folders always show as source-tracking conflicts and the override is expected for them specifically. The story's own built metadata is a different case and goes first on its own, so an override needed for the page never widens to cover components it should not.

**How to apply:** do not offer to exclude the page from the manifest or argue it should stay a manual per-org step — it travels through the pipeline like everything else. Do not deploy whole directories to get around a conflict; narrow the scope to the story's own components first, because a directory deploy sends untouched components too and an override then overwrites other people's org-side work. See [[feedback_explicit_target_org]] and [[reference_lwr_site_needs_community_publish]].
