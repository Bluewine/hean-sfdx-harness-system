---
paths:
  - "force-app/main/**/*.html"
  - "force-app/main/**/*.css"
---

# WES Design System Conventions

Apply these rules every time an LWC component is created, modified, tested, refactored, edited, fixed, to always follows the WES (Website Experience Subsystem) conventions — no exceptions.


## 1. `c-wes-scope` Mandatory Wrapper

WES components require a `c-wes-scope` parent wrapper or typography, grid, and styling hooks are silently disabled for all descendants. A single missing `c-wes-scope` produces visually unstyled output with no console error.

Every LWC that renders `c-wes-*` components must wrap all WES output in `<c-wes-scope>` at the layout root.

```html
<template>
    <c-wes-scope>
        <!-- all WES components and custom markup go here -->
        <c-my-feature></c-my-feature>
    </c-wes-scope>
</template>
```

### Checklist

- [ ] Every LWC rendering `c-wes-*` components has `<c-wes-scope>` as the outermost wrapper
- [ ] `<c-wes-scope>` wraps the entire layout root — not individual inner elements


## 2. WES Component Reference

All WES components use the `c-wes-*` prefix in LWC (e.g., `wes-button` in Storybook → `c-wes-button` in LWC).

**Package install:** `sf package install --wait 10 --publish-wait 10 --package 04t7y0000009lkTAAQ -r -o targetorg`
**Storybook reference:** https://frontdesk-storybook-184b4c08c4be.herokuapp.com (Storybook markup is verbatim — just prepend `c-`)

| Storybook name | LWC element | Key attributes / slots |
|---|---|---|
| Badge | `<c-wes-badge>` | |
| Button | `<c-wes-button>` | `variant="primary\|secondary"`, `size="default"`, `kx-type="ripple"` |
| Button Toggle | `<c-wes-button-toggle>` | |
| Card | `<c-wes-card>` | `direction="vertical\|horizontal"`, `depth="1\|2\|3\|4"`, `media="fill"`; slots: `header`, default body |
| Chip | `<c-wes-chip>` | |
| Divider | `<c-wes-divider>` | |
| Icon | `<c-wes-icon>` | |
| Image | `<c-wes-image>` | |
| Input Checkbox | `<c-wes-input-checkbox>` | |
| Input Radio | `<c-wes-input-radio>` | |
| Select | `<c-wes-select>` | |
| Scope (required wrapper) | `<c-wes-scope>` | Enables grid, typography, and styling hooks for all children |

### Allowed `lightning-*` exceptions

Use these `lightning-*` components only when no WES equivalent exists:

- `<lightning-datatable>` — data tables
- `<lightning-tree-grid>` — tree grids
- `<lightning-spinner>` — loading spinners
- `<lightning-helptext>` — inline help tooltips

Do not use `lightning-button`, `lightning-card`, `lightning-icon`, `lightning-input`, `lightning-badge`, or any other `lightning-*` component where a `c-wes-*` equivalent exists.


## 3. Token Reference

All WES tokens use the `--wes-g-*` prefix. Tokens are available inside any component wrapped by `<c-wes-scope>`. Define them under `:host` in the component's `.css` file.

### Color tokens (`--wes-g-color-*`)

| Group | Scale | Usage |
|---|---|---|
| Neutral base | `--wes-g-color-neutral-base-1` → `base-4` | Light → dark surface |
| Neutral base contrast | `--wes-g-color-neutral-base-contrast-1` → `contrast-4` | Text on neutral surfaces — pair base-N with base-contrast-N |
| Neutral inverse | `--wes-g-color-neutral-inverse-1` → `inverse-4` | |
| Neutral inverse contrast | `--wes-g-color-neutral-inverse-contrast-1` → `contrast-4` | |
| Brand base | `--wes-g-color-brand-base-1` → `base-4` | |
| Brand base contrast | `--wes-g-color-brand-base-contrast-1` → `contrast-4` | |
| Brand inverse | `--wes-g-color-brand-inverse-1` → `inverse-4` | |
| Brand inverse contrast | `--wes-g-color-brand-inverse-contrast-1` → `contrast-4` | |

**Rule:** always pair `base-N` as background with `base-contrast-N` as foreground text.

### Font tokens (`--wes-g-font-*`)

| Token | Purpose |
|---|---|
| `--wes-g-font-family-display` | Display / heading typeface ('ITC Avant Garde' stack) |
| `--wes-g-font-family-sans` | Body / UI typeface ('Salesforce Sans' stack) |
| `--wes-g-font-family-monospace` | Code typeface (Consolas, Menlo, Monaco, Courier) |

