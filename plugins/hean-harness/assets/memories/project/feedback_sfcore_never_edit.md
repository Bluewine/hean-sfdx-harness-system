---
name: SFCORE classes must never be edited
description: SFCORE_* Apex classes are a third-party framework — editing them is strictly forbidden
type: feedback
originSessionId: 90f107b0-7006-4327-8b11-418822a34d11
---
Never edit any `SFCORE_*` Apex class, regardless of reason. These are a third-party framework owned outside this project.

**Why:** User made this explicit and emphatic ("MUST NEVER BE EDITED, NEVER") — any workaround that requires modifying SFCORE source is off the table.

**How to apply:** If a design requires changing a SFCORE class to work, reject that approach entirely and find an alternative that works within the existing SFCORE API surface. Treat SFCORE classes as read-only artifacts, like a managed package.