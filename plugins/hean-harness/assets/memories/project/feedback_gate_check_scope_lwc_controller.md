---
name: gate-check-scope-lwc-controller
description: "For an LWC visibility change, \"is X gated programmatically\" means the LWC JS controllers in scope — never widen the check to Apex, triggers, or org queries"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1428cdde-df86-4d98-b188-91fc12005898
  modified: 2026-09-17T14:31:55.040Z
---

For an LWC visibility change, a question of whether a feature is "gated programmatically" refers to the JavaScript controllers of the components involved, not to Apex classes, triggers, validation rules, or org metadata.

**Why:** The user stopped a read-only org query for file-object triggers and stated the backend does not need checking; only the JS controller of the LWC in hand matters for mirroring an existing UI gate.

**How to apply:** Answer from the component and parent `.js` files already in scope. Do not read Apex or run `sf data query` against any org for this kind of check unless the user explicitly asks about the backend.
