# Architecture notes

Notes for building and maintaining this plugin. Users do not need to read this.

## Rule enforcement

Rules can reach Claude Code three ways. They differ in how reliably Claude Code follows them.

1. **System prompt file.** Passed with `--append-system-prompt-file` on the command line. The text
   arrives in the system prompt itself. This is the strongest of the three. It needs the shell
   alias, so it does not apply when someone runs `claude` without it, such as in a script.
2. **The user's `CLAUDE.md`.** Arrives with the first message of a session. Weaker than the system
   prompt, but it applies whether or not the alias is used.
3. **Rule files.** Arrive the same way as `CLAUDE.md`. A rule limited to certain file paths does
   not arrive at all until one of those files is opened. Use these for conventions, not for rules
   that must always hold.

This plugin uses all three. The system prompt file holds the rules that must always hold. The
most important of those are repeated in `CLAUDE.md` so they still apply without the alias.

## Uninstall

Setup writes down every change it makes to a file at
`~/.claude/hean-harness/install-manifest.json`. Uninstall reads that file and reverses each
change.

The file sits outside the plugin directory for two reasons. The plugin's own directory changes
path every time the plugin updates, so anything written there is lost. And uninstall has to keep
working after someone removes the plugin.

When setup adds lines to a file that already existed, uninstall removes only those lines. It does
not restore the earlier copy of the file, because that would throw away anything the user wrote in
that file afterwards. A copy of the original is kept anyway, in case it is ever needed.

## Runtime

Scripts are written in Node. The `sf` command is a Node program, so every Salesforce developer
already has Node. `jq` and `python3` are not always installed.
