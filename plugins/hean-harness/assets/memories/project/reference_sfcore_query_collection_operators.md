---
name: SFCORE_Query collection operator behavior
description: SFCORE_Query.equals and notEquals with collections map to IN and NOT IN via Database.queryWithBinds — confirmed from source and test
type: reference
originSessionId: abd06765-f70c-4b36-b602-263b61dc9988
---
`SFCORE_Query.equals(field, collection)` generates `field = :bindVar` where bindVar is a Set/List. `Database.queryWithBinds` auto-converts this to `field IN (:collection)`.

`SFCORE_Query.notEquals(field, collection)` generates `field != :bindVar` where bindVar is a Set/List. `Database.queryWithBinds` auto-converts this to `field NOT IN (:collection)`.

Confirmed in `SFCORE_QueryTest.cls` (lines 49–51, 173) and `SFCORE_Repository.cls` which uses `Database.queryWithBinds` exclusively.

**How to apply:** When building URL-filter-to-Apex translation, map `in` → `equals(field, collection)` and `nin` → `notEquals(field, collection)` — no custom workaround needed.