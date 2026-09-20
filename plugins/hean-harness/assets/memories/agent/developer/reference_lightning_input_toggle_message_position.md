---
name: lightning-input-toggle-message-position
description: lightning-input type="toggle" always stacks its Yes/No message under the switch; blank both messages and render the word yourself to put it beside the switch
metadata:
  type: reference
---

`lightning-input type="toggle"` renders its Yes/No word from `message-toggle-active` and
`message-toggle-inactive`, and always places that word **underneath** the switch, left-aligned with
it. No attribute, `variant`, or SLDS styling hook
moves it, and the word is not among the parts the component exposes for outside styling.

To put the word beside the switch, set both message attributes to the empty string
(`message-toggle-active=""`) and render the word as ordinary markup after the `<lightning-input>`,
reading the same Custom Labels from a getter. Blanking a documented attribute is declining an
optional feature, not overriding component internals — it needs no `::part()` and no shadow-DOM
reach-in.

Jest: the sfdx-lwc-jest stub exposes `messageToggleActive` / `messageToggleInactive` as `@api`, so
assert both are `''`. Whether the emptied on/off spans collapse to zero height is not observable in
jsdom — jsdom applies no cascade — so that part needs a live check after deploy.

Related: [[experience-cloud-icon-color-reset]] for the other case where a base component's
documented styling mechanism does not behave as documented inside an Experience Cloud site.
