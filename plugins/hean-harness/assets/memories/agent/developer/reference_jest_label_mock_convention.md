---
name: jest-label-mock-convention
description: sfdx-lwc-jest does not resolve @salesforce/label imports, so each one needs its own jest.mock line whose value is the label's own fully-qualified name
metadata:
  type: reference
---

`sfdx-lwc-jest` does not resolve `@salesforce/label/c.X` imports from a component's
`labels-meta.xml` at test time. Each label needs its own line:

```js
jest.mock('@salesforce/label/c.X', () => ({ default: 'c.X' }), { virtual: true });
```

Register them one at a time, never in a `forEach` loop — `babel-plugin-jest-hoist` forbids a
`jest.mock()` factory from closing over a loop variable declared outside it.

The mocked value is the label's own fully-qualified name, not its English or translated text. Any
assertion on rendered label text therefore expects `'c.<LABEL_NAME>'` rather than the real copy.
The exception is a label whose test depends on parsing real characters out of the string, such as
an asterisk marking a required field. Mock that one with real text, and leave a comment saying why
it differs from the others.

**How to apply:** when adding a `@salesforce/label` import to a component whose tests already
follow this, add a matching `jest.mock(...)` line in the same order as the imports, and assert
against the label's own name. Forgetting it produces a misleading failure in which `textContent`
shows the unresolved `c.<LABEL_NAME>` string.
