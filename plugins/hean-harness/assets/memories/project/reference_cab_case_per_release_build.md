---
name: reference-cab-case-per-release-build
description: Every release-branch build creates a brand-new Fastlane CAB Change Request and never waits for approval
metadata: 
  node_type: memory
  type: reference
  originSessionId: e045b4ca-87ed-4609-b46f-ad58040e4581
  modified: 2026-09-17T19:03:46.895Z
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

Each Jenkins build of the `release` branch creates its own Fastlane CAB (Change Advisory Board) Change Request in Enterprise Service Central. The `cabPreDeploy` gulp step queries open Change Requests whose subject starts with the `cab.namePrefix` from `deploy-config.yml`, logs the count, then creates a new case regardless — open unapproved cases are never reused, so they accumulate one per release deployment. Case fields are populated straight from the `cab:` block, and the named Business Owner and Service Lead are set as approvers.

Approval does not gate the deployment: `cabPreDeploy` finishes in seconds and `deployPulledAsset` starts immediately, with no wait. After the deploy, `cabPostDeploy` updates the same record with the artifact version and security scan status.

Consequence: an open, unapproved Change Request in the list belongs to whichever earlier release build created it, not to the change about to be merged. A UAT hotfix merge raises a separate case of its own. The logic lives in the central `CICD_pipeline-central-sfdx-lib` shared library, not in this repo. Related: [[reference_lwr_site_needs_community_publish]].