Font sizes use a 10-step scale. Apply via `type-style` attribute on HTML elements — not CSS classes. Use `--wes-g-font-size-*` tokens only when setting `font-size` directly in CSS (e.g. on a custom element that can't use `type-style`).

| Token | Value |
|---|---|
| `--wes-g-font-size-1` | `0.75rem` |
| `--wes-g-font-size-2` | `0.875rem` |
| `--wes-g-font-size-3` | `1rem` |
| `--wes-g-font-size-4` | `1.25rem` |
| `--wes-g-font-size-5` | `1.5rem` |
| `--wes-g-font-size-6` | `2rem` |
| `--wes-g-font-size-7` | `2.5rem` |
| `--wes-g-font-size-8` | `3rem` |
| `--wes-g-font-size-9` | `3.5rem` |
| `--wes-g-font-size-10` | `5rem` |

### Shadow tokens (`--wes-g-shadow-*`)

Four depth levels. Use the token — never hardcode the value.

| Token | Value | Description |
|---|---|---|
| `--wes-g-shadow-1` | `0 0 2px 0 #18181808, 0 2px 4px 1px #18181816` | Shadow depth 1 |
| `--wes-g-shadow-2` | `0 2px 8px -2px #18181808, 0 8px 12px -2px #18181816` | Shadow depth 2 |
| `--wes-g-shadow-3` | `0 12px 24px -4px #18181808, 0 16px 32px -4px #18181816` | Shadow depth 3 |
| `--wes-g-shadow-4` | `0 24px 48px -2px #18181820` | Shadow depth 4 |

### Spacing tokens (`--wes-g-spacing-*`)

Controls intra-component spacing. Exact scale is in `@salesforce-ux/wes-styling-hooks`.

### Typography — `type-style` attribute

Set `type-style` directly on heading and text elements. Do not use `slds-text-*` classes for typography inside a WES layout.

```html
<h2 type-style="display-6">Section Title</h2>
<p type-style="body-1">Body text</p>
```

| `type-style` value | HTML element |
|---|---|
| `display-1` | `<h1>` |
| `display-2` | `<h2>` |
| `display-3` | `<h3>` |
| `display-4` | `<h4>` |
| `display-5` | `<h5>` |
| `display-6` | `<h6>` |
| `display-7` | `<h6>` |
| `display-8` | `<h6>` |
| `body-1`, `body-2`, `body-3`, `eyebrow`, `caption` | `<p>` |
| `code` (nested) | `<p type-style="code">` inside `<div type-style="body-*">` |

### Link styling hooks (`--wes-s-link-*`)

The `--wes-s-*` prefix marks shared (component-scoped) hooks — distinct from global `--wes-g-*` tokens. Set these on the element or a scoped selector, not on `:host`.

| Styling hook | State | Description |
|---|---|---|
| `--wes-s-link-font-decoration` | default | Text decoration for `<a>` elements |
| `--wes-s-link-font-decoration-hover` | hover | Text decoration on hover |
| `--wes-s-link-font-decoration-focus` | focus | Text decoration on focus |

All three default to `null` — the WES/browser default applies until explicitly overridden.

```css
a { text-decoration: var(--wes-s-link-font-decoration, underline); }
a:hover { text-decoration: var(--wes-s-link-font-decoration-hover, underline); }
a:focus { text-decoration: var(--wes-s-link-font-decoration-focus, underline); }
```

### Project-level tokens

These project tokens are still valid — map them to WES variables in `:host`:

| Token | Value |
|---|---|
| `--app-border-color` | #d8dde6 |
| `--app-header-background` | #f6f8fb |
| `--app-panel-text` | #16325c |
| `--app-muted-text` | #54698d |


## 4. No SLDS in WES Contexts

Inside any component wrapped by `<c-wes-scope>`, SLDS classes and tokens are inert.

- Do not use `slds-*` CSS utility classes
- Do not use `--slds-*` or `--slds-g-*` CSS custom properties
- Use `--wes-g-color-*`, `--wes-g-font-*`, and `--wes-g-spacing-*` tokens exclusively
- Use WES grid utilities (enabled by `c-wes-scope`) — not SLDS grid classes — for layout

### Checklist

- [ ] Zero `slds-*` classes in any template or CSS file that targets a WES layout
- [ ] Zero `--slds-*` token references in component CSS
- [ ] Typography set via `type-style` attribute — not `slds-text-*` classes


## 5. Conditional Rendering on WES Slots

Applying `lwc:if`/`lwc:else` on or around WES components that have slotted children does not re-render correctly after the condition toggles. Use attribute-driven reactivity (`variant={prop}`) instead of slot-level conditionals.

```html
<!-- OK: attribute-driven -->
<c-wes-button variant={buttonVariant} onclick={changeButton}>Button</c-wes-button>

<!-- NOT OK: conditional slot content on WES components -->
<template lwc:if={show}><c-wes-card><div slot="header">...</div></c-wes-card></template>
```

### Checklist

- [ ] No `lwc:if`/`lwc:else` applied directly on WES components that use named slots
- [ ] WES component state changes driven by attribute binding, not conditional rendering


## 6. `c/wesScope` Jest Mock

Any component that renders `<c-wes-scope>` requires a stub registered in `jest.config.js` — otherwise Jest fails with `Cannot find module 'c/wesScope'`.

**Stub HTML** — `force-app/test/jest-mocks/c/wesScope/wesScope.html`:
```html
<template><slot></slot></template>
```

**Stub JS** — `force-app/test/jest-mocks/c/wesScope/wesScope.js`:
```js
import { LightningElement, api } from 'lwc';
export default class WesScope extends LightningElement {}
```

**jest.config.js** — add to `moduleNameMapper`:
```js
"^c/wesScope$": "<rootDir>/force-app/test/jest-mocks/c/wesScope/wesScope"
```

### Checklist

- [ ] `force-app/test/jest-mocks/c/wesScope/` directory contains both stub files
- [ ] `jest.config.js` `moduleNameMapper` includes the `c/wesScope` entry
- [ ] Stub files exist before the first Jest run on any component that wraps WES


## 7. Figma Assets

Figma MCP asset URLs (`figma.com/api/mcp/asset/...`) expire in 7 days and break in production.

- Download every Figma MCP asset to `staticresources/` before referencing it in any template
- Reference downloaded assets via `@salesforce/resourceUrl` — never embed expiring Figma URLs directly
- Verify no `figma.com` URLs remain in any committed HTML or JS file

### Checklist

- [ ] Zero `figma.com` URLs in template or controller files
- [ ] All Figma assets committed to `staticresources/` and referenced via `@salesforce/resourceUrl`