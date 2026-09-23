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
   - whether anything from a previous install was cleared, and how much. On a first install the step
     says there was nothing to clear; say that rather than implying something was removed.
   - what each step did
   - the exact command the user has to run to reload their shell
   - anything the summary says needs doing by hand
   - whether the superpowers plugin was installed. When it was, say that a restart of Claude Code
     is needed before it can be used, because a plugin's skills and hooks are read when a session
     starts. Nothing in the running session picks it up.
   - whether the git hooks step added `.githooks/commit-msg` and set `core.hooksPath` to `.githooks`,
     or found them already in place. When the step says `core.hooksPath` points elsewhere, repeat the
     command it printed.
   - whether `npm install` ran, was skipped because `node_modules` was already there or the
     repository has no `package.json`, or failed. When it failed, quote the reason the step printed.
   - whether a Linear MCP server was added, or one was already there. When one was added, say that
     it still has to be signed in to, with `/mcp` in a session, and that no script can do that part.
     When one was already there, name it and say nothing was changed.

5. When the summary says the alias was not written, the user's shell is one the installer does not
   write to. Everything else still installed. Give them both options the script printed, in this
   order: the command to start Claude Code with right now, which needs no setup, and the line to
   add to their shell startup file if they would rather type just `claude` in future. Show the
   command in full. Do not write their startup file yourself.

6. The last step adds three lines to the repository's `.gitignore`: `.claude/skills/*/output/`,
   so skill output is never committed; `.githooks/`, so the hook setup installs is never
   committed; and `.mcp.json`, so the Linear server setup adds is never committed. Name each line
   in the report. When the step says a line was already there, say so
   rather than implying it was written again.

## Rules

- Run `setup.mjs`. Never call the individual installers, and never edit a file directly. The
  orchestrator knows every step; naming them here would let this skill fall out of step with what
  exists.
- Never say setup succeeded without showing what the script printed.
- The user has to reload the shell themselves. No script can do it for them.
- To install into a repository other than the current one, pass `--repo <path>`.
