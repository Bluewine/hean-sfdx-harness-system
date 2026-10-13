---
name: org-roles
description: Per-project org role registry — shows each logged-in Salesforce org with its saved role (development, pipeline, research, production) and the CLI default, asks for every missing role or pipeline branch, or every value with `review`, and saves the user-confirmed answers the org write gate enforces, keyed by org ID
argument-hint: "[status | review | set <alias> ... | remove <alias>]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Org roles

Show or save the role of each Salesforce org for the SFDX project in the current folder. The org
write gate refuses every org write until the roles are saved, and allows writes only to an org
saved as a deploy target. The roles are saved in the main checkout's `.claude/hean-harness.json`,
so every git worktree of the repository shows and saves the same roles.

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

   Which orgs to ask about:
   - **Default run:** every value the status output names in a `!! ASK —` line — a logged-in org
     with no saved role, and a `pipeline` org with no saved branch. Ask about all of them in this
     run. When there is no `!! ASK —` line, report the output and stop.
   - **`review` run:** when the argument is `review`, or the user asks to review or re-check the
     roles, ask about every org the status output shows.

   How to ask:
   - **Org with every value saved** (review run only): one question, `<alias> — keep <role> ·
     branch <branch> · deploy <yes|no>?`, with the options `Keep (saved)` first, then
     `Change role`, `Change branch` (pipeline orgs only) and `Change deploy permission`. A change
     option is followed by one question for that value, with the saved value first as
     `<value> (saved)`. `Keep (saved)` saves nothing for that org.
   - **Missing value:** one question per value, with a proposal first, marked `(Recommended)`,
     and where the proposal came from: the alias, the CI and deploy configuration
     (the discovery steps in `.claude/rules/org-roles.md`), or a skill such as `release-pr`.
   - **Values already stated:** take values the user stated in this conversation and do not ask
     for them again.
   - **Batching:** put the questions in as few `AskUserQuestion` calls as possible, four per call.

   Never save a value the user did not state or confirm.

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
   - every `!! ASK —` line still in the output, which means a value is still missing;
   - the CLI default org, and whether it is a saved deploy target;
   - that the org write gate uses the new roles from the next command, with no restart.

## Rules

- Never edit `.claude/hean-harness.json` by hand.
- Save one org per `set` call. Never save `--deploy yes` for an org the user did not confirm as a
  deploy target.
