---
name: sfcore-stub-list-param-false-positive
description: SFCORE_Stub.Builder cannot match a List<X>-typed @AuraEnabled method parameter, and the mismatch fails silently, so a test asserting the exception wrapping passes while exercising nothing
type: feedback
---

Never use `SFCORE_Stub.Builder` (`.mockingMethodCall(name).withParameterTypes(...)`) to stub a service
method whose signature includes a `List<X>` or `Id` parameter (e.g.
`getConsumerRefCounts(String, List<Id>)`, `electGroups(List<DuplicateGroup>)`,
`getRecordsForObject(String, List<DuplicateGroup>)`). Use a direct subclass override instead — a
small `private class FooStubSvc extends ACME_XyzSvc { ... override the one method ... }` wired
through the existing `MockFactory` pattern.

**Why:** `SFCORE_MethodSignature.verifySignatureMatch` matches on method name + declared parameter
*types*, but in practice a `List<X>`/`Id` parameter type in the signature fails to match at
runtime, so the stub is never invoked and the real (unstubbed) call falls through, throwing a
generic `System.StubProvider` error. This is deceptive for a test asserting that a controller wraps exceptions:
`ACME_..._Ctrl`'s `catch (Exception e) { throw new AuraHandledException(...) }` wraps *any*
exception, including this unmatched-stub error, into an `AuraHandledException`. That means such a test, built around a broken `List<X>` stub, still **passes** — it looks green
while testing nothing. Only a test asserting the actual stubbed return value will visibly fail and reveal the mismatch.

**How to apply:** Before trusting an exception-wrapping test that used `SFCORE_Stub.Builder` with a `List<X>` or `Id` parameter, verify the sibling test asserting the returned data for the same method also passes. If either method signature includes `List<X>` or `Id`, skip
`SFCORE_Stub.Builder` entirely and use a direct override subclass from the start. A method taking
a `List<X>` parameter fails to match this way, and the failure is silent, so the cost of trying the
stub first is a test that appears to pass while exercising nothing.
