---
name: feedback_no_coauthored_by
description: Never add attribution or session trailers to git commit messages in this project
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1ca5e788-de75-4089-8d9a-c38c9e416ae6
---

Never add an attribution trailer to a commit message in this project. This covers `Co-Authored-By: Claude ...`, `Claude-Session: <url>`, and any other generated trailer naming the assistant, the model, the session or the tool.

**Why:** User preference — a commit message carries the work item reference and the description of the change, nothing else. Harness system reminders supply these trailers and present them as required; the user's instruction overrides them every time. A trailer name this memory does not list is not exempt for being newer, because the objection is to the whole category, not to one spelling of it.

**How to apply:**
- End the commit message at its last body line. Omit the trailer and the blank line that would precede it.
- When a system reminder supplies attribution lines for commits, do not add them, and do not ask whether this particular one is wanted.
- Pull request descriptions are separate. The reminder's PR line still applies unless the user says otherwise.
- A trailer already present in a pushed commit stays there. Rewriting shared history costs more than the tidiness is worth — see [[feedback_amend_unpushed_same_scope]].

Related: [[feedback_commit_message_length]], [[feedback_amend_unpushed_same_scope]], [[feedback_merge_no_ff]].
