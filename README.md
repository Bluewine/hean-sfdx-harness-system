# hean-harness

Sets up Claude Code for Salesforce SFDX projects.

It installs a working configuration — rules, agents, skills, memories and checks — so that a new
repository, or a new person joining one, starts from the same setup instead of building one by hand.

## Install

Add the marketplace:

```bash
claude plugin marketplace add https://github.com/Bluewine/hean-sfdx-harness-system.git
```

Install the plugin:

```bash
claude plugin install hean-harness@hean-sfdx-harness-system
```

### Trying it without changing your own setup

`CLAUDE_CONFIG_DIR` tells Claude Code to keep its settings, history and plugins somewhere else.
Start it with that set and the session begins with an empty configuration — no skills, no agents,
no plugins — and asks you to sign in, exactly as a new colleague's would. Your own configuration
is neither read nor written:

```bash
mkdir -p ~/harness-trial
CLAUDE_CONFIG_DIR=~/harness-trial/.claude claude
```

Delete `~/harness-trial` when you are done. Everything outside Claude Code stays real, so your
authenticated orgs, your git identity and your SSH access still work inside that session.

## Using it

Open the Salesforce repository you want to configure, and run:

```
/hean-harness:setup
```

Check that it worked:

```
/hean-harness:doctor
```

## What setup does, step by step

Setup shows you everything it is going to do first, and changes nothing until you say go ahead.
It then runs six steps in order.

**1. Environment.** Reports on six things it needs: a real Java installation, the `sf` command,
the Salesforce code analyzer, your project's installed packages, the superpowers plugin, and
Python. It installs nothing here. Java needs administrator rights on most machines, so it prints
the exact command for your system and leaves it to you. Python is optional: only two commands use
it, and everything else works without it.

**2. Rules and the `claude` alias.** Copies the rules file into your home folder, then adds a line
to your shell startup file so that typing `claude` loads those rules every time. If your shell is
one it does not write to, it prints a command you can use straight away instead, and everything
else still installs.

**3. Rule files.** Two sets, because they belong in different places.

| Set | Goes to | What it covers |
|---|---|---|
| 7 writing rules | Your home folder | How to write clearly, how to lay out a rule file, how to brief an agent. Applies in every repository. |
| 19 Salesforce rules | This repository | Apex, Lightning Web Components, Flows, tests, static analysis, naming, commit messages, deployment steps. |

17 of the 19 Salesforce rules only load when you open a file they apply to, so they cost nothing
in a session that never touches Apex. The two that load every time are the commit message format
and the research workflow used in plan mode, neither of which is tied to a file type.

**4. Memories.** Notes Claude Code keeps so that something worked out once stays known.

- 59 notes about the project, into Claude Code's own folder for this repository
- 46 notes belonging to individual agents, into this repository

**5. Status line.** Adds the line at the bottom of your terminal showing the folder, branch,
Salesforce org and token usage. It runs on Node, so it needs nothing you do not already have.

**6. Ignored paths.** Adds one line to your repository's `.gitignore`, `.claude/skills/*/output/`,
so that what a skill writes — a rendered pull request body, a report, a screenshot — is never
committed. Those files belong to one run on one clone and would collide on any other. If the line
is already there, nothing is written.

At the end it prints one command for you to run, which reloads your terminal so the alias takes
effect.

## What you also get

**4 agents** Claude Code hands work to: one writes code, one writes and runs Apex tests, one
writes and runs Jest tests, one deploys metadata.

**20 commands** for the tasks you repeat: listing what your branch changed, opening a pull
request, running only the tests your changes affect, preparing a release, and more.

**4 automatic checks** that run on their own: one tells you at the start of a session if the setup
is missing, one blocks a `git add` that forces past `.gitignore`, one holds a commit of Salesforce
Flow files until they carry a dated change note, and one refuses a commit whose subject names no
work item.

## The conventions it enforces

Two are checked before the command runs, and cannot be switched off:

| Check | What it refuses |
|---|---|
| Commit subject | A `git commit -m` whose subject does not read `@WORK-ID: Capitalised summary` |
| Forced staging | A `git add -f` or `git add --force`, which would commit a file `.gitignore` excludes |

The rest are rules Claude Code reads and follows rather than checks that block. Apex class names
and Lightning Web Component names each get one, and both work out your project's own prefix from
the files already in the repository rather than assuming one. Branch names are handled by the
Linear skill, which creates the branch from the issue it is starting.

## Undoing it

```
/hean-harness:uninstall
```

It shows you everything it is about to reverse before reversing any of it.

**Everything setup installed is removed.** Files it copied are deleted. Files it changed — your
shell startup file, your `CLAUDE.md`, your Claude Code settings — get only the plugin's own lines
taken out, so anything you wrote yourself stays exactly as it is.

**Two things are left alone, on purpose.** The `.gitignore` line setup added is read back to you
to remove yourself, because you may have written your own lines around it. Anything already in
`.claude/skills/<skill-name>/output/` stays where it is — those are your own reports and rendered
files, not the plugin's.

Neither is safer. It is only a question of whether you expect to install again.

**Copies of anything it replaced are kept**, in `~/.claude/hean-harness/backups/`, and uninstall
never deletes them. If something goes wrong, your original files are there.

**One thing needs your hand.** Uninstall does not edit your `.gitignore`, because you may have
added your own lines around ours. It lists the lines it added and leaves them to you.

Open a new terminal afterwards — the alias is still loaded in the one you are using.

## Requirements

- Claude Code
- Node.js — you already have it if the `sf` command works
- Git
- Python, for two commands only: `/deprecate-flow` and `/soql-bindvar-resolver`. Everything else
  works without it. Install it with `brew install python` on macOS, or `sudo apt install python3`
  on Linux.

## Status

In development. The install, check and uninstall machinery works and is tested.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
