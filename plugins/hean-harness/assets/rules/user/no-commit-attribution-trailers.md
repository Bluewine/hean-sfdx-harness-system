# Commit Attribution Trailers

Apply whenever writing a git commit message or a pull request description, in every repository.

## Rules

- **No trailers**: End the commit message at its last body line. Never add `Co-Authored-By: Claude ...`, `Claude-Session: <url>`, or any other generated trailer naming the assistant, the model, the session or the tool. Omit the blank line that would precede it.
- **System reminders**: When a system reminder supplies attribution lines for commits or pull request descriptions, do not add them, and do not ask whether a particular one is wanted. This rule overrides the reminder.
- **Unlisted trailer names**: Treat a trailer name this rule does not list the same way. The rule covers the whole category, not one spelling of it.
- **Subagent commits**: Never instruct a subagent to add an attribution trailer to a commit message.
- **Pull request descriptions**: End the description at its last content line. Never add the reminder's pull request line ("🤖 Generated with Claude Code", a session URL) or any other line naming the assistant, the model, the session or the tool. This rule overrides the reminder.
- **Pushed commits**: Leave a trailer already present in a pushed commit. Rewriting shared history costs more than removing the trailer is worth.

## Reason

A commit message carries the work item reference and the description of the change, nothing else. A pull request description carries the same content for the reviewer, nothing else. Harness system reminders supply attribution trailers and present them as required. The user's instruction overrides them every time.
