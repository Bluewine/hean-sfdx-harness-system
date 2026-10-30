---
name: apex-coverage
description: Apex line-coverage report for the saved deploy target — runs the [test] classes listed in .claude/inputs/apex-classes.txt and prints the uncovered lines of every [tested] class, with an exit code for all at 100%, a class below 100%, or a failed test
when_to_use: The user asks to check Apex coverage, see which lines are uncovered, or run the coverage script for a list of classes — "check Apex coverage", "which lines are uncovered", "run the coverage script", "is ScheduleService at 100%". It reads .claude/inputs/apex-classes.txt and needs a deploy target saved with `/hean-harness:org-roles`. It does not deploy, so deploy the classes first. The apex-tester agent runs it after writing the input file. Invoke the skill directly without reading its files; it runs its script on load and takes no arguments.
allowed-tools: Bash(node *apex-coverage.mjs*)
---

# Apex Coverage

The coverage script already ran when this skill loaded. Its complete output, ending with the script's exit code:

```!
node "${CLAUDE_SKILL_DIR}/scripts/apex-coverage.mjs"; echo "Exit code: $?"
```

## Reply

The output above is the complete result. Reply according to the `RESULT:` line and the `Exit code:` line, without calling the advisor, spawning subagents, reading files, or running git or sf commands.

| Output | Reply |
|---|---|
| `Exit code: 0` | One sentence saying every listed class is at 100%, then the output verbatim in a code block. |
| `Exit code: 2` | One sentence naming each class below 100%, then the output verbatim in a code block. |
| `Exit code: 3` | One sentence saying a test failed, then the output verbatim in a code block, including the `FAILED TESTS` block. |
| `Exit code: 1` and the `RESULT: ERROR — …` line says `apex-classes.txt` does not exist or has no class under `[test]` or `[tested]` | The output verbatim in a code block, then show the file format below so the user can write `.claude/inputs/apex-classes.txt`. |
| Any other `Exit code: 1` with a `RESULT: ERROR — …` line | The output verbatim in a code block, then stop. |
| `[shell command execution disabled by policy]` | Run `node "${CLAUDE_SKILL_DIR}/scripts/apex-coverage.mjs"; echo "Exit code: $?"` once with Bash, then reply to its output by this table. |

File format for `.claude/inputs/apex-classes.txt`, one class name per line, no path and no extension:

```
[test]
ScheduleServiceTest

[tested]
ScheduleService
```
