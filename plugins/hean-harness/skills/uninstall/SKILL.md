---
name: uninstall
description: Reverse every change setup made — strips only the marked alias block from the shell startup file, removes copied rules and memories, empties the repository's .claude folder except its manifests and tracked files, deletes .mcp.json, uninstalls the plugins setup added and then hean-harness itself
allowed-tools: ["Bash", "Read"]
---

# Uninstall

Undo what setup did. Show the user the list before reversing anything, and say afterwards what was
left in place because it is theirs rather than ours.

## Steps

1. Show what would be reversed, without reversing it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/manifest.mjs" revert --dry-run true
   ```

2. Show the user that list and ask whether to go ahead. Wait for an answer. The question names:
   - each `marker-block` entry whose target is a shell startup file (`.zshrc`, `.bashrc`,
     `.bash_profile`, `.profile`): the file, its `lines` value, and its `preview` text quoted in
     full. Say that only those lines and the one blank line above them are removed, and that the
     file is copied to `~/.claude/hean-harness/backups/` first.
   - each `repo-folder` entry: everything in the `.claude` folder is deleted, including skill
     output such as rendered pull request bodies and reports, except `.claude/manifest/` and any
     file git tracks
   - each `repo-file` entry: the repository's `.mcp.json` is deleted
   - each entry whose `action` starts with `run:`: the plugin or marketplace it removes
   - that hean-harness itself is uninstalled last, which removes its skills, agents and hooks

   A startup-file entry marked `"ok": false` in the dry run is left untouched by the reversal.
   Quote its `note` in the question.

3. Reverse what setup did:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/manifest.mjs" revert
   ```

4. Check each shell startup file the reversal edited. Its result carries a `backup` path. Compare
   the backup with the file:

   ```bash
   diff "<backup>" "<startup file>"
   ```

   Every line of the diff must be a deletion (`<`), and the deleted lines must be the `preview`
   from step 1 plus at most one blank line. When the diff shows anything else, copy the backup
   back over the startup file with `cp`, and report both paths and the diff.

5. Read back the lines setup added to the repository's `.gitignore`, which uninstall does not
   remove on its own — a user may have written their own lines around them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/gitignore.mjs" lines
   ```

6. Uninstall hean-harness itself. This runs last, because the scripts above live inside the
   plugin:

   ```bash
   claude plugin uninstall hean-harness@hean-sfdx-harness-system
   ```

7. Report:
   - each entry and whether it succeeded; an entry marked `"ok": false` needs the user to act, so
     say what it was and why it failed
   - each shell startup file edited, the result of the step 4 check, and its backup path
   - each `repo-folder` and `repo-file` entry, naming what was deleted and what its `note` says
     was kept; a `.mcp.json` that git tracks is kept, so say so and name it
   - each `run:` entry and whether the plugin or marketplace was removed
   - each remaining `external` entry with action `manual`, giving its `note`, which is the exact
     command that undoes it
   - the `.gitignore` lines from step 5, naming each one, and that removing them is theirs to do
   - that the `hean-sfdx-harness-system` marketplace stays configured, because the user added it
     before setup ran, and that `claude plugin marketplace remove hean-sfdx-harness-system`
     removes it
   - that copies of any file setup replaced or edited are still in
     `~/.claude/hean-harness/backups/`
   - that they should open a new terminal and restart Claude Code, because the alias and the
     plugin are still loaded in this session

## Rules

- Edit a shell startup file only through the reversal in step 3. Never edit one with `sed`, an
  editor tool, or a rewrite of the whole file.
- Lines a user added to a startup file after setup ran are left alone — only the marked block is
  removed, wherever it sits in the file.
- The repository's `.claude` folder is emptied except `.claude/manifest/`, where each story's
  deploy manifest is committed for the team, and any file git tracks. Everything else in it is
  written by setup or the skills on each clone.
- Never delete the backups folder. It holds copies of their own files.
