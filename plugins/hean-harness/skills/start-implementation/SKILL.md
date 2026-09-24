---
name: start-implementation
description: Implementation run starter — runs the saved machine-wide preference before the first change, asks the two implementation questions only when none is saved, and reports the dev mode as the execution method to use
allowed-tools: ["Bash", "AskUserQuestion"]
---

# Start implementation

Run this once, before the first change of any implementation, with or without a plan. It replaces
the execution-method question at the end of a plan.

## Steps

1. Run it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/implementation-run.mjs" start --session ${CLAUDE_SESSION_ID}
   ```

2. Its exit code decides what happens next:

   - **Exit 2** — no preference is saved on this machine. Ask the two implementation questions
     exactly as `~/.claude/rules/implementation-commits.md` defines them, in one `AskUserQuestion`
     call. The hook that fires on the answer saves the preference and starts the run. Do not run
     the script again and do not save the preference yourself.
   - **Exit 0** — report the saved preference in one line, then use the printed `Dev mode:` line
     as the execution method: `Subagent-driven` runs `superpowers:subagent-driven-development`,
     `Main session` runs the plan in this session.
   - **Exit 3** — an earlier subagent-driven run in this repository still has commits to undo.
     Report the printed reason word for word and stop.

## Rules

- Never ask the two implementation questions when a preference is already saved.
- Never write the preference file directly; only the user's click or a typed
  `/hean-harness:implementation-defaults` does that.
