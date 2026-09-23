---
name: org-roles
description: Per-project org role registry — shows each logged-in Salesforce org with its saved role (development, pipeline, research, production) and the CLI default, and saves the user-confirmed role and deploy permission the org write gate enforces, keyed by org ID so alias changes do not break it
argument-hint: "[status | set <alias> ... | remove <alias>]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Org roles

Show or save the role of each Salesforce org for the SFDX project in the current folder. The org
write gate refuses every org write until the roles are saved, and allows writes only to an org
saved as a deploy target.

## Steps

1. Show the current state:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" status
   ```

   When the output says the folder is not in an SFDX project, report that and stop. When the user
   asked only to see the roles, report the output and stop.

2. Collect the answers to save. For each org, three values:
   - **role** — `development`, `pipeline`, `research` or `production`;
   - **deploy** — `yes` when agents may deploy to it, otherwise `no`;
   - **branch** — for a `pipeline` org, the branch whose pipeline deploys to it.

   Take values the user already stated in this conversation. Put every value still missing, with
   a proposal and where the proposal came from, into one `AskUserQuestion` batch. Never save a
   value the user did not state or confirm.

3. Save each org:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" set <alias> --role <role> --deploy <yes|no> [--branch <branch>]
   ```

   To drop an org the user no longer uses:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" remove <alias|org ID>
   ```

4. Run `status` again and report:
   - each org with its alias, role, branch and deploy permission;
   - the CLI default org, and whether it is a saved deploy target;
   - that the org write gate uses the new roles from the next command, with no restart.

## Rules

- Never edit `.claude/hean-harness.json` by hand.
- Save one org per `set` call. Never save `--deploy yes` for an org the user did not confirm as a
  deploy target.
