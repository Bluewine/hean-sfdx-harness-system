---
name: chunk-overflow-branch-coverage
description: How to unit-test a chunk-overflow branch gated by a large private
  static final row-count constant, without depending on a mock's own query behavior
metadata:
  type: feedback
---

To cover a branch that only fires when a fetched row count exceeds a large
`private static final` chunk-size constant, override the query method (the
seam that fetches rows) in a test-only subclass. Make the override return
`chunkSize + 1` fabricated rows regardless of any limit argument it receives,
scoped to one object so the overflow assertion stays exact rather than a
loose "greater than zero" check.

**Why:** The constant is `final` and cannot be lowered from a test, and most
repository-mocking frameworks either ignore a row-limit argument entirely or
cap how many rows a test can realistically seed through normal data setup.
The only reliable lever is overriding the method that returns the row list
itself. `SFCORE_RepoFactoryMock` ignores
`setLimit` entirely, so seeding real records can never trigger this branch.

**How to apply:** Also override the write step (the DML seam) in the same
test double, so it returns an empty or fabricated result immediately rather
than letting every fabricated row flow through a real save-results mock —
that mock's per-row processing costs real CPU and heap for a branch
assertion that fires before any write happens at all. Capture the row count
the override received instead, and assert on that plus the overflow flag —
do not assert on a save-success count, since that would require the real
mock to process the full chunk. Also seed one real configuration row
matching whatever drives classification for the object being inflated, so
the test's outcome does not depend on live data already sitting in the org.
