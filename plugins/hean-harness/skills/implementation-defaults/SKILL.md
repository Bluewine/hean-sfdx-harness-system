---
name: implementation-defaults
description: Machine-wide implementation preference editor — shows, clears or sets the saved dev-mode and commit defaults from a typed argument, without asking the two implementation questions again
when_to_use: Typed-only command. The user types `/hean-harness:implementation-defaults` to show, clear or change the saved machine-wide implementation preference — dev mode (subagent or main session) and whether tasks are committed — without answering the two implementation questions again. `disable-model-invocation` blocks model invocation; never start it from a request in words.
argument-hint: "[show | clear | commits on|off | mode subagent|main]"
disable-model-invocation: true
allowed-tools: ["Bash"]
---

# Implementation defaults

Show, clear or change the saved machine-wide implementation preference directly, without asking
the two implementation questions.

Arguments: $ARGUMENTS

## Steps

1. Map the arguments to the run script's `preference` command:

   | Arguments | Command |
   |---|---|
   | (none) or `show` | `preference show` |
   | `clear` | `preference clear` |
   | `commits on` | `preference set commits on` |
   | `commits off` | `preference set commits off` |
   | `mode subagent` | `preference set mode subagent` |
   | `mode main` | `preference set mode main` |

   Anything else: report that the argument is not recognised, show the argument hint, and stop.
   Do not run the script.

2. Run it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/implementation-run.mjs" preference <command>
   ```

3. Report what it printed.

## Rules

- Only run `preference show|clear|set`. Never edit the preference file by hand.
