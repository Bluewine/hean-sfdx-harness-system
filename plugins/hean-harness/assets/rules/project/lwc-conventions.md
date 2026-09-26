---
paths:
  - "force-app/main/**/*.html"
  - "force-app/main/**/*.css"
  - "force-app/main/**/*.js"
  - "force-app/main/**/*.ts"
---

# LWC Development Conventions

Apply these rules **every time** an LWC component is created, edited, or reviewed — no exceptions.

## 1. Template Formatting

Each `<template>` directive and its children must be on their own lines, indented consistently (4 spaces). Never collapse multiple directives or elements onto a single line.

```html
<!-- Correct -->
<template if:true={showPrefix}>
    <span>{prefix}</span>
</template>
<template if:true={showBold}>
    <template if:true={showPrefix}>&nbsp;</template>
    <strong>{bold}</strong>
</template>

<!-- Wrong -->
<template if:true={showPrefix}><span>{prefix}</span></template><template if:true={showBold}><strong>{bold}</strong></template>
```

## 2. `lightning-icon` Colour and Size

### Mechanism

`lightning-icon` paints its `svg` through a single-class SLDS rule that sets `fill`. Both documented colouring mechanisms feed that one rule:

- The `--slds-c-icon-color-*` custom property chain, which the rule reads as its `fill` value.
- The `variant` attribute, which swaps the class the rule matches. Only `inverse`, `warning`, `error` and `success` are accepted; any other value (e.g. `variant="info"`) is silently ignored.

Both reach the `svg` by selector match. Any rule of higher specificity that also sets `fill` discards them.

Neither reaches the shadow root from an ancestor. A custom property set on a parent `<div>` does not propagate into `lightning-icon` reliably, and `::part()` does not match from a component stylesheet.

`color` reaches the `svg` by inheritance rather than by selector match, so specificity never applies to it. It takes effect wherever the `fill` in force resolves to `currentColor`.

### Lightning Experience

Set the colour token directly on the `lightning-icon` element via a class. This places the token on the host element the component reads when resolving its own styles.

```html
<lightning-icon class="my-icon" icon-name="utility:date_input" size="medium"></lightning-icon>
```

```css
.my-icon {
    --slds-c-icon-color-foreground-default: var(--my-accent);
}
```

### Experience Cloud Sites

An Experience Cloud site injects a reset stylesheet declaring `svg:not([fill]) { fill: currentColor; }`. That selector — one element plus one attribute — outranks the single-class SLDS rule, so every `--slds-c-icon-color-*` token and every `variant` is discarded and the icon paints in the inherited text colour. A legal variant is as ineffective there as a token.

Set `color` on the `lightning-icon` element. Declare it alongside the token, so one component colours correctly in either context and names its colour once:

```css
.my-icon {
    --slds-c-icon-color-foreground-default: var(--my-accent);
    color: var(--my-accent);
}
```

### Size

`lightning-icon` sizes its `svg` through an `slds-icon_*` class that a global SLDS stylesheet applies **inside `lightning-primitive-icon`'s own shadow root** — one boundary deeper than the rule that paints the fill. Nothing set on the host reaches it. A `--lwc-squareIcon*` custom property, an explicit `width`/`height` on the host, and a host `font-size` each leave the rendered glyph unchanged.

This is a shadow-DOM boundary, not a specificity contest, so no selector and no custom property can ever win it. Scale the host instead:

```css
.my-icon {
    display: block;
    transform: scale(0.857);
    transform-origin: center;
}
```

Derive the ratio from the glyph's **measured** size, never from what the `size` attribute nominally implies — `size="xx-small"` renders at 14px.

### Checklist

- [ ] Never use `variant="info"` or any undocumented variant value on `lightning-icon`
- [ ] Never set icon color tokens on a parent element and expect them to cascade into `lightning-icon`
- [ ] Always add a class directly to the `<lightning-icon>` element and set its colour there
- [ ] In an Experience Cloud site, always set `color` as well — a token or a variant alone paints the inherited text colour
- [ ] Never reach for `::part()` to colour a base component's internals from a component stylesheet
- [ ] Never resize a `lightning-icon` with a `--lwc-squareIcon*` property, a host `width`/`height`, or a host `font-size` — none cross the shadow boundary the size class sits behind
- [ ] Scale the host with `transform: scale()` when a design calls for a smaller glyph, deriving the ratio from a measured size

## 3. No Invalid Attributes on Base Components

