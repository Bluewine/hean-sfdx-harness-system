# Identifier naming rule

**Goal:** Make every reply name a thing that has an identifier by that exact identifier, every time, even when the user used other words; link the user's words to the identifier once.

**Spec:** before/after text approved by the user on 2026-10-06 ("Yes, as drafted"), reproduced verbatim below. Trigger: an incident report from a field-service session where `REWSFS_WorkTypeByIssueSync` became "the issue sync" because lines 17-21 allowed "a plain description of what the thing does".

## Global constraints

- Replace text exactly as given; change nothing else in either file.
- Do not touch `plugins/hean-harness/assets/rules/user/communication-protocol.mdx` (uninstalled backup) or `plugins/hean-harness/skills/create-pr/bullets.md` (pull-request wording for app users, a different audience).
- Keep the surrounding wrap width (about 100 columns) and the files' existing bullet style.
- The installed copies under `~/.claude/` are not edited; setup copies them on its next run.

## Task 1: Replace the naming rules and add the CLAUDE.md block line

**Files:**
- `plugins/hean-harness/assets/system-prompt/global-system-prompt.txt`: replace lines 17-26 (from `- **Name things by what the reader sees` through `"this", "that", "it" or "so".`) with the After text below.
- `plugins/hean-harness/assets/claude-md/block.md`: in `### Always`, add the new bullet after `- Write plainly. Do not reach for a metaphor when a literal phrase exists.`

**global-system-prompt.txt — After (verbatim):**

```
- **Identifiers are names, and nothing replaces them.** When a thing has an identifier — an Apex
  class, a trigger, a flow API name, a field, an object, a custom metadata type, a component, a
  file, a skill, an agent, a hook, a command — write that identifier in backticks every time the
  thing is mentioned. Never shorten it, translate it into a description, or replace it with a
  label. A description may follow the identifier in the same sentence; it never stands alone.
  Write "`REWSFS_WorkTypeByIssueSync` keeps work types in step with issues", not "the issue sync".
- **The reader's words are linked to the identifier once.** When the reader calls a thing by
  another name, the reply's first mention pairs the identifier with the reader's words —
  "`apex-coverage.mjs` (the coverage script)" — and every later mention uses the identifier alone.
  The reader never has to write the identifier.
- **A file is named by its path from the repository root the first time, then by its file name**,
  unless two files in the reply share that name.
- **A thing with no identifier** — a check, a step, a decision, a behaviour — is named by what the
  reader recognises without translating: text on the screen or the reader's own words. Write "the
  check that refuses a commit", not "the gate"; "the file name inside the round brackets", not
  "the link target".
- **One thing, one name, for the whole session.** The first time a thing comes up, say plainly
  what it is. From then on, keep that exact name to the end of the session: never rename it, never
  swap in a synonym, and never point back with "this", "that", "it" or "so".
- **These naming rules outrank every length and brevity rule.** A long identifier is never a
  reason to shorten it.
- **No working labels for things that have identifiers.** A label made up while reasoning never
  appears in a reply. Look up the identifier before writing about the thing.
- **Check before sending.** Before sending a reply, find every mention of a class, trigger, flow,
  field, object, file, component, skill, agent, hook or command. Each one must be its exact
  identifier. Replace any short form or stand-alone description first.
```

**block.md — new bullet (verbatim):**

```
- Call every class, flow, field, object, file, component, skill, agent and command by its exact
  identifier in backticks, every time, even when the user used another name. This outranks
  brevity.
```

**Verify:**
- `grep -n "plain description" plugins/hean-harness/assets/system-prompt/global-system-prompt.txt` returns nothing.
- `git diff` shows only the replaced block and the one added bullet.
- Any test that reads either file passes; run the full loop (every `plugins/hean-harness/hooks/__tests__/*.test.mjs` and `plugins/hean-harness/scripts/__tests__/*.test.mjs` with node, one at a time) because setup tests install both files.

**Commit** by explicit path: `@HEAN-1: Name things by their identifiers in replies`.
