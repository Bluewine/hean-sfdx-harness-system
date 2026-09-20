---
name: sfcore-repofactorymock-filter-blindness
description: SFCORE_RepoFactoryMock.get() ignores SOQL filters and returns every seeded row
  for the SObjectType; test data design must account for this
metadata:
  type: reference
---

`SFCORE_RepoFactoryMock`'s mocked repo `.get(List<SFCORE_Query>)` / `.get(SFCORE_Query)` does
not actually apply the filter conditions passed to it — it returns every row seeded into
`SFCORE_RepoFactoryMock.QueryResults` for that SObjectType, regardless of what the query asked
for. Only `.getAll()` naturally returns everything, so this is easy to miss: a query meant to
narrow to a Set<Id> or a status value instead comes back with the full seeded set.

**Consequence for test design:** When a test that counts or elects among rows of one
SObjectType seeds multiple rows of that type across several call sites — one row meant for
a "winner" scenario and another meant for an unrelated "blocked"/"skip" scenario in the same
test — every one of those rows is counted by every query against that SObjectType in the same
test, including a vote-count or grouping query the test isn't directly exercising. A tie or
wrong winner can result purely from rows that were only meant to set up an unrelated code
path. Give the intended winner a clearly larger row count than any unrelated seeded rows of
the same type, so the outcome can't be accidentally flipped or tied.

**When a SObjectType has nothing seeded in `QueryResults`:** the mock falls through to a real
repo/query against the org, which does filter correctly. A test that references a real object
with no seeded mock data can safely leave it unseeded — a real query against synthetic
test-generated Ids correctly returns zero rows rather than accidentally including data through
the mock's filter-blindness.

See also [[feedback_cmdt_driven_discovery_test_seeding]].
