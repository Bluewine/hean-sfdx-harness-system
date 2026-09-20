---
name: sfcore-repo-facade-field-list-cache
description: SFCORE_RepoFactory.Facade caches one repo per SObjectType per transaction,
  locking in the first query's field list for every later call on that type
metadata:
  type: reference
---

`factory.repoFactory.getRepo(SObjectType, fields)` caches one repo instance per
`SObjectType` per transaction. The field list passed on the first (cache-miss) call for
that type sticks for every later call against the same type in the same transaction, even
if a later call passes a different, larger field list — the extra fields are silently
dropped, not added.

**How to apply:** Before adding a second method that queries the same `SObjectType`
elsewhere in the same class, check whether an existing method already queries that type. If
so, consolidate into one shared query method that fetches the full field superset every
caller needs, and have every caller derive its own subset from that one result — don't let
two methods each build their own field list for the same type. This pattern surfaces
whenever two methods on the same class independently need overlapping-but-different fields
from one Custom Metadata Type or SObject in the course of a single transaction.
