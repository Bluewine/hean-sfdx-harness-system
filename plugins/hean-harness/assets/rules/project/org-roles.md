# Org Roles

Apply before any Salesforce CLI command against an org, and before reasoning about a difference
between two orgs.

## Roles

Every org connected to this project has exactly one role, saved per project in
`.claude/hean-harness.json` under `orgs`, keyed by org ID:

- **development** — the org developers deploy their own work to by hand. Nothing deploys to it
  automatically. Several developers may share it.
- **pipeline** — an org that CI deploys to from one branch. Its metadata is the last deploy of that
  branch, nothing else.
- **research** — an org used only to query, retrieve and debug.
- **production** — the live org.

Each saved org also records whether agents may deploy to it. Only the user decides that.

## Discovery

Run discovery once per project, when `/hean-harness:org-roles` shows no saved roles or an org with
no saved role.

1. **List the orgs.** Run `/hean-harness:org-roles` with no argument. It shows each org logged in
   on this machine with its alias, username, org ID and instance URL, and the CLI default org.
2. **Read the pipeline.** Search the repository for CI and deploy configuration: `Jenkinsfile`,
   `.github/workflows/`, `bitbucket-pipelines.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, and
   deploy scripts. For each deploy step, record the branch that triggers it and the org it deploys
   to. Match that org to a logged-in org by instance URL, username or sandbox name.
3. **Read what the project already says.** Check the project's rules, memories and `CLAUDE.md` for
   statements about environments, branches and deploy targets.
4. **Ask once.** Put every org's proposed role, its feeding branch, and whether agents may deploy to
   it into one batch of questions to the user. Mark each proposal with where it came from.
5. **Save.** Run `/hean-harness:org-roles` to save each answer. Never write the file by hand.

A subagent never runs discovery. When roles are missing, it stops and reports that to its caller.

## Lag between orgs

In a branch-driven pipeline, orgs differ from each other by design:

- A pipeline org holds the last deploy of its branch. It lacks work that is only in the development
  org, not yet pushed, or not yet merged.
- The development org holds whatever developers deployed there by hand, including other developers'
  work in progress. It matches no branch unless someone deployed that branch there.
- A component that exists in one org and not another, or an older version of it in a pipeline org,
  is the expected state. Never raise it as a risk, a question, or a design constraint.
- Base design and verification decisions on the development org and the branch's source only.
- Discuss pipeline orgs only when the user asks about promotion, a pipeline failure, or a specific
  org.

## Before any write

1. **Name the org.** Resolve the org the command writes to: the `-o` value, or the CLI default.
   State its alias in the reply before running the command.
2. **Compare it with the saved roles.** Write only to an org saved as a deploy target. When the CLI
   default is not the saved deploy target, stop and tell the user the default changed. Do not
   switch the default back on your own.
3. **Write the alias out.** Pass `-o <alias>` with the alias as text. Never pass a shell variable
   such as `"$ORG_ALIAS"`.

Read-only work — query, retrieve, describe, and running an already-deployed test unchanged — is
allowed against every org.

## Org write gate

A hook checks every org-writing CLI command and the project's pre and post deploy script, and
refuses the command when:

- no roles are saved for the project;
- the target org has no saved role, or is saved as not a deploy target;
- the target org is given as a shell variable.

Relay every line of the refusal that starts with `!!` to the user word for word. Never work around
a refusal: do not change the CLI default, rename an alias, or save a role the user did not confirm.

## Example

The names below are an example of one pipeline shape, not a default:

- `work-*` branches deploy to a sandbox that checks only that the deploy succeeds. Its features
  appear and disappear as different branches deploy.
- `integration` deploys to a QA sandbox.
- `release` deploys to a UAT sandbox, and `master` to production.
- Developers deploy to a shared development sandbox by hand. It is the only deploy target for
  agents.
