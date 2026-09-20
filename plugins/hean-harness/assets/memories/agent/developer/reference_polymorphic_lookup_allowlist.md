---
name: polymorphic-lookup-allowlist
description: When branching on a polymorphic lookup field's type, use an explicit
  allowlist for the types the logic applies to; never bucket everything else into
  one branch
metadata:
  type: reference
---

Many Salesforce objects carry a polymorphic lookup — one Id field that can point to
several different SObject types, paired with a Type field naming which one a given row
actually uses. Examples include `ServiceAppointment.ParentRecordId` (paired with
`ParentRecordType`, spanning `WorkOrder`, `WorkOrderLineItem`, `Asset`, `Account`, `Lead`,
`Opportunity`, and others), `Task.WhatId`/`WhoId`, and any custom polymorphic lookup
field. The polymorphism is often wider than the two or three types a given piece of
business logic actually cares about.

**How to apply:** When branching on the type field to apply logic specific to one or two
of the possible types — for example, a platform constraint that only exists for a subset
of them — use an explicit allowlist (`type == 'TypeA' || type == 'TypeB'`) and let every
other type, and a null Id, fall through to the default, unconstrained behavior. Never
write a two-way `if (type == 'TypeA') {...} else {...}` split that silently buckets every
other type into the same branch as the one type actually named in the condition: that
misclassifies every other legitimate type and can produce an incorrect skip or error for
a row the constraint never applied to. This kind of narrow, plausible-looking two-way
split on a polymorphic field is easy to write and easy to miss in review, since the code
compiles and the common-case type still behaves correctly.
