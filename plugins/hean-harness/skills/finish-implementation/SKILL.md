---
name: finish-implementation
description: Implementation run closer — ends the session's run and, for a subagent-driven run started with "no commits", undoes its per-task commits back to the run's first commit so every change sits uncommitted and unstaged for the user's review
allowed-tools: ["Bash", "Read"]
---

# Finish implementation

Close the implementation run recorded for this session. Run it once, after the last task and
after any final whole-branch review, because those reviews read the run's commits.

## Steps

1. Close the run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/implementation-run.mjs" finish --session ${CLAUDE_SESSION_ID}
   ```

2. When the script exits non-zero, report its output word for word and stop. It changed nothing.
3. Report:
   - whether commits were undone, and the list of undone commits;
   - every line starting with `!!`, under its own heading;
   - every file created, changed or deleted, with one line on why.
4. Stop. The user reviews the changes and asks for a commit in their own message.

## Rules

- Never run `git reset`, `git commit` or `git push` yourself in this skill.
