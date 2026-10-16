---
name: no-retrocompatibility-fully-adapt
description: "When a requirement changes, fully adapt code and tests to match it — never preserve old behavior via a compatibility shim or leave old tests passing unchanged"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6a1aba48-8c00-4ad9-9bf0-83425f5afcf9
  modified: 2026-09-05T02:16:00.067Z
---

When an architectural or requirement change lands, rewrite everything that depends on the
old shape to match the new one — production code and tests both. Do not keep the old code
path alive behind a wrapper "for compatibility" as a default move, and do not leave an old
test passing unchanged just because it still technically compiles against the new code.

**Why:** A compatibility wrapper is sometimes the correct call — a method kept alive
because another, unrelated caller genuinely still needs it is a deliberate architectural
decision, not a shortcut. The failure mode this guards against is reaching for that wrapper
by default, as the path of least resistance, instead of first checking whether the old
shape should simply be gone. The same failure shows up in tests: a test left "green"
against the old behavior after a requirement change is not a passing test, it is a test
that stopped verifying the real design.

**How to apply:** When a plan or a live decision changes how something works — a data
source, a method signature, a classification mechanism, an ordering guarantee — find every
test and every caller that assumed the old shape and rewrite it to assert against the new
shape. Don't leave a shim, don't leave a test frozen against old behavior "because it still
passes," and don't treat "nothing broke" as success if the thing that "didn't break" is
actually testing something that no longer reflects the real design. Keep a compatibility
path only when a genuinely separate, still-active caller needs it — and say so explicitly
when that's the reason, rather than defaulting to it silently.
