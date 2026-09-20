---
name: explicit-target-org
description: "Name the intended target org explicitly in every command and every subagent dispatch; never let the Salesforce CLI fall back to whatever default it resolves. Develop against a sandbox or scratch org, and follow the team's promotion policy for everything downstream of it"
metadata:
  node_type: memory
  type: feedback
---

Always name the intended target org explicitly in any command or subagent dispatch. Never let the
Salesforce CLI fall back to whatever default `.sf/config.json` happens to hold in the current
working directory.

Do development work — anything that writes metadata or data — against a sandbox or scratch org
that exists for that purpose. The connected and selected org is the one to use.

Environments further along, meant for integration, QA, UAT or production, are governed by the
team's promotion policy, not by a rule this memory can state. Some teams promote only through a
pipeline driven by a branch strategy, and a direct deploy to those environments is not an option
regardless of who approves it. Other teams allow direct deploys to every environment. Find out
which applies before writing to one, and do not assume the stricter answer or the looser one.

Read-only operations — query, retrieve, describe, or running an already-deployed test class
unchanged — are fine against any org. They change nothing, so no policy restricts them. Use them
freely when working out whether a failure is a code bug or drift in that org's data or metadata.

**Why:** an org alias resolved from a working directory's default landed a deploy in an
environment nobody intended. Relying on default resolution means the target depends on which
directory a command happens to run in, which is not something anyone reading the command can see.

**How to apply:** when dispatching any subagent that will deploy or otherwise write, state the
target org in the dispatch prompt rather than leaving it to be resolved. A subagent may query,
retrieve or describe against any org for diagnosis. If a subagent's report names a different org
than intended for a write, verify and clean up immediately rather than letting it stand.
