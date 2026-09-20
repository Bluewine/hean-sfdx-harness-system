---
name: navigation-mixin-mock-isolation
description: LWC membrane blocks getter spying and instance-level Symbol writes on the component itself, but NavigationMixin's mixin-prototype Symbol methods are plain configurable properties reachable via a direct prototype override
type: feedback
---

## LWC prototype getter spying is always blocked

`jest.spyOn(ComponentClass.prototype, 'someGetter', 'get')` throws "Property is not declared configurable" for any getter defined inside an LWC class. The LWC engine seals class prototype descriptors as non-configurable. This is not a cross-module issue — it applies to same-module getters too.

**Why:** The LWC engine processes class definitions at module-load time and marks all prototype property descriptors non-configurable as part of its membrane enforcement.

**How to apply:** When a coverage gap requires mocking a return value from a component getter, do not attempt `jest.spyOn(...prototype, 'getter', 'get')`. It will always throw. The only working approaches are: (a) drive the branch via the public API (`@api` props, wire adapter emissions, event triggers) that the getter reads from, or (b) accept the gap as genuine dead code and document why.

## NavigationMixin.GenerateUrl rejection — direct prototype override works, instance-level does not

`element[NavigationMixin.GenerateUrl] = mockRejectedFn` (instance-level) does NOT work — LWC's membrane proxy blocks external Symbol-keyed property writes from reaching `this` inside the component.

**A previous version of this memory recommended a separate file with a full `jest.mock('lightning/navigation', factory)`.** That approach is empirically unreliable: when two test files for the same component both import the SUT and one of them installs a competing `lightning/navigation` mock, the component intermittently binds to whichever file's `NavigationMixin` happened to load first in that worker — the mock then receives no calls at all, non-deterministically across runs, workers and file order. Do not use that pattern.

**The working approach:** override the Symbol-keyed method directly on the mixin's prototype, using the **default** sfdx-lwc-jest navigation stub (no competing `jest.mock('lightning/navigation')`):

```js
import { NavigationMixin } from 'lightning/navigation';
import MyComponent from 'c/myComponent';

const proto = Object.getPrototypeOf(MyComponent.prototype);
const generateUrlSpy = jest.fn().mockRejectedValue(new Error('...'));
proto[NavigationMixin.GenerateUrl] = generateUrlSpy;
```

This works because `[GenerateUrl]() {}` in the stub (`node_modules/@salesforce/sfdx-lwc-jest/src/lightning-stubs/navigation/navigation.js`) is a plain ES6 computed-property method on a **mixin** class, not an LWC-decorated getter on the component itself — its descriptor is `configurable: true` before `createElement()` runs.

**Restoring the override crashes — so don't restore it.** LWC seals the prototype during component upgrade. Any subsequent `spy.mockRestore()` or `jest.restoreAllMocks()` throws `TypeError: Cannot assign to read only property 'Symbol(GenerateUrl)'`, and that error surfaces as "Test suite failed to run" (not a per-test failure). Put this override in a **standalone test file containing exactly one test** so there is nothing else in the file that needs the original implementation back, and never call restore/clearAllMocks in a way that touches it.

**Coverage registers when the code runs, not when cleanup succeeds.** If a crash happens during teardown (e.g., a botched restore), check whether the instrumented branch was already hit before concluding the technique doesn't work — a `console.log(spy.mock.calls.length)` right after the assertion under test is enough to tell dead-cleanup-code apart from a real coverage miss.

**Timing:** don't guess tick counts with duplicate `flushPromises()` calls. Instead await the exact promise(s) the component is racing (e.g., `await Promise.allSettled(generateUrlSpy.mock.results.map(r => r.value))`), then a single `flushPromises()` for the reactive re-render. This mirrors the "await a captured resolve/reject function" pattern used for race-condition tests, and is deterministic instead of order-dependent.

**Also remember:** the branch under test (e.g., a `<nav>` breadcrumb) may itself be gated behind other component state (`hasRecordId`, `detail` truthy, etc.). Drive the component to the state where the target markup actually renders — GenerateUrl rejecting silently produces zero visible failure if the surrounding UI never mounts.

**How to apply:** When a coverage gap depends on a NavigationMixin method rejecting/throwing, override `Object.getPrototypeOf(ComponentClass.prototype)[NavigationMixin.GenerateUrl]` directly in a single-test sibling file (e.g.), using the default navigation stub — do not add a competing `jest.mock('lightning/navigation')`.
