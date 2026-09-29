# Wiki coverage

Tracks which components have a dedicated wiki entry, which are pending, and which are excluded.
Updated whenever a skill, agent, hook, or rule is added, removed, or renamed — see
`.claude/rules/wiki-coverage-tracking.md`.

## Skills

| Skill | Wiki page | Status |
|---|---|---|
| doctor | Skills | documented |
| implementation-defaults | Skills | documented |
| org-roles | Skills | documented |
| setup | Skills | documented |
| uninstall | Skills | documented |
| branch-manifest | — | pending (exists, not in original scope) |
| commit-format | Skills | documented |
| create-pr | Skills | documented |
| deprecate-flow | Skills | documented |
| finish-implementation | Skills | documented |
| flow-description-comment | Skills | documented |
| flow-trigger-order | Skills | documented |
| linear-start-issue | Skills | documented |
| memory-review | — | pending (exists, not in original scope) |
| open-work-report | — | pending (exists, not in original scope) |
| release-pr | Skills | documented |
| start-implementation | Skills | documented |
| update-pr | Skills | documented |
| test-changed | — | pending (exists, not in original scope) |
| jenkins-pre-post-deploy | Skills | documented |
| uat-hotfix | Skills | documented |
| version-bump | Skills | documented |
| hean | — | pending (exists, not in original scope) |
| soql-bindvar-resolver | — | pending (exists, not in original scope) |
| commit-walk-sync | — | excluded (ships as `SKILL.mdx`, not discoverable) |
| sync-to-branch | — | excluded (ships as `SKILL.mdx`, not discoverable) |

## Agents

| Agent | Wiki page | Status |
|---|---|---|
| apex-tester | Agents | documented |
| developer | Agents | documented |
| lwc-tester | Agents | documented |
| sfdx-deployer | Agents | documented |

## Hooks

| Hook | Wiki page | Status |
|---|---|---|
| check-installed.mjs | Hooks | documented |
| git-add-force-guard.mjs | Hooks | documented |
| flow-description-gate.mjs | Hooks | documented |
| commit-message-gate.mjs | Hooks | documented |
| org-write-gate.mjs | Hooks | documented |
| commit-approval-gate.mjs | Hooks | documented |
| git-identity-guard.mjs | Hooks | documented |
| commit-lifecycle-events.mjs | Hooks | documented |

## Rules

| Rule | Scope | Wiki page | Status |
|---|---|---|---|
| agent-briefing-style.md | global | Global Rules | documented |
| agent-writing-style.md | global | Global Rules | documented |
| claude-md-authoring.md | global | Global Rules | documented |
| implementation-commits.md | global | Global Rules | documented |
| no-body-separators-or-trailing-blanks.md | global | Global Rules | documented |
| no-commit-attribution-trailers.md | global | Global Rules | pending |
| skill-frontmatter-description-style.md | global | Global Rules | documented |
| task-list.md | global | Global Rules | documented |
| writing-style-meta-files.md | global | Global Rules | documented |
| apex-cognitive-complexity.md | project | Domain Conventions | pending |
| apex-docstring-comments.md | project | Domain Conventions | pending |
| apex-naming-conventions.md | project | Domain Conventions | pending |
| apex-query-consolidation.md | project | Domain Conventions | pending |
| apex-service-query-atomicity.md | project | Domain Conventions | pending |
| apex-test-conventions.md | project | Domain Conventions | pending |
| commit-message-format.md | project | Domain Conventions | pending |
| flow-conventions.md | project | Domain Conventions | pending |
| linear-story-resolution.md | project | Domain Conventions | pending |
| local-static-analysis.md | project | Domain Conventions | pending |
| lwc-conventions.md | project | Domain Conventions | pending |
| lwc-css-placement.md | project | Domain Conventions | pending |
| lwc-naming-conventions.md | project | Domain Conventions | pending |
| lwc-wes-conventions.md | project | Domain Conventions | pending |
| metadata-drift-check.md | project | Domain Conventions | pending |
| org-roles.md | project | Domain Conventions | pending |
| plan-mode-sf-research-workflow.md | project | Domain Conventions | pending |
| runbook-deployment-steps.md | project | Domain Conventions | pending |
| sfcore-apex-pattern.md | project | Domain Conventions | pending |
| slds-responsive-grid.md | project | Domain Conventions | pending |

## Memories

Not tracked per-entry — see the [[Memories]] page for why.

| Memory group | Wiki page | Status |
|---|---|---|
| assets/memories/project/ (60+ files) | Memories | pending |
| assets/memories/agent/developer/ | Memories | pending |
| assets/memories/agent/lwc-tester/ | Memories | pending |
| assets/memories/agent/sfdx-deployer/ | Memories | pending |
