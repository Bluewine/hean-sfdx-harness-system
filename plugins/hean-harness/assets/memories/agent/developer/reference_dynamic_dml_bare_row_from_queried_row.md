---
name: dynamic-dml-bare-row-from-queried-row
description: Never reuse a queried SObject row for update DML when the query attached extra display-only fields; USER_MODE FLS checks every populated field, not just the changed one
type: reference
---

`AccessLevel.USER_MODE` DML enforces field-level security on every populated field on the row being saved, not only the field whose value actually changed. A method that queries a row with extra fields attached for unrelated display purposes (e.g. a parent lookup field, a Name field for grid display) and then reuses that same row object for an update — mutating one field via `row.put(...)` and passing `row` straight into DML — will fail FLS on the untouched extra fields for any user lacking edit access to them, even though no code ever assigns them a new value.

**Why:** Updating a `WorkOrderLineItem` with only `WorkTypeId` populated succeeds; the same update with `WorkOrderId` also present, unchanged, fails with "fields being inaccessible ... WorkOrderId".

**How to apply:** When the SObjectType is resolved dynamically (not known at compile time, so a literal `new WorkType(Id = ..., Field__c = ...)` constructor isn't available), build a bare replacement via `Schema.SObjectType.newSObject(id)` and `.put(fieldApiName, value)` — never mutate and reuse the queried row. When the type IS known at compile time, a plain literal constructor is simpler and already correct.

**Test verification pattern:** `SObject.getPopulatedFieldsAsMap().keySet()` asserted against the exact expected field set is the generic way to prove a DML payload carries only the intended fields — catches any extra field, not just one named case. Confirm a new regression test like this actually has teeth by temporarily reverting the fix, redeploying, and confirming the test fails before restoring and redeploying — a test that passes on both the buggy and fixed code proves nothing.
