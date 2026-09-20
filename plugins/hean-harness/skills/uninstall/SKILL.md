---
name: uninstall
description: Reverse every change setup made — restores shell startup files, removes files it copied, and asks whether to keep or delete the answers this project recorded
allowed-tools: ["Bash", "Read"]
---

# Uninstall

Undo what setup did. Show the user the list before reversing anything, and ask them about the one
thing that is theirs rather than ours.

## Steps

1. Show what would be reversed, without reversing it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/manifest.mjs" revert --dry-run true
   ```

2. Show what this project recorded, which uninstall does **not** touch on its own:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" describe
   ```

3. Show the user both lists and ask two things:

   - Go ahead with the reversal?
   - When anything was recorded in step 2, ask whether to **keep** or **delete** it. Put the
     choice plainly:
     - **Keep** — the answers stay in the repository. Installing again later picks them straight
       back up. One small file remains in `.claude/`.
     - **Delete** — the answers go. Installing again later asks the questions from scratch, and
       nothing is enforced until someone answers them again.

   Neither is safer than the other. Do not recommend one.

4. Reverse what setup did:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/manifest.mjs" revert
   ```

5. Only when the user chose delete, remove what they recorded:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" remove
   ```

6. Read back the lines setup added to the repository's `.gitignore`, which uninstall does not
   remove on its own — a user may have written their own lines around them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" ignored
   ```

7. Report:
   - each entry and whether it succeeded; an entry marked `"ok": false` needs the user to act, so
     say what it was and why it failed
   - whether their recorded answers were kept or deleted
   - the `.gitignore` lines from step 6, naming each one, and that removing them is theirs to do
   - that copies of any file setup replaced are still in `~/.claude/hean-harness/backups/`
   - that they should open a new terminal, because the alias is still loaded in this one

## Rules

- Never delete what the user recorded without asking. It is their input, not our content.
- Never delete the backups folder. It holds copies of their own files.
- Lines a user added to a startup file after setup ran are left alone — only the marked block is
  removed.