Base Lightning components only accept documented attributes. Passing undocumented attribute values (e.g. `variant="info"` on `lightning-icon`) is silently ignored and will never produce the intended styling. Always verify attribute values against the SLDS component documentation before using them.

## 4. CSS Animations Instead of JS Timers

### Problem

`setTimeout`, `setInterval`, and `requestAnimationFrame` used for visual sequencing (entrance animations, staggered reveals, count-up effects) are flagged by the Salesforce code analyzer. They also require cleanup in `disconnectedCallback` and complicate Jest tests with fake timer setup.

### Solution

Use CSS `@keyframes` with `animation-delay` and `animation-fill-mode: both` to sequence all entrance and stagger effects entirely in CSS.

`animation-fill-mode: both` is the key — it applies the `from` keyframe *before* the animation starts (so the element is invisible/transformed while waiting) and holds the `to` keyframe after it ends. Without it, the element flashes at its natural style during the delay.

**CSS:**
```css
@keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}

@keyframes pop-in {
    from { opacity: 0; transform: scale(0.85); }
    to   { opacity: 1; transform: scale(1); }
}

/* Element 1 — appears immediately */
.card {
    animation: fade-in 0.3s ease-out both;
}

/* Element 2 — appears after element 1 finishes (0 + 0.3s) */
.number {
    animation: pop-in 0.4s ease-out 0.3s both;
}

/* Element 3 — appears after element 2 finishes (0.3 + 0.4 = 0.65s) */
.subtitle {
    animation: fade-in 0.3s ease-out 0.65s both;
}
```

**Delay arithmetic:** each element's delay = sum of the previous element's delay + duration.

### What this replaces

| JS approach (forbidden) | CSS equivalent |
|------------------------|----------------|
| `setTimeout(fn, 300)` to defer an entrance | `animation-delay: 0.3s` + `animation-fill-mode: both` |
| `requestAnimationFrame` loop for count-up | CSS `@keyframes` with `counter()` or accept static display value |
| `disconnectedCallback` timer cleanup | Not needed — CSS animations are browser-managed |
| `jest.useFakeTimers()` in tests | Not needed — CSS animations are inert in jsdom |

### Checklist

- [ ] Never use `setTimeout`, `setInterval`, or `requestAnimationFrame` for visual sequencing
- [ ] Use `@keyframes` + `animation-delay` to stagger entrance effects
- [ ] Always set `animation-fill-mode: both` (or the shorthand fourth value) on delayed animations
- [ ] Calculate each delay as: previous element's `delay + duration`
- [ ] Define keyframes at the top of the CSS file, before class rules

## 5. LWC Jest — Async Flushing with `flushPromises`

### Problem

After emitting from a wire adapter (`getRecord.emit(...)`, `getRelatedListRecords.emit(...)`, `getUpcomingAppointments.emit(...)`) the LWC engine needs one or more microtask ticks to re-render. A single `await Promise.resolve()` provides only one tick. When multiple wire adapters emit in the same test — or when Jest's coverage instrumentation is enabled — one tick is not enough and DOM queries immediately after the await will return `null`.

Duplicating `await Promise.resolve()` is a fragile workaround: it breaks again if a third wire adapter is added, and the number of required ticks is not self-documenting.

### Solution

Define a `flushPromises` helper in every LWC Jest test file and use it instead of bare `Promise.resolve()`:

```js
// Drains the nextTick queue then the Promise microtask queue in one await,
// ensuring all wire adapter emissions and LWC re-renders have settled.
function flushPromises() {
    return new Promise((resolve) => process.nextTick(resolve));
}
```

`process.nextTick` schedules the resolver at the end of the current event-loop iteration — after all queued microtasks (Promises) — giving LWC's rendering engine time to flush regardless of how many wire adapters emitted.

**Usage:**

```js
getRecord.emit(MOCK_SA_LDS_SCHEDULED);
getRelatedListRecords.emit(MOCK_RESOURCES_LDS);
await flushPromises(); // one call, always sufficient
const el = shadowRoot.querySelector('.my-element');
```

### Placement

Place `flushPromises` in the **Helpers** section of the test file, after mock data constants and before `afterEach`:

```js
// ─── Helpers ──────────────────────────────────────────────────────────────────

function createComponent(props = {}) { ... }

function flushPromises() {
    return new Promise((resolve) => process.nextTick(resolve));
}

afterEach(() => { ... });
```

### Checklist

- [ ] Every LWC Jest test file that uses wire adapters defines `flushPromises()`
- [ ] All `await Promise.resolve()` calls replaced with `await flushPromises()`
- [ ] Never duplicate `await Promise.resolve()` — use `flushPromises()` instead
- [ ] `flushPromises` placed in the Helpers section, not inlined per-test

