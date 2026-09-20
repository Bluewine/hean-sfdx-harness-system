---
name: never-force-add-ignored-files
description: Never git add -f a gitignored file, and never offer it as an option — ignore entries encode team consensus
metadata:
  type: feedback
---

Never run `git add -f` (or `--force`) on a file matched by `.gitignore`. Do not propose it, offer it as a fallback, or ask whether to do it. When a file the user asked to commit turns out to be ignored, commit everything else, say plainly that the file is ignored and by which `.gitignore` rule, and stop there.

**Why:** ignore entries in this repo are not casual. Each one lands only after the team reaches consensus, so the entry itself is the decision — overriding it from a single session discards a team agreement without the team present. A working tree that quietly gains a force-added file also breaks the assumption every other clone relies on.

**How to apply:** when a `git add` fails or a path looks ignored, run `git check-ignore -v <path>` and report the matching rule and line. Treat a zero-tracked-files count under that path as confirmation the exclusion is intentional and consistently held. If the user wants the file tracked, the fix is a reviewed `.gitignore` change, not a force-add.
