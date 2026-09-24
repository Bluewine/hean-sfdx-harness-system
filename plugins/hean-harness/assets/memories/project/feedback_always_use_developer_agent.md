---
name: Always use developer agent for any Salesforce metadata change
description: Route every force-app change to hean-harness:developer and coverage work to the tester agents, including the implementer in subagent-driven runs
type: feedback
originSessionId: 6653ba64-6eef-4af5-82b0-57fd3239c366
---
Always delegate to the `hean-harness:developer` subagent when editing any file under `force-app/` (Apex, LWC, Flow, config, or any other Salesforce metadata). No exceptions for "small" or "obvious" changes.

**Why:** Rationalizing around the rule because a change looks trivial is not acceptable. The developer agent reads rule files first, explores patterns, and verifies with tests — skipping it to save a round-trip undermines the process. A general-purpose agent carries none of these conventions, so the caller ends up restating them by hand in every prompt.

**How to apply:** Any time a tool call would touch a file under `force-app/`, use `Agent` with `subagent_type: hean-harness:developer` instead of editing directly. This applies to all Salesforce metadata: Apex classes, LWC (.js, .html, .css, tests), Flows, custom metadata, permission sets, and any other project file.

In a subagent-driven run, this routing overrides the agent type the implementer template names (`general-purpose`):

- **Implementer for a task that changes files under `force-app/`:** `hean-harness:developer`.
- **Implementer for a task that only measures Apex coverage:** `hean-harness:apex-tester`. It returns a test plan, not test classes; the test classes it plans go to `hean-harness:developer`.
- **Implementer for a task that only closes LWC Jest coverage or removes test anti-patterns:** `hean-harness:lwc-tester`.
- **Implementer for a structurally broken test:** `hean-harness:developer`.
- **Task reviewer, re-reviewer and final reviewer:** the agent type the template names.
