---
name: reference_lwr_site_needs_community_publish
description: Deploying to an LWR Experience Cloud site updates the org but the live URL keeps serving the last published snapshot until sf community publish runs
metadata:
  node_type: memory
  type: reference
---

An LWR Experience Cloud site serves the last **published** snapshot at its live URL. Deploying
LWC or other site metadata to the org updates the components, but changes nothing a visitor sees
until the site is published.

`community_layout-*` component names appear in LWR sites as well as Aura ones, so their presence
is not evidence the site is Aura. Check the site's template instead.

To make a deployed change visible on the live URL:

```
sf community publish --name "<site name>" -o <your-org-alias>
```

Publishing is asynchronous — it reports that an email will arrive when the site is live, and
propagates in roughly 30 to 60 seconds. Verify with a cache-busting query parameter such as
`?cb=...` to get past the browser cache.

Publishing is outward-facing: it changes what visitors to the site see. On any shared or
externally reachable org, confirm with the user before running it.
