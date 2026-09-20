---
name: Always merge with --no-ff
description: All git merges must use --no-ff to preserve branch topology in history
type: feedback
originSessionId: 72e56408-d98b-4477-b810-e9721f9ca154
---
Always pass `--no-ff` when running `git merge`. Never allow fast-forward merges.

**Why:** Fast-forward merges lose branch topology — the history looks linear and you can't tell where a branch started or ended. The user corrected this after a fast-forward merge collapsed a feature branch into its target, leaving no record that the branch had existed.

**How to apply:** Any `git merge` command, regardless of branch or context, must include `--no-ff`.
