---
name: reference-jest-mock-keyed-by-args-not-call-order
description: When a redesign changes which user action triggers an imperative Apex call, Jest tests using positional mockResolvedValueOnce queues silently desync
metadata:
  type: reference
---

Moving *when* an LWC fires an existing imperative Apex call (e.g. from "only on
toggle-on" to "on every site/floor change") shifts every `mockResolvedValueOnce()` /
`mockImplementationOnce()` queue in every test that call feeds, because those queues
are consumed strictly in call order, not by which site/floor the call actually
carries.

**Symptom:** a test that previously asserted "call N returns X" starts receiving the
data meant for a different call, and — if the queue runs out — Jest's default mock
return (`undefined`) reaches code that assumes a resolved array, throwing into a
`catch` block instead of failing the assertion directly.

**Fix:** key the mock's return value off the actual arguments instead of call order:

```js
getVendorSubmissionAssets.mockImplementation(({ siteId, floorId }) =>
    Promise.resolve(
        siteId === SITE_C.siteId && floorId === SITE_C.floors[0].floorId
            ? mockAssetsSiteC
            : MOCK_ASSETS
    )
);
```

Reserve a single targeted `mockImplementationOnce()` (returning a promise whose
`resolve` is captured for the test to call later) only for the one call under test
that must be held open — set it up right before triggering that specific action, not
at the top of the test, so it cannot be consumed by an earlier, unrelated load.

Applies whenever a component's load-triggering point changes and existing tests use
`mockResolvedValueOnce().mockResolvedValueOnce()...` chains keyed on call order.
convention in the same component family.
