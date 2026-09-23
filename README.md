# hean-harness

Claude Code configuration for Salesforce SFDX projects: rules, agents, commands, memories and checks.

## Install

```bash
claude plugin marketplace add https://github.com/Bluewine/hean-sfdx-harness-system.git
claude plugin install hean-harness@hean-sfdx-harness-system
```

Open the Salesforce repository you want to configure, then run:

```
/hean-harness:setup
```

- Setup lists every change before making it and waits for your answer.
- It prints one command at the end that reloads your shell. Run it.
- Restart Claude Code after that. Rules, plugins and hooks are read when a session starts.

Check the result:

```
/hean-harness:doctor
```

## What setup leaves to you

- **A JDK 11 or newer.** Installing one needs administrator rights. Setup reports whether a real one
  is present and prints the command for your system.
- **Signing in to Linear.** Setup adds the server when none is present. Run `/mcp` in a session to
  sign in.

`/hean-harness:doctor` names anything else missing, with the command that fixes it.

## Trying it without touching your own setup

```bash
mkdir -p ~/harness-trial
CLAUDE_CONFIG_DIR=~/harness-trial/.claude claude
```

- That session starts with no skills, no agents and no plugins, and asks you to sign in.
- Your own configuration is neither read nor written.
- Authenticated orgs, git identity and SSH access still work inside it.
- Delete `~/harness-trial` when you are done.

## Reinstalling

Run `/hean-harness:setup` again.

- It clears what the previous install recorded before writing anything.
- It removes only what it recorded. Files you wrote yourself in the same folders stay.
- A file it replaced is restored from its backup.
- Its block is taken out of your `CLAUDE.md`. The rest of your file stays.

## Uninstalling

```
/hean-harness:uninstall
```

- It lists every change before reversing it.
- It takes only its own lines out of files you also own.
- Copies of anything it replaced stay in `~/.claude/hean-harness/backups/`.
- Open a new terminal afterwards. The alias is still loaded in the current one.

Three things it leaves to you, with the exact command for each:

- the `.gitignore` line it added
- anything in `.claude/skills/<skill-name>/output/`
- the superpowers plugin and the Linear server

## Requirements

- Claude Code
- Git
- Node.js — present if the `sf` command works
- A JDK 11 or newer, for Apex static analysis
- Python, for `/deprecate-flow` and `/soql-bindvar-resolver` only. `brew install python` on macOS,
  `sudo apt install python3` on Linux.

## Status

In development. The install, check and uninstall machinery works and is tested.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
