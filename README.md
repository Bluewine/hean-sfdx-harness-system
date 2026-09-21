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
| 7 writing rules | Your home folder | How to write clearly, how to word a commit, how to lay out a rule file. Applies in every repository. |
| 16 Salesforce rules | This repository | Apex, Lightning Web Components, Flows, tests, static analysis, deployment steps. |

15 of the 16 Salesforce rules only load when you open a file they apply to, so they cost nothing
in a session that never touches Apex.

**4. Memories.** Notes Claude Code keeps so that something worked out once stays known.

- 59 notes about the project, into Claude Code's own folder for this repository
- 46 notes belonging to individual agents, into this repository

**5. Status line.** Adds the line at the bottom of your terminal showing the folder, branch,
Salesforce org and token usage. It runs on Node, so it needs nothing you do not already have.

**6. Your project's own conventions.** Lists four things the plugin can follow if your team has
them, and tells you which are not yet recorded. It asks nothing here — a script cannot hold a
conversation. Run `/hean-harness:configure` when you want to answer them.

At the end it prints one command for you to run, which reloads your terminal so the alias takes
effect.

## What you also get

**4 agents** Claude Code hands work to: one writes code, one writes and runs Apex tests, one
writes and runs Jest tests, one deploys metadata.

**21 commands** for the tasks you repeat: listing what your branch changed, opening a pull
request, running only the tests your changes affect, preparing a release, and more.

**4 automatic checks** that run on their own: one tells you at the start of a session if the
setup is missing, one blocks a `git add` that forces past `.gitignore`, one holds a commit of
Salesforce Flow files until they carry a dated change note, and one checks a new branch's name —
but only if your team recorded a naming convention.

## Your project's conventions

Four things the plugin will follow if you tell it, and ignore entirely if you do not:

| Convention | If you set it | If you leave it |
|---|---|---|
| Branch names | A new branch whose name does not match is refused, with the pattern shown | No branch name is ever checked |
| Apex class names | The prefix and suffix are used where a class name is generated | No name pattern is enforced |
| Component names | Same, for Lightning Web Components | No name pattern is enforced |
| Commit subject | The shape is followed when a commit message is written | No shape is required |

Leaving all four unset is a normal choice. The plugin then asks for none of them and blocks
nothing.

Your answers are kept in one file inside your repository, `.claude/hean-harness.local.json`, and
added to `.gitignore` so they are never committed. They are yours, not the team's.

## Undoing it

```
/hean-harness:uninstall
```

It shows you everything it is about to reverse, then asks you one question.

**Everything setup installed is removed.** Files it copied are deleted. Files it changed — your
shell startup file, your `CLAUDE.md`, your settings — get only the plugin's own lines taken out,
so anything you wrote yourself stays exactly as it is.

**You choose what happens to your own answers** — the four conventions above, if you recorded any:

| You choose | What happens |
|---|---|
| **Keep** | The answers stay in your repository. Installing again later picks them straight back up. One small file remains. |
| **Delete** | The answers go. Installing again later asks the questions from scratch, and nothing is enforced until someone answers. |

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
