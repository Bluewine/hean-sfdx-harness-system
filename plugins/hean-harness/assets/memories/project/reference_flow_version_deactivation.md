---
name: flow-version-deactivation
description: "How to actually deactivate an existing active Flow version via metadata deploy — bare Flow-type status edit silently no-ops, use FlowDefinition instead"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4be6eb6f-547e-43d5-b57f-9f033a0896be
  modified: 2026-07-20T14:02:40.424Z
---

Deploying a `Flow`-type metadata file with only its `<status>` element changed (e.g. Active → Obsolete) against an already-active version silently no-ops — the deploy reports `"state": "Unchanged"` and the version's actual `Status` in the org stays `Active`. Flow versions are immutable once created (same platform behavior as `EmailTemplate.TemplateType` — see `reference_email_template_type_immutable_via_mdapi.md` in project agent-memory).

**The correct mechanism:** deploy the `FlowDefinition` metadata type (distinct from `Flow`), with its `<activeVersionNumber>` element removed or pointing elsewhere. `FlowDefinition` controls which version is active independently of the individual version records.

```bash
sf project retrieve start --metadata "FlowDefinition:<ApiName>" --target-org <org> --target-metadata-dir <dir>
# unzip, edit the .flowDefinition file to remove <activeVersionNumber>...</activeVersionNumber>
sf project deploy start --metadata-dir <dir>/unpackaged --target-org <org>
```

Verify via Tooling API, not just deploy success message: `SELECT Id, Status, VersionNumber FROM Flow WHERE DefinitionId = '<definitionId>'` (Tooling API) should show every version `Obsolete`, and `SELECT ApiName, ActiveVersionId FROM FlowDefinitionView WHERE ApiName = '<ApiName>'` should show `ActiveVersionId: null`.

**Gotcha on `--metadata-dir` path:** point it at the folder *containing* `package.xml` (typically `.../unpackaged`), not its parent — pointing one level too high produces `"No package.xml found"`.
