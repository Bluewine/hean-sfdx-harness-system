---
name: configure
description: Record this project's own conventions — branch names, Apex and component naming, commit subject format — in a local untracked file, so the plugin follows them. Anything left unanswered is not enforced
allowed-tools: ["Bash", "Read"]
---

# Configure

Ask the team what conventions this project follows, and record the answers.

**Nothing here is compulsory.** A convention the team does not want is left unset, and then the
plugin never asks for it again and never blocks anything on it. Say so before asking, so nobody
feels pushed into inventing a rule.

## Steps

1. Show what is already recorded:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" status
   ```

2. Ask about each setting that is not yet set. One question at a time. For each, offer the option
   of skipping it, and make clear that skipping means nothing is enforced.

   | Setting | Ask |
   |---|---|
   | `branchNaming` | What shape does a branch name take? Ask for a pattern and one real example. Use `{WORK-ID}` in the pattern where a work item key such as `ABC-123` goes. |
   | `apexClassNaming` | Do Apex class names carry a prefix or a suffix? Ask for each. |
   | `lwcNaming` | Do component names carry a prefix or a suffix? |
   | `commitFormat` | What shape does a commit subject line take? Ask for the pattern, and for any limit on length or word count. |

3. Record each answer:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" set --key branchNaming \
     --value '{"pattern":"work-{WORK-ID}_{description}","example":"work-ABC-12_add_filter"}'
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" set --key apexClassNaming \
     --value '{"prefix":"ACME_","suffix":""}'
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" set --key lwcNaming \
     --value '{"prefix":"acme","suffix":""}'
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" set --key commitFormat \
     --value '{"pattern":"@{WORK-ID}: {Subject}","maxWords":10,"maxChars":77}'
   ```

4. **Only when a convention cannot be written as values**, add a notes file for it. Most cannot
   need one: a prefix, a pattern and a limit are terms, and terms belong in the settings file
   where anything can read them. A notes file earns its place when the convention has an
   exception, or when the wording itself carries meaning that a token would lose.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" instructions-path --key commitFormat
   ```

   Write the user's own words to that path, then point the setting at it by adding
   `"instructions": "commitFormat.md"` to its value. Anything reading the setting gets the values
   and then the notes.

   Do not write a notes file restating what the values already say. Two places holding the same
   rule is how they come to disagree.

5. Keep both out of git:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/settings.mjs" ensure-ignored
   ```

6. Show the final state with `status` again, and say which settings were left unset and what that
   means in practice: no branch name is checked, no class or component name pattern is enforced,
   no commit subject shape is required.

## Rules

- Never invent a convention. If the team has none, leave the setting unset.
- Never set a value the user did not give you.
- The file is local and untracked on purpose. Do not commit it, and do not suggest committing it.
- To change or remove a setting later, run this skill again, or use `unset --key <name>`.
