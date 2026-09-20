---
name: no-pre-post-apex-tests
description: Apex classes staged under runbooks/pre-deploy or runbooks/post-deploy never need test classes — only force-app classes do
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 71b3e29e-a9fe-430b-b38d-1f018a734054
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

Never write a test class for an Apex class staged under `runbooks/pre-deploy/metaData/classes/` or `runbooks/post-deploy/metaData/classes/`. Only classes deployed under `force-app/` need test coverage.

**Why:** pre-deploy and post-deploy classes are transient — deployed, run once against prod, then destructively removed via the corresponding `deletePackage/*/destructiveChanges*.xml`. They never accumulate permanent org code coverage obligations the way `force-app/` classes do, so a test class for them is dead weight from day one.

**How to apply:** when a plan or task calls for a new Apex class under `runbooks/pre-deploy/` or `runbooks/post-deploy/`, verify it by deploying and invoking it directly against a connected org (anonymous Apex / `sf apex run`), not via `@isTest`. If an existing pre/post class already has a paired test class from before this was clarified (e.g. a stray test class), delete it outright when touching that class again — don't relocate or preserve it.
