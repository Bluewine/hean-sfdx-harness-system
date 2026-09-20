---
name: apex-no-ispolymorphicforeignkey
description: Schema.DescribeFieldResult has no isPolymorphicForeignKey() method in Apex — detect a polymorphic lookup via getReferenceTo().size() > 1 instead
type: reference
---

`Schema.DescribeFieldResult.isPolymorphicForeignKey()` does not exist in Apex (confirmed by a
failed deploy in this org: "Method does not exist or incorrect signature:
void isPolymorphicForeignKey() from the type Schema.DescribeFieldResult"). It is easy to assume
this method exists — the name reads like real Salesforce Schema API surface, and it does not
compile-error until deploy time, not at write time.

**How to detect a polymorphic lookup/master-detail field in Apex:**
```apex
Schema.DescribeFieldResult field = someField.getDescribe();
Boolean isPolymorphic = field.getReferenceTo().size() > 1;
```
`getReferenceTo()` returns the list of `SObjectType`s a reference field can point to. A normal
single-target lookup returns exactly one element; a polymorphic field (`WhatId`, `OwnerId`,
`RelatedRecordId` on junction/system objects like `SkillRequirement`, `RecordAction`) returns more
than one.

**How to apply:** Before writing any Apex code that classifies a lookup field as polymorphic vs.
single-target, use `getReferenceTo().size() > 1` — never assume an `isPolymorphic*()`-named method
exists on `DescribeFieldResult` without verifying it compiles first.
