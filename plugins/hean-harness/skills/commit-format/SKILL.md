---
name: commit-format
description: Switch the @WORK-ID commit subject format on or off in the current repository — updates the answer setup saved, installs or removes the commit-msg hook the plugin put there, and leaves every other installed file alone
argument-hint: "[on|off|status]"
arguments: [state]
allowed-tools: ["Bash", "Read"]
---

# Commit format

Turn enforcement of the `@WORK-ID: Summary` commit subject format on or off in this repository.
The pattern is fixed. Other skills read work IDs from commit subjects in that format.

## Steps

1. The requested state is `$state`: `on`, `off` or `status`. When it is empty or anything else,
   take it from the user's words; when those name neither `on` nor `off`, show the current state
   and ask:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-format.mjs" status
   ```

2. Show what the switch would change, without changing anything:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-format.mjs" <on|off> --dry-run
   ```

   When the output says setup has not run in this repository, report that and stop.

3. When the output has a line starting `!! KEPT` for an existing hook and the user is turning
   the format on, quote the lines and ask whether to replace that hook with the plugin's copy
   (`--replace-githook`, a backup is kept). Keeping it is the default. Wait for an answer.

4. Apply it, adding `--replace-githook` only when the user chose it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-format.mjs" <on|off> [--replace-githook]
   ```

5. Report:
   - the state before and after
   - whether the commit-msg hook was added, replaced, removed or kept, and what `core.hooksPath`
     is now
   - every `!! KEPT` line, under its own heading
   - that the next commit follows the new state, with no restart

## Rules

- Never edit the saved answer file or the hook by hand. The script records every change so
  uninstall can reverse it.
- Commits already made are not checked or rewritten.
