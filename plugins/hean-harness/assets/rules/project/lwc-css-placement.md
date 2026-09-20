---
paths:
  - "force-app/**/*.css"
---

# CSS Placement — Component Stylesheet First

Apply every time a style rule is added, edited, or relocated.

## Rule

Author every style rule in the owning component's own stylesheet. Relocate a rule to a site-wide stylesheet only after proving the component-scoped rule is inert at runtime.

## Preconditions For Relocation

All three must hold before a rule moves to a site-wide stylesheet:

- **Foreign target** — the element being styled is rendered by another component: a base Lightning component, framework chrome, or platform-owned DOM.
- **Proven inert** — the component-scoped rule is demonstrated not to match, not assumed not to match.
- **No hook path** — no custom property set on an element the component itself renders produces the effect.

## Verification Method

1. Read the compiled rule in `document.styleSheets` and record the scoping attribute its selector requires.
2. Read the live target element's attributes and confirm that attribute is absent.
3. Record both values in the change description.

A rule that renders no visual change is not proof on its own. Cache and publish state produce the same symptom.

## Base Component Failure Mode

A component stylesheet reaches a base Lightning component's host element. Layout and spacing rules set on the host apply normally.

A component stylesheet does not reach that base component's internal DOM. Neither `::part()` nor a descendant selector matches from a component stylesheet, while both match from a site-wide stylesheet.

Custom properties are the sanctioned route inward and inherit across the boundary, but take effect only where the base component consumes the property. `lightning-button` does not consume the brand colour properties in this portal, so painting its internal button requires a site-wide rule.

This holds for `lightning-button`, `lightning-helptext` and `lightning-icon`. Treat every base component as subject to this until verified otherwise.

## Site-Wide Stylesheet Constraints

- Scope each rule to a marker class or distinguishing ancestor. A bare element or state class matches every instance site-wide.
- Name the marker after the component that owns it, not after the effect.
- Prefix each block with the work ID and the reason the rule cannot live in component CSS.

## Prohibitions

- Never relocate a rule for convenience, or to sit alongside a related rule already in the site-wide file.
- Never relocate a rule without attempting the component-scoped version first.
- Never leave the component-scoped rule in place after relocating. Delete it.
