---
name: uninstall
description: Reverse every change setup made — restores shell startup files, removes the files it copied, and reads back the .gitignore lines it added for the user to remove themselves
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

2. Show the user that list and ask whether to go ahead with the reversal. Wait for an answer.

3. Reverse what setup did:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/manifest.mjs" revert
   ```

4. Read back the lines setup added to the repository's `.gitignore`, which uninstall does not
   remove on its own — a user may have written their own lines around them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/gitignore.mjs" lines
   ```

5. Report:
   - each entry and whether it succeeded; an entry marked `"ok": false` needs the user to act, so
     say what it was and why it failed
   - the `.gitignore` lines from step 4, naming each one, and that removing them is theirs to do
   - anything already written to `.claude/skills/<skill-name>/output/` stays where it is; those are
     the user's own reports and rendered files, not ours
   - that copies of any file setup replaced are still in `~/.claude/hean-harness/backups/`
   - that they should open a new terminal, because the alias is still loaded in this one

## Rules

- Never delete anything under `.claude/skills/<skill-name>/output/`. Those files are the user's
  own, produced by their runs.
- Never delete the backups folder. It holds copies of their own files.
- Lines a user added to a startup file after setup ran are left alone — only the marked block is
  removed.
