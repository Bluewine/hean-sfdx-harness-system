---
name: branch-manifest
description: Branch-scoped Salesforce manifest (package.xml) generator — writes .claude/manifest/{work-id}.xml, named after the work ID in the branch name, listing every component added or modified since the branch's merge-base with its auto-detected base branch, whether committed, staged, unstaged, or untracked
when_to_use: The user asks to create, generate, build, refresh, regenerate, or update the manifest or package.xml of the current branch, story, or work ID — including right after implementing metadata that is not committed yet, and when the manifest already exists and must pick up newly added components. Invoke the skill directly without reading its files; it runs its script on load and returns the finished result. Pass `--base {branch}` or `--name {manifest-name}` as the skill arguments only when the user names a base branch or a manifest file; otherwise pass none.
argument-hint: "[--base <branch>] [--name <manifest-name>]"
model: claude-sonnet-5
effort: medium
allowed-tools: Bash(node *branch-manifest.mjs*)
---

# Branch Manifest

The manifest script already ran when this skill loaded. Its complete output:

```!
node "${CLAUDE_SKILL_DIR}/scripts/branch-manifest.mjs" --args-stdin <<'BRANCH_MANIFEST_ARGS'
$ARGUMENTS
BRANCH_MANIFEST_ARGS
```

## Reply

The output above is the complete result: the script already resolved the branch, the base branch, and the components. Reply according to its first line, without calling the advisor, spawning subagents, reading files, or running git or sf commands.

| First line of the output | Reply |
|---|---|
| `Manifest: …` | One sentence naming the manifest file and its status (created, updated, unchanged, or not written), then the output verbatim in a code block. Nothing else. |
| `Error: …` | The output verbatim, then stop. |
| `[shell command execution disabled by policy]` | Run `node "${CLAUDE_SKILL_DIR}/scripts/branch-manifest.mjs"` once with Bash, adding only the `--base` and `--name` flags from the skill arguments, then reply to its output by this table. |
