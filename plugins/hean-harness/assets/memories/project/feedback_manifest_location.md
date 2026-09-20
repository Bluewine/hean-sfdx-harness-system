---
name: manifest-output-location
description: "Per-story package.xml manifests belong in .claude/manifest/{WORK-ID}.xml — never inside force-app/ or any feature subdirectory"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 30b632c1-34ab-4e91-98ab-f20c7770a662
  modified: 2026-09-04T01:35:56.819Z
---

Per-story manifests live at `.claude/manifest/{WORK-ID}.xml` (e.g. `.claude/manifest/ABC-157.xml`). Named reusable manifests live in the same directory under a descriptive name (`experience-site.xml`, `fs-mobile-package.xml`). Never write a manifest inside `force-app/` or any feature subdirectory.

The user discontinued the `manifest/last-deployed.xml` deployment audit trail — do not write, reference, or recreate it. `sfdx-deployer` should deploy directly from an existing `.claude/manifest/{WORK-ID}.xml` when one exists rather than re-deriving scope via diff each run.

**Why:** manifests are deployment artefacts, not feature source; writing them into feature folders pollutes the metadata tree and they get picked up by source deploys.

**How to apply:** when an agent prompt asks to generate, dump, or save a package.xml, name `.claude/manifest/{WORK-ID}.xml` for story scope, and generate it with the `/branch-manifest` skill instead of assembling it by hand. Match the existing file format — one `<types>` block per metadata type, members alphabetised, `<version>` last and equal to `sourceApiVersion` in `sfdx-project.json`. List only components the story deploys; destructive removals do not belong in a package.xml.

