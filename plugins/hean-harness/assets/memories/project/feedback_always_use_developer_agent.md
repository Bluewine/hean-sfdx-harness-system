---
name: Always use developer agent for any Salesforce metadata change
description: Never edit files under force-app/ directly — always delegate to the developer agent, no exceptions
type: feedback
originSessionId: 6653ba64-6eef-4af5-82b0-57fd3239c366
---
Always delegate to the `developer` subagent when editing any file under `force-app/` (Apex, LWC, Flow, config, or any other Salesforce metadata). No exceptions for "small" or "obvious" changes.

**Why:** Rationalizing around the rule because a change looks trivial is not acceptable. The developer agent reads rule files first, explores patterns, and verifies with tests — skipping it to save a round-trip undermines the process.

**How to apply:** Any time a tool call would touch a file under `force-app/`, use `Agent` with `subagent_type: developer` instead of editing directly. This applies to all Salesforce metadata: Apex classes, LWC (.js, .html, .css, tests), Flows, custom metadata, permission sets, and any other project file.