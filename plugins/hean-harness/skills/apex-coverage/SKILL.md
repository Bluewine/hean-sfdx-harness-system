---
name: apex-coverage
description: Apex line-coverage report for the saved deploy target — runs the [test] classes listed in .claude/inputs/apex-classes.txt and prints the uncovered lines of every [tested] class, with an exit code for all at 100%, a class below 100%, or a failed test
when_to_use: The user asks to check Apex coverage, see which lines are uncovered, or run the coverage script for a list of classes — "check Apex coverage", "which lines are uncovered", "run the coverage script", "is ScheduleService at 100%". It reads .claude/inputs/apex-classes.txt and needs a deploy target saved with `/hean-harness:org-roles`. It does not deploy, so deploy the classes first. The apex-tester agent runs it after writing the input file. Invoke the skill directly without reading its files; it takes no arguments and runs its script with a 10-minute Bash timeout.
allowed-tools: Bash(node *apex-coverage.mjs*)
---

# Apex Coverage

## Run

1. From the repository root, run `node "${CLAUDE_SKILL_DIR}/scripts/apex-coverage.mjs"; echo "Exit code: $?"` once with the Bash tool and a timeout of 600000 ms. The script waits for `sf apex run test`, which can take longer than the default 2-minute timeout.
2. When the Bash tool moves the command to the background, wait for it to finish. When it times out, report that the run did not finish and stop. Never guess a result.

The output ends with the script's exit code on an `Exit code: N` line.

## Reply

When an agent such as `apex-tester` runs this skill, the agent takes the output and the `Exit code:` line back to its own protocol; the table below and its limits do not apply to it.

When the user invoked the skill directly, reply according to the `RESULT:` line and the `Exit code:` line, without calling the advisor, spawning subagents, reading files, or running git or sf commands.

| Output | Reply |
|---|---|
| `Exit code: 0` | One sentence saying every listed class is at 100%, then the output verbatim in a code block. |
| `Exit code: 2` | One sentence naming each class below 100%, then the output verbatim in a code block. |
| `Exit code: 3` | One sentence saying a test failed, then the output verbatim in a code block, including the `FAILED TESTS` block. |
| `Exit code: 1` and the `RESULT: ERROR — …` line says `apex-classes.txt` does not exist or has no class under `[test]` or `[tested]` | The output verbatim in a code block, then show the file format below so the user can write `.claude/inputs/apex-classes.txt`. |
| Any other `Exit code: 1` with a `RESULT: ERROR — …` line | The output verbatim in a code block, then stop. |

File format for `.claude/inputs/apex-classes.txt`, one class name per line, no path and no extension:

```
[test]
ScheduleServiceTest

[tested]
ScheduleService
```
