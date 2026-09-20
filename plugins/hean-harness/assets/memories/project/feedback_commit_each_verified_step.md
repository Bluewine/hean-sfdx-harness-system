---
name: feedback_commit_each_verified_step
description: Never commit unless the user asks; protect uncommitted work by forbidding git checkout/restore/stash in every agent brief
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 95008e38-e35b-4d72-b871-451fad49e4a7
  modified: 2026-09-18T03:44:10.268Z
---

The user decides when to commit. Never commit on your own initiative, not even to checkpoint
a verified step in an incremental rebuild. Ask, or wait to be told.

That makes uncommitted work the normal state for long sessions, so the working tree must be
protected a different way: **forbid destructive git commands in every agent brief.**

**Why:** Subagents share one working tree. An agent recovering from its own mistake — an
accidental `prettier --write`, a bad edit — reaches for `git checkout -- <file>`, which
reverts to the last commit and silently destroys every uncommitted change in that file,
including work a different agent made for a different step. The revert looks successful — the
agent reports its own reformat as undone — so nothing signals the collateral loss. It surfaces
later, if at all, as a diff against HEAD that is implausibly small for the work it should
contain.

**How to apply:**
- State in every agent brief that touches a file with uncommitted work: never run
  `git checkout`, `git restore` or `git stash` in this repository.
- Tell agents not to run `prettier --write` on a file that does not already conform — that is
  what creates the mess they then try to revert.
- When an agent reports reverting anything via git, immediately check whether other
  uncommitted work lived in that file. "Reverted" never means "reverted only my change".
- A diff line count too small for the work described is the signal to go and verify.
- Keep the content of a verified-but-uncommitted step recoverable outside the tree while it
  is the only copy.

Related: [[feedback_always_use_developer_agent]], [[feedback_never_force_add_ignored]].
