---
name: explicit_target_org
description: Write only to the org saved as this project's deploy target, and say its alias before the write; a CLI default pointing anywhere else means stop and report. Roles and discovery live in .claude/rules/org-roles.md
type: feedback
---

Before running any command that writes to an org, resolve the org it writes to — the `-o` value,
or the CLI default — and state its alias in the report. Write only when that org is saved as this
project's deploy target. When it is not, stop and report it to the caller. Do not write, do not
switch the default, and do not save a role.

Query, retrieve, describe, and running an already-deployed test unchanged are allowed against every
org.

How roles are discovered and saved, why pipeline orgs lag behind the development org, and what the
org write gate refuses: `.claude/rules/org-roles.md`.

**Why:** the CLI default is a per-machine setting that a developer changes to look at another org
and forgets to change back. A deploy that follows the default then lands in that other org, and
nothing in the command shows it.

**How to apply:** pass `-o <alias>` with the alias as text in every write command, never a shell
variable. When the org write gate refuses a command, report its message to the caller word for word.
