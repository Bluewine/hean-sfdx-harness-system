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

## Commit format

Setup asks once per repository whether to enforce the `@WORK-ID: Summary` commit subject format.

- `on` refuses a commit without a work item reference, in Claude Code and through a `commit-msg`
  hook for commits typed in a terminal.
- `off` enforces nothing. A repository where setup never ran is never checked.
- Switch it later with `/hean-harness:commit-format on` or `/hean-harness:commit-format off`. The
  next commit follows the new state, with no restart.

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

## Updating

```bash
claude plugin marketplace update hean-sfdx-harness-system
claude plugin update hean-harness@hean-sfdx-harness-system
```

1. Restart Claude Code. The updated plugin loads when a session starts.
2. Open the repository and run `/hean-harness:setup`. Setup copies the rules, memories and alias
   into place, so a plugin update alone does not change them.
3. Reload your shell with the command setup prints, then restart Claude Code again.

## Reinstalling

Run `/hean-harness:setup` again.

- It removes the rules and memories the previous install copied, then writes the current ones.
  Files you wrote yourself in the same folders stay.
- A file it replaced is restored from its backup.
- Its blocks in your shell startup file and `CLAUDE.md` are replaced where they sit. The rest of
  each file stays as it is.
- An existing `.githooks/commit-msg` or `.mcp.json` in the repository is kept, and setup says so
  in a `!! KEPT` line. Setup asks whether to replace an untracked hook (`--replace-githook`) or add
  the Linear server to `.mcp.json` (`--edit-mcp`).
- A repository that tracks its own hooks in `.githooks/` keeps them: setup installs no hook there,
  leaves `core.hooksPath` alone, does not add `.githooks/` to `.gitignore`, and uninstall never
  deletes a file git tracks.

## Uninstalling

```
/hean-harness:uninstall
```

- It lists every change before reversing it.
- It takes only its own lines out of files you also own, including the alias block in your shell
  startup file, wherever that block sits.
- It empties the repository's `.claude` folder and deletes `.mcp.json`. `.claude/manifest/` and any
  file git tracks are kept.
- It uninstalls superpowers and its marketplace when setup added them, then hean-harness itself.
- Copies of anything it replaced or edited stay in `~/.claude/hean-harness/backups/`.
- Open a new terminal afterwards. The alias is still loaded in the current one.

It leaves the `.gitignore` lines it added to you, and prints them.

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
