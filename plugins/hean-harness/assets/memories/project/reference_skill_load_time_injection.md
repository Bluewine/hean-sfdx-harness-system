---
name: skill-load-time-injection
description: "Skill load-time shell injection verified — a ```! block runs on both typed and model-invoked skill loads, $ARGUMENTS is never duplicated, and allowed-tools grants without restricting"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 00c9f875-946a-400a-bc48-176282b10124
  modified: 2026-09-19T00:00:00.000Z
---

A skill can assemble its own prompt before the model sees anything: a ```! fenced block in `SKILL.md` runs a shell command while the skill loads, and its output replaces the block. Inlining another skill's body this way costs one model turn; telling the model to call that other skill costs two, plus a tool call. `.claude/skills/hean/` uses this to inline `superpowers:brainstorming` and append three fixed answer rules to the prompt.

**Verified by inspecting headless `claude -p` session transcripts:**

- The ```! block runs both when the user types the slash command and when the model invokes the skill through the Skill tool. A skill relying on it does not need the user to type it.
- When `SKILL.md` contains `$ARGUMENTS`, Claude Code substitutes it and does not also append its own `ARGUMENTS:` block, so the prompt appears once.
- The block's output is inserted as plain text, not wrapped in a code fence.
- Claude Code prepends its own `Base directory for this skill: <dir>` line to the loaded body. A second line reusing that exact label makes it ambiguous which directory an inlined skill's relative paths resolve against — label the injected one after the skill it belongs to.
- Skill `allowed-tools` only pre-approves the tools it lists. It does not narrow what the rest of the turn may use: a tool allowed at session level still ran after the skill loaded. A skill that grants itself one Bash pattern therefore does not disable web access for the work that follows.
- A `when_to_use` skip clause covering replies inside a session the skill already started does hold in practice: one Skill call across two user messages, so follow-up turns do not re-inject the payload.

**When counting skill invocations in a transcript**, count `tool_use` blocks whose name is `Skill`. Grepping for `"skill": "<name>"` double-counts, because tool-result metadata repeats the same key.
