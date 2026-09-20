---
name: reference-lds2-icon-button-zero-width
description: "LDS 2 gives lightning-button-icon 16px inline padding that collapses the svg to 0 width inside width-constrained hosts; zero it with the --sds-c- SPACING hooks — padding resists ::part, though ::part does reach the same button for colour"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0cb47a70-77bd-4b47-9935-4088eaf92ebe
  modified: 2026-08-03T16:54:13.475Z
---

`lightning-button-icon` renders a blank/invisible icon whenever its host has a constrained width. The platform's `[part~="button"]` rule inside the component's shadow root computes padding from `var(--sds-c-button-spacing-inline-start, var(--sds-c-button-spacing-inline, var(--sds-s-button-spacing-inline)))`. The first two are normally unset, so it falls through to `--sds-s-button-spacing-inline`, which SLDS sets to **1rem at `:where(html)`**. With a 2rem host (e.g. SLDS `.slds-modal__close`), 16+16 padding + 2px border consumes the whole border box, the content box becomes 0, and the 24px svg flex-shrinks to nothing. The `<path>` and `fill` are correct — there is simply no room to paint.

**Fix — zero the two `--sds-c-` hooks on the host:**

```css
--sds-c-button-spacing-inline-start: 0;
--sds-c-button-spacing-inline-end: 0;
```

**Two traps:**

- **`::part(button) { padding: 0 }` does NOT work** for platform-rendered chrome such as the lightning/modal close button — tested, padding stayed 16px. The styling-hook form does work. Do not copy a working `::part` rule from a neighbouring block; `::part` succeeds on *our own* `lightning-button` in our LWC's shadow root and fails on platform chrome.
- **For spacing, use the `--sds-c-` prefix, not `--slds-c-`.** The document-level `.slds-button` rule reads the `--slds-c-` chain and does not apply inside the shadow root; the rule that actually wins reads `--sds-c-`. The `--slds-c-` spelling is a silent no-op *for spacing*. This is property-dependent and inverts for colour — brand colour hooks are `--slds-c-button-brand-*`.

Platform chrome (modal close buttons) sits **outside** the LWC's shadow root, so component-scoped CSS cannot reach it — that fix belongs in the Experience Cloud site global CSS static resource. Component-internal cases (e.g. an ETA field icon) are fixed in the component's own CSS. See [[reference_lwr_site_needs_community_publish]] before verifying any static-resource change on the live site.

When auditing which stylesheet sets a token, note that a `<link>`ed static resource can be READABLE via CSSOM yet contribute **0 rules** — wrap `cssRules` access so unreadable sheets are reported, not silently skipped, or the audit will look complete when it isn't.
