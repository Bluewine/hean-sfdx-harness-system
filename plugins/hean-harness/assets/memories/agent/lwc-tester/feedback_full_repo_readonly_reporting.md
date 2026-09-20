---
name: full-repo-readonly-reporting
description: Whole-repo coverage reporting is in-scope when the user explicitly names it, and read-only requests skip the fix/verification phases
metadata:
  type: feedback
---

When the user explicitly asks for a coverage report across "the entire repository" / "all LWC directories," that instruction itself satisfies the user-specified branch of scope determination — it is not scope guessing or scope expansion, even though it's broader than one feature folder. A prior run in the same session scoping to one feature folder (e.g. experience-site) does not cap later, explicitly broader requests.

**Why:** The role's scope rules exist to stop silent scope drift during fix work, not to refuse an explicit, broader instruction from the user. Treating "entire repository" as unresolvable scope and asking for clarification would be wrong — the user already gave the clarification.

**How to apply:**
- If the user frames the task as read-only reporting ("do not write/modify/delete," "report only"), run baseline discovery and the coverage pass (Investigation_Protocol steps 1-4) and stop there — skip the fix phase, verification loop, and the standard fix-oriented Output_Format; answer in the format the user actually asked for.
- Still apply [[feedback_worktree_missing_node_modules]] for dependency resolution and still leave the worktree clean afterward.
- A single `sfdx-lwc-jest --coverage` run with no path argument covers every LWC root under `force-app/` in one pass (this repo has 4: custom-features/service-resources-onboarding, custom-features/experience-site, custom-features/woli-media-on-wo, default) — no need to invoke it per-folder for a repo-wide report.
