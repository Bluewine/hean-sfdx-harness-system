---
name: Always use SFCORE_TestUtilities.generateId() for test IDs
description: Never use hardcoded or fake IDs in Apex tests — always generate real prefixed IDs via SFCORE_TestUtilities.generateId(SObjectType)
type: feedback
originSessionId: 58683836-2a23-4a72-85e9-492d6fba980e
---
Always use `SFCORE_TestUtilities.generateId(Schema.SObjectType)` to generate IDs in Apex tests. Never use hardcoded strings like `'0010000000000000AA'` or a custom `fakeId()` helper.

**Why:** Salesforce IDs encode the SObjectType in their prefix. Tests use real prefixed IDs to validate traceability — the ID must resolve back to the correct SObject type even when the record is not yet committed to the database. A structurally wrong ID breaks that contract and masks type-level bugs.

**How to apply:** Anywhere an `Id` value is needed in an Apex test, call `SFCORE_TestUtilities.generateId(MyObject__c.SObjectType)`. For lists, use `SFCORE_TestUtilities.generateIds(List<SObject>)` which assigns IDs in-place.