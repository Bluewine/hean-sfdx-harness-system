---
name: site-metadata-repo-wins
description: "For Experience Cloud site metadata, the repository is the source of truth — never retrieve from the org into the working tree; deploy with --ignore-conflicts when source tracking reports one"
metadata:
  node_type: memory
  type: feedback
---

When deploying Experience Cloud site metadata to the connected and selected org and source
tracking reports a conflict, the repository version wins. Never pull or retrieve site metadata
from the org into the working tree to resolve it.

**Why:** a site is edited in two places — in the repository, and in Experience Builder by anyone
with access to the org. Retrieving to resolve a conflict silently pulls whatever someone changed
in the builder into the branch, and the two are not reconcilable by reading the diff.

**How to apply:** on a deploy conflict for site components, rerun the deploy with
`--ignore-conflicts`. A read-only comparison into a temporary directory outside the repository is
fine; never retrieve into `force-app/`. Republish the site afterwards, per
[[reference_lwr_site_needs_community_publish]].
