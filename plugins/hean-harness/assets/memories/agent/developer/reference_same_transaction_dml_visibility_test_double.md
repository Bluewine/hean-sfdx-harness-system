---
name: same_transaction_dml_visibility_test_double
description: How to unit-test a fix that splits one combined DML statement into two sequential ones for external-Flow same-transaction visibility
type: reference
---

To prove a two-phase DML split (e.g. blank-then-activate) actually fixes a same-transaction visibility bug enforced by an external platform Flow (one this codebase cannot deploy or call directly), override the DML seam with a fake that snapshots a `Map<Id, String>` of "committed" field state at the START of each call, validates every row in that call against the snapshot (never against other rows in the same call), and only merges the call's own writes into the committed map AFTER the whole call finishes. This reproduces the platform's real per-statement validation semantics: mid-statement writes are invisible to that same statement's own row validation, but a prior statement's writes are visible to a later one.

**Why:** a validating automation outside the transaction reads state as of the DML statement's
start, not part-way through it. So when one statement both clears a value and sets it elsewhere,
the automation still sees the old value and blocks the new one. Splitting the work into two
sequential statements is what makes the first one's result visible to the second.

A test double that simply returns success or failure per row passes against the buggy single-statement
version too, because nothing in it models the commit boundary. The double has to represent
"the platform saw stale data mid-statement" deliberately, or the test proves nothing.

**How to apply:** When fixing any bug shaped like "two writes must land in separate sequential DML statements so a later statement's platform-side validation sees an earlier statement's already-committed result", always verify the regression test fails against the reverted (old, combined-batch) code before trusting it — a snapshot-per-call double is what makes that revert-and-fail step actually meaningful instead of vacuous.
