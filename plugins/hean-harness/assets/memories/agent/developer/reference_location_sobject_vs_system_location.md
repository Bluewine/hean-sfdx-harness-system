---
name: location-sobject-vs-system-location
description: Bare `Location` in Apex resolves to the built-in System.Location geolocation type, not the standard Field Service Location SObject
metadata:
  type: reference
---

Every Apex reference to the standard Field Service `Location` SObject — type declarations, casts, `.SObjectType`, static field references (`Location.Id`, etc.) — must be written as `Schema.Location`. A bare `Location` compiles, but resolves to the built-in `System.Location` geolocation type (used for compound lat/long values), not the SObject, even though the SObject exists, is deployed, and is queryable in the org.

Deploying code with bare `Location` produces compile errors naming `System.Location` explicitly (e.g. `Invalid constructor syntax, name=value pairs can only be used for SObjects: System.Location`, `Variable does not exist: SObjectType`); anonymous Apex `Type.forName('Location')` returns `System.Location` directly (`sf apex run` debug log: `TYPE: System.Location`, `INSTANCE: System.Location[getLatitude=null;getLongitude=null;]`).

**Why:** platform-level naming collision between the System type and the SObject's bare API name, not an org misconfiguration — it will resurface anywhere `Location` is written unqualified.

**How to apply:** always write `Schema.Location` for this SObject — never bare `Location` — in new or edited `.cls` files. The same collision hits any code that resolves a target type from a name string at runtime, via `Type.forName(record.getSObjectType().getDescribe().getName())` — it raises `System.JSONException: Unrecognized field "..."` when deserializing back into the wrong type. For test fixtures needing to set fields on a `Schema.Location` record (including normally-read-only-feeling ones like `RecordTypeId`), construct via `new Schema.Location(...)` directly and set additional fields with the record's own generic `.put(fieldName, value)` accessor instead of routing through a generic field-setting helper.
