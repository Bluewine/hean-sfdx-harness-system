---
name: auraenabled-apex-type-param-arrives-null
description: An @AuraEnabled method parameter typed as an Apex-defined wrapper can arrive with every field null while JSON.deserialize of the identical payload populates it correctly
metadata:
  type: reference
---

An `@AuraEnabled` method whose parameter is an Apex-defined class can receive an instance with
every field null, even when the browser's outgoing request payload is correct. The platform's
inbound binding of a request body onto an Apex-defined parameter type is a separate mechanism
from `JSON.deserialize`, and when it fails to map the body it yields an all-null instance rather
than an error — so the only symptom is the method's own validation complaining about data the
client demonstrably sent.

**Why:** the failure is silent and points debugging in the wrong direction. Nothing throws, the
request payload is correct, and `JSON.deserialize` of that same payload into the same wrapper
populates it fully — so the evidence all says the client is fine while the method insists the
data is missing.

**How to apply:** When an `@AuraEnabled` method's wrapper parameter arrives empty, do not retype
the wrapper's fields or guess at the coercion rules. Change the parameter to `String`, have the
component send `JSON.stringify(payload)`, and deserialize explicitly in the controller before
delegating. Keep the wrapper's field names and types untouched — they are what deserializes
correctly. Guard blank and unparseable bodies with their own user-facing message, and run the
parse *outside* the existing `catch (Exception e) { throw new AuraHandledException(...) }` so a
clear message is not re-wrapped. See [[apex-tests-cannot-run-without-deploy]] for how to verify
such a change.
