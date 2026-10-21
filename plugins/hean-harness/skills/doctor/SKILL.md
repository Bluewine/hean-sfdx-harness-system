---
name: doctor
description: Report what hean-harness installed on this machine and what no longer matches — missing files, files edited since install, removed blocks, and anything the environment still needs
when_to_use: The user asks whether the `hean-harness` setup is healthy or complete, why a rule, memory, agent or the `claude` alias seems missing or out of date, or what `setup` installed and what changed since — "check my hean install", "is hean-harness set up right", "run doctor", "why are the rules not loading". Read-only; it changes nothing.
allowed-tools: ["Bash", "Read"]
---

# Doctor

Report the state of the installation. Change nothing.

## Steps

1. Run it:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/doctor.mjs"
   ```

2. Report what it printed. Explain each item that needs attention, in these terms:

   - **missing** — recorded as installed, but the file is gone. Running setup again puts it back.
   - **changed** — the file is there but differs from the copy this plugin ships. This is not
     always a fault; someone may have edited it deliberately. Running setup again overwrites it
     with the shipped copy, and the edited version is saved to the backups folder first.
   - **absent** — a block was added to a file and is no longer in it. Running setup again re-adds it.
   - **MISSING** under Environment — something that has to be installed separately. The report
     prints the command.
   - **SETUP IS OUT OF DATE** under Installation — setup last ran with an older version than the
     plugin installed now, so the rules and memories on disk are the older version's. Running
     setup again refreshes them. Give the "last setup" date with it.

3. When the report ends with a command to start Claude Code with, give the user that command in
   full. It means the alias is not in place, so typing plain `claude` starts without the alias flags.
   The rules still load, because `~/.claude/CLAUDE.md` imports them. Lead with the command.

4. When everything is in order, say so plainly and stop. Do not suggest changes nobody needs.

## Rules

- Never change anything. This skill reads and reports.
- Never say the installation is healthy without showing what the script printed.
- When the report says not installed, say that and point at the setup skill. Do not run setup.
