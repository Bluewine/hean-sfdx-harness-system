# hean-harness

Claude Code configuration for Salesforce SFDX projects: rules, agents, skills, memories and checks.

## Requirements

- Claude Code
- Git
- Node.js — present if the `sf` command works
- A JDK 11 or newer, for Apex static analysis
- Python, only for `/deprecate-flow` and `/soql-bindvar-resolver`

## Install

### From a terminal

1. Install the plugin:

   ```bash
   claude plugin marketplace add https://github.com/Bluewine/hean-sfdx-harness-system.git
   claude plugin install hean-harness@hean-sfdx-harness-system
   ```

2. Start Claude Code in the Salesforce repository and run setup:

   ```
   /hean-harness:setup
   ```

### From inside Claude Code

1. Install the plugin:

   ```
   /plugin marketplace add https://github.com/Bluewine/hean-sfdx-harness-system.git
   /plugin install hean-harness@hean-sfdx-harness-system
   ```

2. Exit with `/exit`, then start Claude Code again in the Salesforce repository.
3. Load the plugin, then run setup:

   ```
   /reload-plugins
   /hean-harness:setup
   ```

### After setup

Setup lists every change and asks before making it. At the end it adds a `claude` alias to your
shell's startup file and prints the command that loads it.

1. Exit Claude Code with `/exit`.
2. Reload your shell. Setup prints the exact command; typical ones:

   | System | Shell | Command |
   |---|---|---|
   | macOS | zsh (the default) | `source ~/.zshrc` |
   | macOS | bash | `source ~/.bash_profile` |
   | Linux | bash | `source ~/.bashrc` |
   | Linux | zsh | `source ~/.zshrc` |
   | Windows | WSL or Git Bash | `source ~/.bashrc` |
   | Windows | PowerShell or Command Prompt | No alias is written. Setup prints the full command to start Claude Code with instead |

   Opening a new terminal does the same.
3. Start Claude Code again with `claude`, and check the result:

   ```
   /hean-harness:doctor
   ```

## Commit setting

Two answers decide how implementation work is committed: `Dev mode` (Subagent-driven or Main
session) and `Commits` (Commit per task or No commits). They are asked once and saved for the whole
machine in `~/.claude/hean-harness/implementation.json`, so they apply in every repository.

- **Change it:** ask in a session, for example "switch to commit per task", and click the answer; or
  type `/hean-harness:implementation-defaults` with `show`, `clear`, `commits on`, `commits off`,
  `mode subagent` or `mode main`.
- **What the commit check allows:** a `git commit` goes through when the setting is Commit per task,
  when your latest message asks for a commit, or during an open subagent-driven No commits run, whose
  task commits its reviewers read. Otherwise the commit is refused.
- **During a No commits run:** `git push` and `git reset --hard` are refused until
  `/hean-harness:finish-implementation` undoes the run's commits and leaves every change unstaged in
  the working tree.

## Update and reinstall

1. Update the marketplace and the plugin.

   From a terminal:

   ```bash
   claude plugin marketplace update hean-sfdx-harness-system
   claude plugin update hean-harness@hean-sfdx-harness-system
   ```

   Or inside Claude Code:

   ```
   ! claude plugin marketplace update hean-sfdx-harness-system && claude plugin update hean-harness@hean-sfdx-harness-system
   ```

2. Load the new version inside Claude Code:

   ```
   /reload-plugins
   ```

3. Reinstall the rules, memories and hooks inside Claude Code, in the Salesforce repository:

   ```
   /hean-harness:setup
   ```

   Replaces what the previous install copied. Files you wrote yourself stay.

To reinstall without updating, run step 3 alone.

## Uninstall

Inside Claude Code only:

```
/hean-harness:uninstall
```

- Reverses every change setup made, including the plugins it added.
- Keeps `.claude/manifest/`, files git tracks, and the `.gitignore` lines it added.
- Backups stay in `~/.claude/hean-harness/backups/`.

`claude plugin uninstall` in a terminal removes only the plugin and leaves setup's files behind.

## Learn more

Every skill, agent, hook, and global rule this plugin ships — what it does, what problem it
solves, when it runs, and how it's enforced — is documented on the
[wiki](https://github.com/Bluewine/hean-sfdx-harness-system/wiki):

- [Skills](https://github.com/Bluewine/hean-sfdx-harness-system/wiki/Skills)
- [Agents](https://github.com/Bluewine/hean-sfdx-harness-system/wiki/Agents)
- [Hooks](https://github.com/Bluewine/hean-sfdx-harness-system/wiki/Hooks)
- [Global Rules](https://github.com/Bluewine/hean-sfdx-harness-system/wiki/Global-Rules)

## What setup leaves to you

- **A JDK 11 or newer.** Needs administrator rights. Setup prints the command for your system.
- **The ego lite browser, recommended.** Free, macOS only: https://lite.ego.app/
- **Signing in to Linear.** Run `/mcp` in a session.

`/hean-harness:doctor` names anything else missing, with the command that fixes it.

## Status

In development. The install, check and uninstall machinery works and is tested.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
