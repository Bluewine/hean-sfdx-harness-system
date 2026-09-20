---
name: virtual-module-mock-esmodule-flag
description: Four LWC Jest mocking traps — __esModule:true on default-export virtual mocks, modal-header stubs render no text, registerRefreshHandler returns synchronously, and manual-DOM innerHTML picks up scoping tokens
type: feedback
---

## Symptom

`jest.mock('lightning/modal', () => ({ default: SomeClass }), { virtual: true })` (no `__esModule` flag) causes the *component under test* to fail with `TypeError: Class extends value #<Object> is not a constructor or null` when it does `import LightningModal from 'lightning/modal'; class X extends LightningModal {}`.

**Why:** Babel's `_interopRequireDefault` helper wraps any required module lacking `__esModule: true` as `{ default: <the whole object> }` before extracting `.default`. Without the flag, `import LightningModal from '...'` resolves to the entire mock object (`{ default: SomeClass, ... }`), not `SomeClass` itself.

**How to apply:** Any virtual `jest.mock` factory whose consumer uses a **default import** (a `lightning/*` JS-module mock like `lightning/modal`, or a sibling `c/xxx` component mocked for its static API surface) must include `__esModule: true` in the returned object:
```js
jest.mock('lightning/modal', () => {
    const { LightningElement } = require('lwc');
    return { __esModule: true, default: class LightningModal extends LightningElement {} };
}, { virtual: true });
```
Named-export-only mocks (`lightning/refresh`, `lightning/platformWorkspaceApi`, `@salesforce/apex`) do **not** need the flag — named imports don't go through `_interopRequireDefault`.

Curiously, the pre-existing `@salesforce/apex/Xxx.getXxx` wire-adapter mock pattern in this repo (`return { default: createApexTestWireAdapter(jest.fn()) }`) works fine *without* `__esModule: true` — Apex-namespaced imports appear to go through a different resolution path in `@lwc/jest-transformer` than component-namespaced (`c/*`) or `lightning/*` JS-module default imports. Don't assume the apex pattern generalizes to other default-export virtual mocks.

## Related: modal header/body/footer stubs render no text

`@salesforce/sfdx-lwc-jest`'s built-in `lightning-modal-header` stub has an **empty** `<template></template>` — it does not render `{label}` into any DOM text. Assert on the **property**, not text content: `element.shadowRoot.querySelector('lightning-modal-header').label`.

## Related: registerRefreshHandler return type (confirmed empirically)

`registerRefreshHandler(contextElement, providerMethod)` from `lightning/refresh` returns a **synchronous numeric handle**, not a Promise. Confirmed via the official Salesforce LWC developer guide (reference-lightning-refreshview-registerrefreshhandler.html). Mock it as `jest.fn(() => someNumber)`, not `jest.fn(() => Promise.resolve(someNumber))`. The `providerMethod` callback itself must still return `Promise<Boolean>`.

## Related: manual-DOM (`lwc:dom="manual"`) innerHTML assertions

LWC's synthetic-shadow polyfill stamps `lwc-xxxxx=""` scoping-token attributes onto markup injected via `container.innerHTML = rawHtml`, even for manually-managed containers. Don't assert `container.innerHTML === rawHtmlConstant` (exact string match) — it will fail on the injected tokens. Assert on structure/content instead: `container.querySelector('strong').textContent`, `container.textContent`, or `container.querySelector('p')).not.toBeNull()`.
