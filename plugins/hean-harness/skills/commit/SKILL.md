---
name: commit
description: User-typed commit approval for the current turn — lets the commit approval gate allow commits until the user's next message, after the user has reviewed the uncommitted changes; the model cannot start it
argument-hint: "[what to commit]"
disable-model-invocation: true
allowed-tools: ["Bash", "Read"]
---

# Commit

The user reviewed the uncommitted changes and approved committing them in this turn. The commit
approval gate allows commits until the user's next message.

Arguments: $ARGUMENTS

## Steps

1. Run `git status --short` and `git diff --stat`, and show the result.
2. Commit what the arguments name. With no arguments, commit every change shown in step 1.
3. Follow the repository's commit message rules. When the commit message gate refuses a subject,
   fix the subject and commit again.
4. Report each commit's hash and subject.

## Rules

- Commit only in this turn. The approval ends with the user's next message.
- Never push. Pushing is a separate request.
