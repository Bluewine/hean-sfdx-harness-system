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

## Commit format

Setup asks once per repository whether commit subjects must read `@WORK-ID: Summary`.

| Command | Purpose |
|---|---|
| `/hean-harness:commit-format on` | Refuse a commit without a work item reference |
| `/hean-harness:commit-format off` | Check nothing |

## Commit approval

Agents do not commit on their own. The two implementation questions — subagent-driven or main
session, and commit per task or not — are asked once per machine and saved. `/hean-harness:start-implementation`
runs the saved preference before the first change, with or without a plan, and asks the questions
only when none is saved.

| Saved preference | Result |
|---|---|
| Commit per task | Each task is committed, and the commits stay |
| No commits, main session | Every commit is refused |
| No commits, subagent-driven | Tasks commit for their reviews, then `/hean-harness:finish-implementation` undoes the commits and leaves the changes for you. Push is refused until then |

To switch commits or dev mode, ask in chat or type `/hean-harness:implementation-defaults`; the
answer replaces the saved preference on this machine.

Under `No commits`, a commit is also allowed in the turn where your own message contains "commit",
"commits", "committed" or "committing" — for example, asking for one after reviewing the changes —
unless the word is negated ("don't commit") or part of another word (`/hean-harness:commit-format`).

Applies in every repository, including inside `/hean-harness:uat-hotfix` and
`/hean-harness:version-bump`. Commits you type in a terminal are not checked.

## Org roles

Every org write from Claude Code — deploy, delete, anonymous Apex, data change, permission set
assignment, package install — is checked against the role saved for the target org.

| Command | Purpose |
|---|---|
| `/hean-harness:org-roles` | List logged-in orgs and save each one's role and whether agents may deploy to it |

- No roles saved: every org write is refused.
- A write to an org not saved as a deploy target is refused.
- Queries, retrieves, test runs and validations are never checked.

## Browser

Setup installs the `ego-browser` skill, unless ego lite already put it in
`~/.claude/skills/ego-browser`. Agents test in the browser with ego-browser when ego lite is
installed, and with Playwright MCP when it is not.

## What setup leaves to you

- **A JDK 11 or newer.** Needs administrator rights. Setup prints the command for your system.
- **The ego lite browser, recommended.** Free, macOS only: https://lite.ego.app/
- **Signing in to Linear.** Run `/mcp` in a session.

`/hean-harness:doctor` names anything else missing, with the command that fixes it.

## Status

In development. The install, check and uninstall machinery works and is tested.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
