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

2. Show that output to the user and ask whether to go ahead. Wait for an answer. When the output
   has a line starting `!! KEPT`, quote each one in the question and ask about each separately:
   - an existing `.githooks/commit-msg` that git does not track: keep it, or replace it with the
     plugin's copy (`--replace-githook`, a backup is kept). A hooks folder git tracks belongs to
     the repository; setup never changes it, so do not ask about it.
   - an existing `.mcp.json`: keep it unchanged, or add the Linear server to it (`--edit-mcp`)

   Keeping is the default. Never pass either flag without the user choosing it.

   When the output has a line starting `!! ASK — COMMIT FORMAT NOT CHOSEN`, ask whether to
   enforce the `@WORK-ID: Summary` commit subject format in this repository: `on` refuses a
   commit without a work item reference and installs the commit-msg hook; `off` enforces
   nothing. Ask only then. A saved answer is reused, and `/hean-harness:commit-format` changes it
   later.

3. When the user agrees, run it, adding only the flags the user chose:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" [--replace-githook] [--edit-mcp] [--commit-format on|off]
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
   - whether the commit format is on or off, and whether the commit format step added, replaced
     or removed `.githooks/commit-msg` and set `core.hooksPath` to `.githooks`, or found them
     already in place. Repeat every `!! KEPT` line from the output under its own heading, so a
     kept hook or `.mcp.json` is not missed. When the step says `core.hooksPath` points
     elsewhere, repeat the command it printed.
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

6. The last step adds up to four lines to the repository's `.gitignore`: `.claude/*` and
   `!.claude/manifest/`, so the rules, memories and agents setup writes into the repository, and
   all skill output, are never committed, while each story's manifest in `.claude/manifest/` is;
   `.githooks/`, so the hook setup installs is never committed; and `.mcp.json`, so
   the Linear server setup adds is never committed. `.githooks/` is left out when the repository
   tracks its own hooks there. A bare `.claude/` line an earlier version wrote is replaced,
   because it hid `.claude/manifest/`; say so when the step reports it. Name each line in the
   report. When the step says a line was
   already there or not added, say so rather than implying it was written.

## Rules

- Run `setup.mjs`. Never call the individual installers, and never edit a file directly. The
  orchestrator knows every step; naming them here would let this skill fall out of step with what
  exists.
- Never say setup succeeded without showing what the script printed.
- The user has to reload the shell themselves. No script can do it for them.
- To install into a repository other than the current one, pass `--repo <path>`.
