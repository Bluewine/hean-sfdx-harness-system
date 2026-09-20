---
name: find-plus-tobenull-vacuous
description: Array.find() + toBeNull() never fails on absence — the exact assertion pattern that made a "still renders" LWC Jest case unfalsifiable
metadata:
  type: reference
---

`Array.from(...).find(predicate)` returns `undefined`, not `null`, when nothing matches. Jest's `toBeNull()` matches only literal `null`, so `expect(found).not.toBeNull()` is true whether `found` is a real match or `undefined` — the assertion cannot fail even when the element is absent.

**Why:** caught by advisor review on a test verifying a WES send button (`c-wes-button` located via `Array.from(...).find(b => b.title === X)`) "survives" when a sibling flag is toggled off. The test passed regardless of whether the button actually rendered, so green did not mean the gate was correct.

**How to apply:** whenever an element is located via `.find()` (not `querySelector`), assert presence with `toBeDefined()`/`toBeTruthy()` and absence with `toBeUndefined()`, never `toBeNull()`/`not.toBeNull()`. `querySelector` results are the opposite case — they return `null` on a miss, so `toBeNull()` is correct there. Don't silently "fix" pre-existing instances of this pattern found elsewhere in a file while touching unrelated new tests — flag them but leave out-of-scope ones alone (see [[feedback_scope_git_commit_with_pathspec]] for the same narrow-the-diff instinct applied to git).
