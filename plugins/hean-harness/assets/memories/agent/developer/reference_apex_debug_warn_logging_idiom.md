---
name: apex-debug-warn-logging-idiom
description: This codebase's "log and skip" idiom for per-item error isolation in an Apex
  loop is System.debug(LoggingLevel.WARN, ...) — no custom logger class exists — but never
  on an authoritative write path
metadata:
  type: reference
---

No `SFCORE_Log`-style logging framework or custom `Logger` class exists anywhere under
`force-app/main/`. The established idiom for "one item in a loop failed, log it and
continue" is a plain
`System.debug(LoggingLevel.WARN, '<ClassName>.<methodName> skipping <item> after failure: '
+ e.getMessage());` call inside the `catch` block, then `continue`.

This idiom applies only to a display-only or per-item-optional computation. It must never
be applied to a method whose output is the sole, authoritative input to a later DML or
election step — skip-and-continue there lets that later step run on silently undercounted
or incomplete data, with the failure never surfaced to whoever triggered the operation. A
method in that position should let the exception propagate uncaught, so its caller's own
error boundary can convert it into a user-visible failure before any DML runs.

**How to apply:** Before adding any new logging call for error isolation, grep for
`System.debug(LoggingLevel` and any `Logger`/`*Log*` class first to confirm this idiom is
still the only one in use — don't invent a new logging abstraction for a single-use
skip-and-continue case. But first classify the calling path: only apply skip-and-continue
to a display-only or per-item-optional computation. If the method is a required input to a
subsequent DML/election step, let the exception propagate instead.
