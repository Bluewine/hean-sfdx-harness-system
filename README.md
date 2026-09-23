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

## Org roles

Every command in Claude Code that writes to a Salesforce org — deploy, delete, anonymous Apex, data
changes, permission set assignment, package install, the project's pre and post deploy script — is
checked against the role saved for the target org.

- In an SFDX project with no saved roles, every org write is refused until they are saved.
- `/hean-harness:org-roles` lists the logged-in orgs and saves each one's role (development,
  pipeline, research, production) and whether agents may deploy to it. The roles are saved per
  clone, by org ID, so an alias change keeps them.
- A write to an org not saved as a deploy target is refused. When the CLI default org has moved
  away from the saved deploy target, the refusal says so first.
- Queries, retrieves, describes, test runs, validations and dry runs are never checked.
- `.claude/rules/org-roles.md` tells agents how to find each org's role from the CI files, and that
  pipeline orgs lagging behind the development org is expected.

## Commit approval

Agents in Claude Code do not commit on their own. A `git commit` is allowed only:

- in a turn where you typed `/hean-harness:commit`, after reviewing the uncommitted changes. The
  model cannot start that skill, and the approval ends with your next message;
- inside `/hean-harness:uat-hotfix` or `/hean-harness:version-bump`, whose commits are their job;
- inside an implementation run whose answers allow it.

Before implementation starts, the agent asks two questions: the development mode (subagent-driven
or main session) and whether to commit per task.

- **Commit per task:** each task is committed, and the commits stay.
- **No commits, main session:** every commit is refused.
- **No commits, subagent-driven:** each task commits, because its review reads the commits.
  `/hean-harness:finish-implementation` then undoes them back to where the run started and leaves
  every change unstaged. Push and `git reset --hard` are refused until that happens.

The check applies in every repository, to every agent and subagent in Claude Code. Commits you type
in a terminal are not checked. The agents' instructions for the two questions are in
`~/.claude/rules/implementation-commits.md`, which setup copies into place.

## Disabled skills

`sync-to-branch` and `commit-walk-sync` ship as `SKILL.mdx`, which Claude Code does not load. To use
one again, rename its file back to `SKILL.md`.

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
- The commit approval state of past sessions stays in `~/.claude/hean-harness/sessions/`.
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
