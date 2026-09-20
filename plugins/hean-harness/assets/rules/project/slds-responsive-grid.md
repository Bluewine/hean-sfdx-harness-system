---
paths:
  - "force-app/main/**/*.html"
  - "force-app/main/**/*.css"
---

# SLDS Responsive Grid Conventions

Apply these rules **every time** a multi-column layout is created or edited in an LWC — no exceptions.


## Rule: Use SLDS Grid Classes for Responsive Stacking, Not `@media`

Never write CSS `@media` breakpoint queries inside an LWC `.css` file to control column width or layout stacking. Use SLDS responsive size modifier classes on the grid columns instead. SLDS bakes the breakpoint logic in — no custom CSS required.


## SLDS Responsive Breakpoints (mobile-first)

| Class prefix | Kicks in at | Typical viewport |
|---|---|---|
| `slds-size_*` (no prefix) | 0px — always | Mobile / default |
| `slds-small-size_*` | 480px+ | Large phones |
| `slds-medium-size_*` | 768px+ | Tablet |
| `slds-large-size_*` | 1024px+ | Desktop |


## Pattern — 4-wide → 2-wide → 1-wide Tile Grid

```html
<!-- slds-wrap is required — without it columns never break to a new line -->
<div class="slds-grid slds-gutters slds-wrap">

    <!-- Declare column width at every breakpoint on each column -->
    <div class="slds-col slds-size_1-of-1 slds-medium-size_1-of-2 slds-large-size_1-of-4">
        <!-- tile content -->
    </div>

</div>
```

**Breakdown:**
- `slds-size_1-of-1` → full width on mobile (1 column, stacked)
- `slds-medium-size_1-of-2` → 50% at tablet (2 columns)
- `slds-large-size_1-of-4` → 25% at desktop (4 columns)

Adjust the fractions for other column counts (e.g. 3-wide desktop: `slds-large-size_1-of-3`).


## When `@media` Is Still Acceptable

`@media` is only acceptable for styling properties that have **no SLDS class equivalent** and are internal to a single component (e.g. changing `flex-direction` of a badge element based on viewport). In that case, add an inline comment explaining why SLDS classes cannot substitute.

```css
/* @media used here because SLDS size classes only govern grid column widths —
   they cannot change an element's internal flex-direction. */
@media (max-width: 1023px) {
    .my-badge {
        flex-direction: column;
    }
}
```


## Checklist

- [ ] Grid containers that need responsive stacking always have `slds-wrap`
- [ ] Column widths use the three-prefix pattern: `slds-size_*`, `slds-medium-size_*`, `slds-large-size_*`
- [ ] No `@media` queries in `.css` files for column width or layout stacking
- [ ] `@media` use (when truly unavoidable) is commented with a justification