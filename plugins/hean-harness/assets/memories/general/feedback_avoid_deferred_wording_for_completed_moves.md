---
name: avoid-deferred-wording-for-completed-moves
description: "Never describe a cross-task/cross-commit sequencing move as \"deferred\" when the work is fully done — it reads as still-pending"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6a1aba48-8c00-4ad9-9bf0-83425f5afcf9
  modified: 2026-09-04T18:27:22.110Z
---

When reporting a multi-step ruling where some piece of work was moved from one task or
commit to a later one for sequencing reasons (for example, to avoid a broken build in
between), and that work was in fact fully completed by the time the whole unit of work
finished, do not describe the move as "deferred." That word reads as "not done yet" or
"left in place," even when the opposite is true.

**Why:** A report once used the phrase "deferred deletion ... from Task 5 to Task 6" for
work that was, by the end, fully removed — the reader concluded the old code was still in
the codebase, which triggered a multi-turn back-and-forth to re-confirm everything had in
fact been fully removed. The confusion was caused entirely by word choice, not by the
underlying engineering decision, which was correct.

**How to apply:** When summarizing a sequencing ruling for a human, state the fact plainly
and unambiguously: "X was deleted in the later step instead of the earlier one, so the
build never broke in between" — not "deferred," "kept," "left for later," or any word
implying an open or pending state. If something is genuinely still pending, say so
explicitly and separately from anything that is actually done. This applies to any final
report, ledger summary, or ruling list handed to a user after multi-step or multi-agent
work — the report is often the only thing they read, so its wording carries the full weight
of what actually happened.
