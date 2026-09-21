---
name: setup
description: Install the hean-harness environment on this machine — copies rules, memories, agents and the status line into place, adds the claude alias, and records every change so uninstall can reverse it
allowed-tools: ["Bash", "Read"]
---

# Setup

Install the environment. Show the user what will change before changing it.

## Steps

1. Show what would change, without changing anything:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --dry-run
   ```

2. Show that output to the user and ask whether to go ahead. Wait for an answer.

3. When the user agrees, run it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs"
   ```

4. Report, using the script's own summary:
   - what each step did
   - the exact command the user has to run to reload their shell
   - anything the summary says needs doing by hand

5. When the summary says the alias was not written, the user's shell is one the installer does not
   write to. Everything else still installed. Give them both options the script printed, in this
   order: the command to start Claude Code with right now, which needs no setup, and the line to
   add to their shell startup file if they would rather type just `claude` in future. Show the
   command in full. Do not write their startup file yourself.

6. The last step adds one line to the repository's `.gitignore` so that skill output —
   `.claude/skills/<skill-name>/output/` — is never committed. Name the line in the report. When
   the step says the line was already there, say so rather than implying it was written again.

## Rules

- Run `setup.mjs`. Never call the individual installers, and never edit a file directly. The
  orchestrator knows every step; naming them here would let this skill fall out of step with what
  exists.
- Never say setup succeeded without showing what the script printed.
- The user has to reload the shell themselves. No script can do it for them.
- To install into a repository other than the current one, pass `--repo <path>`.
