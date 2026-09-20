---
name: Agent routing — structural test fixes
description: Use developer not lwc-tester when fixing structurally broken tests
type: feedback
originSessionId: d75628ce-6945-4f01-8374-c964723ce289
---
Use the `developer` agent (not `lwc-tester`) when fixing structurally broken tests — e.g. wire contamination, missing flushPromises, incorrect describe nesting.

**Why:** The user corrected this directly. `lwc-tester` is for coverage gaps and anti-pattern cleanup. `developer` is for code fixes that require understanding root cause and verifying end-to-end.

**How to apply:** If tests are failing due to a structural/architectural issue (not a missing branch), route to `developer`. Only route to `lwc-tester` for coverage work or anti-pattern remediation.