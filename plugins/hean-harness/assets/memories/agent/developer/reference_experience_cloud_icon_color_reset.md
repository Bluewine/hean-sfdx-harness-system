---
name: experience-cloud-icon-color-reset
description: In the Experience Cloud site an injected reset makes svg fill currentColor, so --slds-c-icon-color-* tokens and variants are both discarded — colour lightning-icon with `color`
metadata:
  type: reference
---

In the Experience Cloud site, colour a `lightning-icon` by setting `color` on the
icon element. Neither a `--slds-c-icon-color-*` token nor a legal `variant` colours an icon here —
both are discarded. Declare the token alongside `color` so the same component also colours
correctly in Lightning Experience, where `color` alone does nothing.

**Mechanism:** the site injects a Salesforce-generated reset stylesheet (auto-generated from
`common.css`, delivered as an inline style element with no source URL) containing
`svg:not([fill]) { fill: currentColor; }`. That rule outranks the platform SLDS rule
`.slds-icon { fill: var(--slds-c-icon-color-foreground, ...) }`, so every icon in the portal paints
with the inherited text colour and the tokens never take effect. A `variant` fails the same way: it
swaps the class the same single-class rule matches, so the reset still outranks it. Setting `variant="warning"` changes the rendered class to
`slds-icon-text-warning` while the painted colour stays the inherited near-black rather than the
amber the variant implies. `color` inherits through the shadow boundary and the reset resolves `currentColor` against it.

For a component setting `--slds-c-icon-color-foreground-default: #0176D3`, the outcomes are:

- Painted colour as shipped: near-black, the inherited text colour. The blue is ignored.
- Injecting `.icon-info { color: #2E844A; }` into the component's shadow root: painted
  `rgb(46, 132, 74)`. Works.
- Injecting `.icon-info::part(icon) { fill: #B8004F; }`: stayed `rgb(26, 27, 30)`. The exported part
  is not reachable from component scope. Does not work.

**The repo rule now covers both contexts.** `.claude/rules/lwc-conventions.md` §2 prescribes the token for Lightning Experience and `color` for an Experience Cloud
site, declared together. Read §2 first; this note only carries the measurements behind it.

**How to apply:** when adding or reviewing any coloured `lightning-icon` that renders inside an
Experience Cloud site, use `color`. Existing token-based rules in that
directory that set a token alone are inert by this mechanism and render as inherited near-black
rather than their intended colours. Verify the current state of any such file before citing it — treat a
