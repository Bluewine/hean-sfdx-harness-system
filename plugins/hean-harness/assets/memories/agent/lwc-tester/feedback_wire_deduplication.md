---
name: Wire adapter emission deduplication in LWC Jest tests
description: Cross-file wire contamination causes intermittent test failures when the same adapter emits the same value in multiple describe-level beforeEach blocks
type: feedback
---

Deduplicate wire emissions within a test file before diagnosing any LWC Jest failure where tests pass in isolation but fail in the full suite.

The symptom: tests in a `describe` group with a `beforeEach` that emits wire data fail when the full suite runs together, but pass when the file runs alone. The root cause is `global.wireAdaptersRegistryHack` — a worker-level Map shared across test files. Multiple `emit()` calls for the same adapter + value accumulate state that corrupts other test files running in the same worker.

The fix: restructure so each distinct wire state transition (`adapter.emit(sameValue)`) appears at most once in the file. When multiple `describe` groups need the same SA record state, nest them under a single parent `describe` with one `beforeEach` that emits that state. Additional resource wire emissions go into nested `describe` blocks with their own `beforeEach`.

**Why:** Covered by `.claude/rules/lwc-conventions.md §6 (Wire Adapter Emission Deduplication)`.

**How to apply:** When a test that uses `beforeEach` wire emissions fails only in the full suite (not in isolation), grep for `getRecord.emit` / `getRelatedListRecords.emit` in the test file — any value that appears more than once across `beforeEach` blocks or `it()` blocks must be consolidated. The cross-file contamination comes specifically from test files that share the same wire adapter mock (e.g., two components both mocking `lightning/uiRecordApi`).