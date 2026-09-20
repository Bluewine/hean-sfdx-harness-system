---
name: reference_plugin_component_limits
description: Claude Code plugins cannot natively load rules, memories, user CLAUDE.md, or the statusLine setting — ship them as assets/ payload installed by a script
metadata:
  type: reference
---

Claude Code loads `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`,
`monitors/`, `bin/` and `output-styles/` natively from a plugin. It does not load:

- **Rules** (`.claude/rules/*.md`) — not a plugin component type at all.
- **Memories** — not a plugin component type at all.
- **A plugin's own CLAUDE.md** — the docs state it "is not loaded as project context".
- **The `statusLine` setting** — a plugin's `settings.json` honours only `agent` and
  `subagentStatusLine`.
- **System prompt content** — `--append-system-prompt-file` is a CLI flag, so it can only be
  wired through a shell alias, never by installing a plugin.

**Why:** plugins contribute context through skills, agents and hooks by design. Anything else
must be written onto the user's machine by a script the plugin ships.

**How to apply:** carry the unsupported pieces as inert payload under `assets/` and install them
with a setup skill. Record every write to an install manifest at a fixed path outside the plugin
directory — `${CLAUDE_PLUGIN_ROOT}` moves on every plugin update and its old directory is
ephemeral, so state written there is lost and uninstall breaks. Reverse an edit to a pre-existing
file by stripping the marker block, never by restoring the backup, or edits the user made after
install are destroyed.
