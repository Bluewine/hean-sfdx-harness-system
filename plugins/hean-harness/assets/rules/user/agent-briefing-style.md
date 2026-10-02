---
name: agent-briefing-style
description: Conventions for briefing agents — goal, identified targets and context; no commands or flags that override an agent's own protocol
---

# Agent Briefing Style

Apply every time an agent is spawned via the Agent tool.

## Core Rule

Provide the goal and the targets already identified. Leave the method to the agent.

An agent with an `<Investigation_Protocol>` or `<Scope_Determination>` section runs its own commands and
checks. A command or flag in the brief overrides that protocol and produces wrong results, for example a
test-runner invocation that skips the agent's own coverage setup.

## What to Include

- **Goal:** the expected outcome (e.g. "reach 100% of every whole file in scope", "deploy changed metadata").
- **Identified targets:** files, components, classes or directories already identified — named by the
  user, found by earlier work in the session, or listed in an approved plan. Pass each by path, or by name when the agent's scope input takes
  names (for example Apex class names).
- **Context the agent cannot discover:** error messages, constraints the user stated, prior decisions.
- **Prohibitions and required values:** a command named only to forbid it ("never run `git checkout`,
  `git restore` or `git stash`") and a value a rule requires the agent to use, such as the target org
  alias written as text, are context. Keep them.
- **Reporting format:** only when the agent's `<Output_Format>` must be overridden.

## What to Omit

- **No shell commands:** never write `npx jest ...`, `sf project retrieve ...`, `git diff ...` or any other
  command. The agent selects its own commands.
- **No flags or options:** never pass CLI flags such as `--coverage` or `--coverageReporters`. The agent
  builds its own invocation.
- **No guessed scope:** when no target has been identified yet, pass none and let the agent run its own
  scope detection. Never name a file only because it looks related.

## Violation Check

Before submitting any agent prompt, scan it for shell commands and CLI flags the agent is told to run and
remove them; keep a command named only to forbid it. Keep a file path only when it names a target
identified by the user, by earlier work in the session, or by an approved plan, or a hand-off file the
session wrote for the agent to read or write (a task brief, a report file, a diff package). An approved
plan that a rule says to pass verbatim, and a prompt template a dispatching skill supplies, are passed as
written.
