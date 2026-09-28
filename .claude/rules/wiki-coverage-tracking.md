---
paths:
  - "plugins/hean-harness/skills/**"
  - "plugins/hean-harness/agents/**"
  - "plugins/hean-harness/hooks/**"
  - "plugins/hean-harness/assets/rules/**"
---

# Wiki Coverage Tracking

Apply whenever a skill, agent, hook, or rule file under those paths is added, removed, or renamed.

## Rule

- Update `docs/wiki-coverage.md` in the same change: add a row for a new component, remove the
  row for a deleted one, rename the row for a renamed one.
- For a new component, ask the user whether it gets a dedicated entry on the matching wiki page
  (Skills, Agents, Hooks, or Global Rules) before treating the addition as finished. Never decide
  this without asking.
- Mark a component `pending` in `docs/wiki-coverage.md` when the user defers the decision, and
  `excluded` when a component is not eligible for wiki documentation, such as a skill shipped
  under the wrong filename.
- Keep this rule and `docs/wiki-coverage.md` only in this repository's own `.claude/rules/` and
  `docs/`. Never move either into `plugins/hean-harness/assets/`, since that would ship this
  repository's own maintenance process to every installing project.
