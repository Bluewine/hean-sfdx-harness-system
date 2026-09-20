---
name: agent-briefing-style
description: Conventions for briefing agents — goals only, never commands or pre-supplied scope
---

# Agent Briefing Style

Apply every time an agent is spawned via the Agent tool.

## Core Rule

Provide the goal. Never provide the implementation.

An agent with an `<Investigation_Protocol>` or `<Scope_Determination>` section owns its own discovery process. Pre-supplying a command, file path, or scope overrides that process and produces wrong results.

## What to Omit from Every Agent Prompt

- **No shell commands** — never write `npx jest ...`, `sf project retrieve ...`, `git diff ...`, or any other command. The agent selects its own commands.
- **No pre-resolved scope** — never name specific files, components, or directories unless the user explicitly named them. Let the agent detect scope via its protocol.
- **No coverage commands** — never pass `--coverage`, `--coverageReporters`, or path arguments to test runners. The agent constructs the correct invocation.
- **No flags or options** — never add CLI flags that constrain what the agent runs.

## What to Include

- The goal: what outcome is expected (e.g. "reach 100% branch coverage", "deploy changed metadata", "fix failing tests")
- User-specified names: if the user named a specific component, file, or artifact, pass it verbatim
- Relevant context the agent cannot discover itself: error messages, constraint the user stated, prior decisions from this conversation
- The reporting format if the agent's `<Output_Format>` needs to be overridden

## Scope Supplied by the User vs. Inferred Scope

- User named a specific target → pass it to the agent
- User said "test lwc" or similar without naming a target → pass nothing; let the agent run its scope detection

## Violation Check

Before submitting any agent prompt, scan it for shell commands, file paths, and CLI flags. Remove every one that was not explicitly given by the user.