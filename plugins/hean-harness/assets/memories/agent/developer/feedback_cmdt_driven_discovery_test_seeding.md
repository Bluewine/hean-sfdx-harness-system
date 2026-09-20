---
name: cmdt-driven-discovery-test-seeding
description: When a Custom Metadata Type drives which records exist for a method, not just
  how they're classified, a test must seed one row per record it expects to see
metadata:
  type: feedback
---

When a discovery method's list of results is rewritten to come entirely from one Custom
Metadata Type — instead of a schema-wide query narrowed by a CMDT-driven classification
step — a test that seeds a mock with only one CMDT row will cause every other object to
vanish from the result, not just from a secondary classification map. Seeding one row used
to narrow classification only; now it narrows which records the method returns at all.

**Why:** A repository mock that returns only its seeded rows for a given object type, with
no fallback to live org data once anything has been seeded for that type, forces the test
author to seed one row per object the test expects to see recognized — including any row
meant to represent a generic or catch-all case, not just the row under direct test. This is
easy to miss when converting a test from the old "two independent steps" model, where one
seeded row only affected classification and every other object still resolved from schema.

**How to apply:** When a method's core discovery logic moves from schema introspection to a
CMDT-backed list, re-audit every existing test against it and add one seeded row per object
the test still needs recognized. [[reference_sfcore_repo_facade_field_list_cache]] explains
the caching mechanism behind why two methods on the same object type must share one query;
this note is the test-authoring consequence of that same kind of CMDT-driven discovery.
