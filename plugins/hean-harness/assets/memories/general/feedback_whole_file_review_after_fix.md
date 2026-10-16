---
name: feedback-whole-file-review-after-fix
description: "After each fix to a skill or rule file, re-read the whole file for coherence and consider an advisor pass — never accumulate isolated patches"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f275c3bd-0f48-4429-8874-d4c279626fa3
  modified: 2026-08-13T14:44:30.664Z
---

After every individual fix to a skill, rule, or agent file, re-read the entire file end to end and check it as a system: contradictions between old and new text, cross-references that no longer resolve, terminology that shifted meaning, and verification steps that the change invalidated. Consider an advisor pass on the whole file before declaring the fix done. When several fixes have accumulated, do one coherent rewrite instead of another patch.

**Why:** A file edited through a sequence of targeted patches degrades into disconnected fragments rather than a consistent set of steps crafted to meet a goal. Real instances: a "other-team IDs belong in the table" line survived alongside a new rule that excluded exactly such an ID, and a verification step asserting `rows == candidate count` stayed after exclusion classes were added, so a correct run would fail its own check.

**How to apply:** Make the fix, then read the whole file, then reconcile — do not stop at the edit. Prefer replacing a stale claim over appending a qualifier next to it. Re-run any regression the file's logic was originally validated against, since a patch can invert a filter silently. Related: [[feedback_skill_isolation]], [[feedback_no_duplicated_code]].
