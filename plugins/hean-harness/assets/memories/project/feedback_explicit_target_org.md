---
name: explicit-target-org
description: "Before any org write, say the CLI default org's alias out loud and compare it with the project's saved deploy target; when the default is not that org, stop and tell the user instead of writing. Discovery and roles live in .claude/rules/org-roles.md"
metadata:
  node_type: memory
  type: feedback
---

Before running any command that writes to an org, resolve the org it writes to — the `-o` value,
or the CLI default — and state its alias in the reply. Compare it with the deploy target saved for
this project. When they differ, stop and tell the user the default changed. Do not write, and do
not switch the default back on your own.

The CLI default is the normal way to reach the development org: developers log in to it and set it
as the default once. The check exists for the rare moment the default points somewhere else.

How roles are discovered and saved, why pipeline orgs lag behind the development org, and what the
org write gate refuses: `.claude/rules/org-roles.md`.

**Why:** a developer switches the CLI default to look at another org and forgets to switch it back.
Nothing in a deploy command shows the default, so the next deploy lands in that other org without
anyone seeing it happen.

**How to apply:** when dispatching a subagent that will write to an org, write the alias into the
dispatch prompt and into the command as text, never as a shell variable. When a subagent reports a
write to an org other than the saved deploy target, tell the user immediately.
