---
name: apex-reserved-word-group
description: "group" cannot be used as an Apex identifier (local variable, parameter) -- reserved for SOQL GROUP BY
type: reference
---

`group` is a reserved identifier in Apex, not just a SOQL keyword. Declaring `DuplicateGroup group = ...;` (or any variable/parameter named `group`) fails deployment with `Identifier name is reserved: group` at the exact line:column of the declaration -- it is not caught by local syntax checks, only by `sf project deploy start`.

**Why:** Apex reserves SOQL keywords (`GROUP`, `GROUP BY`, and others) as identifiers everywhere in the language, not only inside a query string.

**How to apply:** Never name a local variable, parameter, or field `group`. Name such a local for the record it holds rather than for its type (see [[feedback_sdd_verification_deploy_before_test]] -- this class of error only surfaces at deploy time, reinforcing why deploy must run before trusting a test file compiles).
