---
name: site-publish
description: Experience Cloud site publish step for the Jenkins post stage — adds one `force:community:publish` line per site to runbooks/post-deploy/sf/commands.txt so the pipeline republishes the site after the deploy, never publishing against an org itself
when_to_use: The user wants an Experience Cloud site republished by the pipeline after a deploy — "republish the site after deploy", "add the site publish step", "add the publish line to commands.txt", "publish ABC_Portal in the post stage". Pass the site name as the argument when the user names it.
argument-hint: "[site name]"
---

# Site publish

The skill adds one line per site to `runbooks/post-deploy/sf/commands.txt`:

```text
force:community:publish --name 'ABC_Portal' -u $TARGET_ORG_UNAME
```

Jenkins runs the file in the post stage, after the deploy, when `deploy.yml` lists
`post.runSFCommandFromFile` or `post.runSFDXCommandFromFile`. Jenkins adds the `sf ` or `sfdx `
prefix and sets `$TARGET_ORG_UNAME` to the target org's username. The same line runs under either
key.

- Never run `sf community publish`, `sfdx force:community:publish` or any other org command. The
  publish runs only in the pipeline.
- Never commit unless the user asked for a commit.

## Task list

Create one task per step below, steps 1 to 4, before step 1. Mark each `in_progress` when it starts
and `completed` when it ends.

## Steps

Run every command from the repository root.

1. **Site name.** Take the site name from the skill's argument or the user's words. When neither
   names a site, run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/site-publish.mjs" --list
   ```

   - **One name printed:** use it.
   - **Several names printed:** ask which site in one `AskUserQuestion` call listing every printed
     name.
   - **No name printed:** the repository holds no `Network` file. Stop and ask the user for the
     site's `Network` name.

2. **Add the line.** Run, with one `--site` per site:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/site-publish.mjs" --site <Name>
   ```

   - **Exit 2:** `deploy.yml` lists no post commands key. Relay the `!!` line word for word and stop.
     Nothing was changed.
   - **Exit 1:** report the `ERROR:` line and stop.
   - **Exit 0:** go to step 3.

3. **Report.** Paste into the reply exactly as printed:
   - the file as it now reads;
   - the `WRITTEN:` or `UNCHANGED:` line;
   - each `ADDED:`, `ALREADY PRESENT:`, `NOW RUNS:` and `NOTE:` line;
   - every line starting with `!!`, word for word.

   Command output is not shown to the user. A `NOW RUNS:` line means the site's publish line sat
   after an empty line, never ran, and now runs. The PR's deployment steps do not list that publish
   automatically, because the PR skills see the line as already present; tell the user to mention
   it in the PR if they want it shown. A `!!` line naming a command that sat after an empty
   line means that command never ran before and now runs in the post stage. A `!!` line naming
   `SFDX_CMD_LIMIT` means the file holds more commands than the validator allows by default.

4. **Changed file.** When the script printed `WRITTEN:`, name `runbooks/post-deploy/sf/commands.txt`
   as the changed file. When it printed `UNCHANGED:`, say no file changed. Commit only when the user
   asked for a commit.
