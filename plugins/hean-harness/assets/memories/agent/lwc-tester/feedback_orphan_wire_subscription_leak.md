---
name: orphan-wire-subscription-leak
description: createElement() without appendChild permanently leaks a wire adapter subscription into every later test in the same file, causing stale cross-test data to reappear
type: feedback
---

Any `createElement()` call in an LWC Jest test must be followed by `document.body.appendChild(element)` (and cleaned up via the standard `afterEach` removeChild loop) if the component has an `@wire` decorator — even for a test that only touches an `@api` property and has no other reason to mount the element.

**Why:** `@salesforce/wire-service-jest-util`'s `TestWireAdapterTemplate` adds each wire adapter instance to a class-level `_wireInstances` Set at **construction** time (inside the adapter's constructor), not at `connect()` time. LWC constructs the wire adapter instance as soon as the component is upgraded — which, empirically, can happen at `createElement()`/property-set time, before any DOM insertion. `disconnect()` (which removes the instance from `_wireInstances`) only fires via the real Custom Elements `disconnectedCallback`, which requires the element to have actually been connected and then removed. An element that is `createElement()`'d, has an `@api` property set, but is **never appended**, therefore leaves its wire subscription in `_wireInstances` for the rest of the test file's run. Every later `SomeAdapter.emit(...)` call in that file broadcasts to it too, silently invoking that orphaned instance's `@wire` callback with whatever `@api` values were set on it — which can trigger real side effects (e.g. an Apex call) using stale data from a completely unrelated, already-finished test.

**Symptom:** a later test asserts a mock was NOT called (or called N times) and instead sees an extra call whose argument matches a value set by an EARLIER test that never appended its element — even though that earlier test made no wire-related assertions itself.

**How to apply:** Always `appendChild` any `createElement()`'d instance of a component that has `@wire` decorators, even in tests that only exercise unrelated `@api` getters/setters. If a test genuinely must avoid connecting (rare), explicitly avoid touching any `@api` property that could be read by a wire callback, or accept and document the leak risk.
