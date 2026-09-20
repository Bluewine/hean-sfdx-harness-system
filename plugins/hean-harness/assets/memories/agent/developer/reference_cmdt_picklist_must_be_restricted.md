---
name: cmdt-picklist-must-be-restricted
description: Custom Metadata Type picklist fields must be restricted=true on this
  platform; a non-strict picklist fails deploy
metadata:
  type: reference
---

Deploying a Picklist `CustomField` on a Custom Metadata Type (`__mdt`) object with
`<restricted>false</restricted>` fails with "Non-strict picklists are not supported on
this object." The platform enforces this regardless of what a spec or brief says —
even a brief that explicitly states a restricted picklist "isn't needed" cannot make an
unrestricted one deployable on a `__mdt` object.

**How to apply:** Give any new Picklist field on a `__mdt` object `<restricted>true</restricted>`
in its `valueSet`, with no exceptions. A restricted picklist is strictly narrower than an
unrestricted one — it rejects bad values at save time instead of allowing free text — so
setting it never weakens a stated requirement. Override a brief's "no restricted picklist
needed" instruction silently, but note the deviation in whatever report accompanies the change.
