---
paths:
  - "plugins/hean-harness/assets/memories/**"
---

# Memory Placement

Apply whenever a memory is added under `plugins/hean-harness/assets/memories/`.

## Rule

- **Salesforce memory:** Put the memory in `assets/memories/project/` when it depends on any of:
  1. Salesforce platform behaviour — orgs, metadata, Apex, LWC, Flow, Experience Cloud, Field
     Service, governor limits, the `sf` CLI.
  2. The plugin's Salesforce agents `developer`, `apex-tester`, `lwc-tester`, `sfdx-deployer`.
  3. The SFDX repository and its pipeline — `force-app/`, `runbooks/`, `package.xml` manifests,
     `deploy.yml` and release-branch builds.
- **General memory:** Put every other memory in `assets/memories/general/`.
- **Why:** Setup installs `general/` in every repository and `project/` only in a repository
  whose root holds `sfdx-project.json`. A Salesforce memory in `general/` loads in unrelated
  repositories; a general memory in `project/` never reaches them.
- **Folder only:** Classify a memory by its folder alone. Never add a tag or a frontmatter field
  for it.
- **Scope:** Keep this rule only in this repository's own `.claude/rules/`. Never move it into
  `plugins/hean-harness/assets/`, since that would ship this repository's own maintenance process
  to every installing project.
