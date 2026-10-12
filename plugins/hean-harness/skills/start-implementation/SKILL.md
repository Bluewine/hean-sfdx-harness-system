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
     the script again and do not save the preference yourself. After the answer is given, run
     step 3 (naming), then use the saved `Dev mode` as the execution method below.
   - **Exit 0** — report the saved preference in one line, run step 3 (naming), then use the
     printed `Dev mode:` line as the execution method: `Subagent-driven` runs
     `superpowers:subagent-driven-development`, `Main session` runs the plan in this session.
   - **Exit 3** — an earlier subagent-driven run in this repository still has commits to undo.
     Report the printed reason word for word and stop.

3. Step 3 runs after step 2 for every exit except 3. The execution method starts only after step 3
   finishes. In an SFDX project (a `sfdx-project.json` at the repository root), check the naming answer:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" status
   ```

   - **Exit 0:** say nothing.
   - **Exit 2:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" suggest`, then ask one
     `AskUserQuestion` call with one question per unanswered type: the suggested answer as the first
     option, "No prefix or suffix", and a typed answer. When the suggestion is `none`, offer only
     "No prefix or suffix" and a typed answer. Save each answer with
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/naming.mjs" set apex|lwc --use yes|no [--prefix X] [--suffix Y]`
     and report the `Saved` lines.
     - **`set` prints `ERROR:`:** show the reason and ask that type again. Repeat until it saves or
       the user chooses "No prefix or suffix".
     - **`status` exits 2 because `.claude/hean-harness.json` cannot be read** (`set` then prints
       the "cannot be read as JSON" error): show the error and stop the naming step without asking
       again.
   - **Exit 1 (not an SFDX project):** skip this step.

## Rules

- Never ask the two implementation questions when a preference is already saved.
- Never write the preference file directly; only the user's click or a typed
  `/hean-harness:implementation-defaults` does that.
- Never ask the naming question when `naming.mjs status` exits 0.
