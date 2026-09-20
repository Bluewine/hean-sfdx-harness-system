---
name: reference_css_var_dead_when_flex_disabled
description: A var() reference does not prove a custom property is load-bearing — check for a disabled flex or grid context on the same rule before deciding it is used
type: reference
---

A `var(--token)` reference is not proof the token does anything.

When a rule's `display: flex` or `display: grid` is commented out, the properties that depend on
that context stop having an effect while still reading perfectly well. `align-items` and
`justify-content` become inert. In plain block layout a container's `height` does not move an
in-flow child either — padding does. So a custom property referenced by `height` on such a rule
can be referenced and never actually read, and deleting it changes nothing on screen.

A `var()` with no fallback resolves to the property's initial value when the custom property is
missing, which for `height` is `auto`. It fails silently rather than erroring, which is why this
is hard to spot by reading.

**How to apply:** before deciding a custom property is dead, look for a commented-out `display:`
declaration on the same rule — that is the tell. If one is there, any `height`, `width`,
`align-items` or `justify-content` referencing the property is probably a leftover rather than
the mechanism actually positioning anything. Delete the property declaration, its `var()` usage
and any comment describing the old mechanism in one edit. Never leave a `var()` pointing at a
custom property you removed.
