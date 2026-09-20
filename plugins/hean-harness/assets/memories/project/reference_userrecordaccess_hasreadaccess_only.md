---
name: reference_userrecordaccess_hasreadaccess_only
description: "UserRecordAccess.HasReadAccess is the only trustworthy field for auditing per-user record visibility; MaxAccessLevel returns \"All\" for every record regardless of actual access"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 049dfd7d-5f84-49a4-8d40-0a21b2ed673d
  modified: 2026-09-08T19:46:18.272Z
---

When auditing what records a specific user can actually see, query `UserRecordAccess` filtered by `UserId` and `RecordId`, and read **only `HasReadAccess`**. Verified in a sandbox: `HasReadAccess` correctly returned `true` for records the user owned and `false` for records they had no share to, while `MaxAccessLevel` returned `All` for **every** record — including ones the same query flagged `HasReadAccess = false`, and including records checked for an unrelated low-privilege user. `HasAllAccess` was likewise `true` on records with no read access.

**Why:** `MaxAccessLevel` and `HasAllAccess` do not reflect the granted level per record in this context, so a query selecting several access fields at once produces self-contradictory rows that look like a platform bug or a mislabelled CSV column. Trusting them inverts the conclusion of a sharing audit.

**How to apply:** Calibrate before concluding — check a record the user provably owns (expect `true`) and one they provably cannot reach (expect `false`). Then batch all candidate record Ids through `RecordId IN (...)` at ~190 Ids per query and count `HasReadAccess` values; this yields an exhaustive, defensible "user can read N of M records" number without deploying an Apex `System.runAs` test class. Pairs with [[feedback_confirm_precise_cause_before_fix]] — this is the specific comparison check for "user sees records they shouldn't" reports.
