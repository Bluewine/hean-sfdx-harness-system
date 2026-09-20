---
name: Never run agents in the background
description: All agent invocations must run in the foreground — never use run_in_background
type: feedback
originSessionId: a1ded825-0bd2-422d-98a9-790026857ff6
---
Never pass `run_in_background: true` when spawning agents via the Agent tool.

**Why:** User explicitly requires foreground execution so results are visible and actionable immediately.

**How to apply:** Always omit `run_in_background` (or set it to false) on every Agent tool call, regardless of task independence.