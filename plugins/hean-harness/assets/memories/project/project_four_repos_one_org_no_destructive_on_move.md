---
name: four-repos-one-org-no-destructive-on-move
description: "Several repositories can deploy to the same org, so moving metadata between them is relocation only — never add a destructive change for a cross-repo move"
metadata: 
  node_type: memory
  type: project
  originSessionId: 922e00c8-63ea-415c-afe4-4b04ad32e919
  modified: 2026-09-14T13:49:30.132Z
---

When more than one repository deploys
to the same sandbox and the same production org. A component's repo is only where its source lives, not
which org owns it.

Moving metadata from one repo to another is therefore a **physical relocation of the source file**, not a
deletion followed by a creation. Delete the files from the losing repo, add them to the gaining one, and
add nothing to `deletePackage/pre/destructiveChangesPre.xml` or
`deletePackage/post/destructiveChangesPost.xml`.

**Why:** a destructive-changes entry deletes the component and its data from the shared org. Since every
repo targets that same org, the component is still needed there — it has simply started arriving from a
different pipeline. Adding a destructive entry would drop a live component that another repo is about to
deploy, and nothing sequences the two pipelines against each other, so the window where it is missing is
unbounded. Untracking a file has no org effect on its own; only the destructive manifest does.

**How to apply:** when a move spans repos, land the gaining repo first and let its build go green before
pushing the losing repo's deletion, so the source is never absent from every pipeline at once. Leave both
across every repo the move touches.
