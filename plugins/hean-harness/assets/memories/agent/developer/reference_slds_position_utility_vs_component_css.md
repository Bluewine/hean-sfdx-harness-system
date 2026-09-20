---
name: reference_slds_position_utility_vs_component_css
description: Delete a conflicting slds-is-relative/slds-is-absolute class rather than trust cascade order when a component's own CSS sets a different position value on the same element
type: reference
---

An element carried `class="slds-is-relative ... portal-help-section"` while
`.portal-help-section`'s own component CSS was changed to declare `position: absolute`
directly. Both selectors are single-class (equal specificity), so which one wins depends on
LWC style-scoping and native-vs-synthetic shadow mode in the target Experience Cloud site —
neither is determinable by reading source files, and no live browser tool is available to

and functioning in this portal (not inert), so the conflict is real, not theoretical.

**How to apply:** when a component's own CSS rule sets `position` (or any property an SLDS
`slds-is-*` / similar state utility class also sets) on an element that still carries that
utility class, delete the utility class from the markup rather than relying on stylesheet
insertion order to resolve the tie. This removes the ambiguity outright instead of betting on
an unverifiable cascade outcome. Report the removal explicitly as a deliberate addition, since
it is usually not spelled out in the originating brief.
