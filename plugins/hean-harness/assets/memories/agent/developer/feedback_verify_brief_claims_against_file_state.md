---
name: verify-brief-claims-against-file-state
description: A task brief can describe a comment or code state that does not exist in the file being edited — read the file first and flag the mismatch instead of silently treating "correct" as "add"
type: feedback
---

A task brief said an existing CSS comment "currently claims [specific wrong text]... and must be corrected." Reading the file and `git log -p` on it showed no such comment ever existed at that line — the value there had gone straight from `18vw` to `13vw` to `310px` across three prior commits with no comment at any point. The wrong-comment text closely matched the *shape* of a real comment on a sibling CSS custom property in a different file in the same component tree (`/* Footer height: 532 / 1600 ≈ 33.25vw — scales proportionally with viewport width */`), suggesting the brief's author was recalling that sibling comment, not this file.

**Why:** the task explicitly asked to flag anything that contradicts its own reasoning. Silently writing the new comment and treating it as a "correction" would have hidden the mismatch between the brief's premise and the actual repo state — a mismatch worth surfacing because it means the brief was authored from a different mental model of the file than what's on disk.

**How to apply:** before editing a file because a brief says its current content is wrong, actually read the current content (and `git log -p` if the specific text matters) rather than assuming the brief's description is accurate. If the described "wrong" state doesn't exist, still make the requested-correct addition, but report the discrepancy explicitly as an addition rather than a correction, and name what the brief's author most likely conflated it with if a plausible source is visible nearby.
