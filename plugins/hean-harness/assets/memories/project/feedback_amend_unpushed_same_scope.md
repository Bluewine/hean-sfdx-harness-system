---
name: feedback-amend-unpushed-same-scope
description: Amend into the existing unpushed commit when new changes belong to its scope; create a new commit only for a different design or a new feature
metadata:
  type: feedback
---

When work is still unpushed and the new changes are refinements to something an existing commit already covers, amend that commit rather than stacking a follow-up. Create a new commit only when the change is a different design or a genuinely new feature.

**Why:** a branch history where each commit is one coherent unit reviews far better than one where a feature arrives and is then corrected three times in public. Fix-up commits on unpushed work record the author's process rather than the change, and reviewers pay for that noise. Once a commit is pushed the calculus reverses, because rewriting shared history costs more than the tidiness is worth.

**How to apply:**
- Check whether the branch exists on the remote before deciding. `git ls-remote --heads origin <branch>` returning nothing means nothing is pushed, regardless of what the upstream tracking ref says — a branch can track `origin/integration` while never having been pushed itself.
- When several unpushed commits each need part of a change, `git reset --soft` back past them and recommit the same groupings with final content. That amends all of them without an interactive rebase, which this environment does not support.
- Tag the tip first as a safety ref, and afterwards diff the new HEAD against that tag to prove only the intended files differ. Delete the tag once verified.
- Amending rewrites SHAs. Tell anyone who has recorded the old ones — another session, a draft PR description — that they are stale.

Related: [[feedback_commit_message_length]], [[feedback_no_coauthored_by]], [[feedback_merge_no_ff]].