## 6. LWC Jest — Wire Adapter Emission Deduplication

Emit each specific wire state change only once per LWC test file. Merge any `it()` blocks that require the same emission into a single test case.

### Why

The LWC Jest wire service uses `global.wireAdaptersRegistryHack` — a worker-level `Map` shared across test files running in the same Jest worker process. Each `it()` that calls `emit()` accumulates state in that map. When the same state transition is emitted more than once in a file, the accumulated state can corrupt the wire adapter registry for the next test file running in the same worker, causing seemingly unrelated tests to fail (typically: wires not delivering data, DOM elements not rendering).

### Pattern

```js
// ❌ Two it() blocks emitting the same state — causes cross-file contamination
it('hides the View All link when empty', async () => {
    getUpcomingAppointments.emit([]);
    await flushPromises();
    expect(el.shadowRoot.querySelector('.portal-view-all-link')).toBeNull();
});

it('shows the illustration when empty', async () => {
    getUpcomingAppointments.emit([]);
    await flushPromises();
    expect(el.shadowRoot.querySelector('.slds-illustration')).not.toBeNull();
});

// ✅ Merged into one it()
it('shows illustration and hides View All link when wire resolves with empty array', async () => {
    const el = createComponent();
    getUpcomingAppointments.emit([]);
    await flushPromises();
    expect(el.shadowRoot.querySelector('.slds-illustration')).not.toBeNull();
    expect(el.shadowRoot.querySelector('.portal-view-all-link')).toBeNull();
});
```

### Checklist

- [ ] Each distinct wire emission (adapter + value) appears in at most one `it()` per test file
- [ ] When two assertions depend on the same emit, merge them into one `it()`
- [ ] If many `it()` blocks need the same pre-condition, lift the emit into a `beforeEach` inside a nested `describe` rather than duplicating it

## 7. Case.AccountId Is Read-Only — Never Set It via `createRecord`

`Case.AccountId` cannot be written by portal/community users via `createRecord`. Attempting to set it explicitly produces `INVALID_FIELD_FOR_INSERT_UPDATE` at runtime even when the value is valid.

Salesforce derives `Case.AccountId` automatically from `Case.ContactId` — when a ContactId is present on the Case, the platform looks up the Contact's Account and populates AccountId. Do not wire `User.AccountId`, expose an `accountId` getter, or include `AccountId` in the `createRecord` fields object. Set `ContactId` and let the platform handle the rest.

### Checklist

- [ ] Never include `AccountId` in a `Case` `createRecord` fields object
- [ ] Never import `@salesforce/schema/User.AccountId` for the purpose of writing to `Case.AccountId`
- [ ] Rely on `ContactId` to drive `AccountId` derivation automatically

## 8. JSDoc Comments — LWC Controller JS Files

Apply the [Google JavaScript Style Guide's JSDoc method and function comment rules](https://google.github.io/styleguide/jsguide.html#jsdoc-method-and-function-comments) to every method and function in an LWC controller `.js` file.

### Rules

- Document every method and function with a `/** ... */` block. Never use a stacked run of `//` lines for this purpose.
- Document `@param` and `@return` types on every method, including a lifecycle hook or event handler whose signature matches a same-signature `@override`.
- Open the description with a third-person verb phrase (`Handles the click event`), never an imperative phrase (`Handle the click event`).
- Reserve the compact inline JSDoc form for a simple function that needs type documentation alone, with no description or additional tags.

### Example

```js
/**
 * Handles the row-selection change event and updates the selected-rows tracked property.
 * @param {CustomEvent} event The lightning-datatable rowselection event.
 * @return {void}
 */
handleRowSelection(event) { ... }
```

### Checklist

- [ ] Every method/function in an LWC controller JS file has a `/** ... */` block, never `//`
- [ ] `@param`/`@return` types documented on every method, including same-signature overrides
- [ ] Description opens with a third-person verb phrase, not an imperative phrase
- [ ] Inline JSDoc form used only for simple, description-free type-only functions

## 9. LWC Jest — Run Jest with `npx jest`

Run Jest as `npx jest`, never `npm run test:unit`. `test:unit` runs the `sfdx-lwc-jest` wrapper, which passes on only `--coverage`, `--updateSnapshot`, `--verbose` and `--watch` and silently drops every other option — so `npm run test:unit -- --coverage --collectCoverageFrom "<path>"` measures the whole repository instead of `<path>`, with no warning.
