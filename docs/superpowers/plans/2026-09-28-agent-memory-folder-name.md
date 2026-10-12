# Plugin agent memory folder name

**Goal:** Setup installs each agent's memories into the folder Claude Code reads for a plugin
agent, the agent files stop naming a different folder, this repository's existing agent memories
move to the right folders, and the porting rules require the right folder name.

**Spec:** none separate. The facts below were read from the Claude Code 2.1.283 program file and
the official subagent documentation, and they are the authority for every task.

## Facts every task relies on

- Claude Code gives a plugin agent the full name `<plugin-name>:<agent-name>`. An agent in a
  subfolder of `agents/` also has the subfolder: `my-plugin:review:security`.
- For an agent whose frontmatter sets `memory: project`, Claude Code reads the memory folder
  `<repo>/.claude/agent-memory/<folder>/`, where `<folder>` is the full name with every character
  other than a letter, a digit, `-` or `_` replaced by `-`. An empty result becomes `unknown`.
  So `hean-harness:developer` reads `.claude/agent-memory/hean-harness-developer/`.
- Claude Code creates that folder when it builds the agent's prompt, then puts the folder's
  `MEMORY.md` into the prompt under a `# Persistent Agent Memory` section it writes itself.
- The plugin's name is the `name` field of `plugins/hean-harness/.claude-plugin/plugin.json`
  (`hean-harness`).
- Setup copied the shipped agent memories into `.claude/agent-memory/developer/`,
  `.claude/agent-memory/lwc-tester/` and `.claude/agent-memory/sfdx-deployer/`. No agent reads
  those folders.

## Global constraints

- Change only what each task names. Report any unrelated problem instead of fixing it.
- Commit subjects use the form `@HEAN-1: <Capitalised imperative summary>`, at most 10 words
  after the prefix and 77 characters in total. Add no trailer of any kind (no `Co-Authored-By`).
- Never run `git checkout`, `git restore`, `git stash`, `git reset`, `git push`, or `git add -f`.
- Write plainly. No metaphor where a literal phrase exists.
- Files under `plugins/hean-harness/skills/` and `plugins/hean-harness/agents/`: no `---` line
  after the frontmatter, and exactly one newline at the end of the file.

## Task 1: Install agent memories into the folder Claude Code reads

**Files:**
- Modify: `plugins/hean-harness/scripts/install-memories.mjs`
- Modify: `plugins/hean-harness/scripts/__tests__/memory-index.test.mjs`

**Changes to `install-memories.mjs`:**
1. Read the plugin's name at run time from `.claude-plugin/plugin.json` under `PLUGIN_ROOT`.
   Never hardcode `hean-harness`.
2. Add an exported function `agentMemoryFolder(pluginName, agentName)` that returns
   `` `${pluginName}:${agentName}` `` with every character matching `/[^a-zA-Z0-9\-_]/g`
   replaced by `-`, or `unknown` when the result is empty. Give it a doc comment in the style of
   `encodeProjectPath` that says Claude Code names a plugin agent `<plugin>:<agent>` and reads its
   project memory from that name with every other character turned into `-`, and that a folder
   named after the agent alone is never read.
3. Install each agent's memories into `join(agentMemDir, agentMemoryFolder(<plugin name>, a))`,
   where `a` is the folder name under `assets/memories/agent/` (it equals the agent's `name`).
4. Change the header comment line `Per-agent memories ->  <repo>/.claude/agent-memory/<agent>/`
   to `Per-agent memories ->  <repo>/.claude/agent-memory/<plugin>-<agent>/`.
5. In the per-agent log line, show the destination folder name after the file count, for
   example `developer: 37 files -> hean-harness-developer`.

**Changes to `memory-index.test.mjs`:**
1. Line 121: the agent index path becomes
   `join(repo, '.claude', 'agent-memory', 'hean-harness-sfdx-deployer', 'MEMORY.md')`.
2. Line 160: the developer index path becomes
   `join(repo, '.claude', 'agent-memory', 'hean-harness-developer', 'MEMORY.md')`.
3. Right after the first `install-memories.mjs` run in the sandbox, add one check:
   `'agent memories are not written to a folder named after the agent alone'`, true when none of
   `developer`, `lwc-tester`, `sfdx-deployer` exists under the sandbox repo's
   `.claude/agent-memory/`.
4. Keep the expected paths as literal strings. Do not import `install-memories.mjs` into the test:
   importing it runs its `main()`.

**Verification:** the memory-index test file and the setup-twice test file under
`plugins/hean-harness/scripts/__tests__/` both finish with `all checks passed` (or their own
success output) and exit 0. Each test file's header says how to run it.

**Commit:** `@HEAN-1: Update install-memories to write plugin agent memory folders`

## Task 2: Remove the stale folder name from shipped agent and skill text

**Files:**
- Modify: `plugins/hean-harness/agents/developer.md`
- Modify: `plugins/hean-harness/agents/lwc-tester.md`
- Modify: `plugins/hean-harness/agents/sfdx-deployer.md`
- Modify: `plugins/hean-harness/skills/memory-review/SKILL.md`

**Agent files:** each file holds a copy of the `# Persistent Agent Memory` section Claude Code
generates, placed after the closing `</Agent_Prompt>` line and running to the end of the file. It
names the old folder and says `Your MEMORY.md is currently empty.` Delete that section and the
blank line before it, so each file ends with `</Agent_Prompt>` followed by exactly one newline.
Change nothing above `</Agent_Prompt>`. The `memory: project` frontmatter field stays.

**memory-review `SKILL.md`:** make every statement about the agent memory folder match the
facts above.
1. Lines 18-22: the agents are `hean-harness:developer`, `hean-harness:sfdx-deployer` and
   `hean-harness:lwc-tester`, and each keeps its memory under
   `.claude/agent-memory/<agent-folder>/`, where `<agent-folder>` is the agent's full name with
   the colon replaced by `-` (`hean-harness-developer`).
2. Lines 76-82: the example folder becomes `.claude/agent-memory/hean-harness-developer/` and the
   example agent becomes `hean-harness:developer`.
3. Lines 176-191: the placeholder `<agent-name>` in folder paths becomes `<agent-folder>`.
4. Leave the frontmatter description and every other part of the file unchanged.

**Verification:** no file under `plugins/hean-harness/` still contains `agent-memory/developer`,
`agent-memory/lwc-tester`, `agent-memory/sfdx-deployer` or `Persistent Agent Memory`.

**Commit:** `@HEAN-1: Update agents and memory-review to the real memory folder`

## Task 3: Update the porting rules

**Files:**
- Modify: `docs/porting-rules.md`

Do not renumber any rule.

1. Rule 11, last bullet: `Memories belonging to one agent → <repo>/.claude/agent-memory/<agent-folder>/`
   (keep the backticks around the path).
2. Rule 12: replace its text with a rule that says to build both folder names in rule 11 at run
   time and never hardcode them, followed by three bullets:
   - The project key: the repository's absolute path with every `/` and every `.` replaced by `-`
     (the current rule 12 wording).
   - The agent folder: the agent's full name, `<plugin-name>:<agent-name>`, with every character
     other than a letter, a digit, `-` or `_` replaced by `-`. Example: `my-plugin:developer`
     becomes `my-plugin-developer`, and an agent in `agents/review/` gives
     `my-plugin-review-security`. Claude Code reads a plugin agent's memory from that folder only;
     a folder named after the agent alone is never loaded, so the agent runs without the memories
     setup installed.
   - The agent file: never paste the `# Persistent Agent Memory` section into it. Claude Code
     writes that section at run time from the `memory:` field, with the folder and the current
     `MEMORY.md`. A pasted copy keeps the folder and `MEMORY.md` from the session it was copied
     in, and the agent then gets two sections naming different folders.
3. Add a `**Check:**` line at the end of Phase 2, after rule 13: run each agent that has a
   `memory:` field once, then list `.claude/agent-memory/`. Claude Code creates the folder it
   reads when that folder is missing, so an empty folder beside the one setup filled means the
   two names differ.

**Verification:** the file still numbers its rules 1 to 82 in order, and no rule outside 11 and 12
changed.

**Commit:** `@HEAN-1: Update porting rules for plugin agent memory folders`

## Task 4: Move this repository's agent memories to the right folders

No commit: `.claude/` is ignored by git. This task changes files on this machine only.

**State before:** `.claude/agent-memory/developer/` (37 memories and `MEMORY.md`),
`lwc-tester/` (8 and `MEMORY.md`), `sfdx-deployer/` (1 and `MEMORY.md`), all at the root of this
repository. The folders `hean-harness-developer/`, `hean-harness-lwc-tester/` and
`hean-harness-sfdx-deployer/` exist and are empty. The install manifest at
`~/.claude/hean-harness/install-manifest.json` holds 46 `file-copy` entries and 3 `index-lines`
entries whose targets are inside the three old folders, all with `existedBefore: true`; each
backup is byte-identical to the current file.

**Why the order matters:** a `file-copy` entry with `existedBefore: true` restores its backup to
its target when reverted. If the files are moved first and the entries left in place, the next
setup run restores copies into the old folders.

**Steps:**
1. Save a copy of the three old `MEMORY.md` files in
   `.superpowers/sdd/2026-09-28-agent-memory-folder-name/` for the check in step 6.
2. Revert only the manifest entries whose target is inside one of the three old folders, using
   the `revert` function of `plugins/hean-harness/scripts/lib/manifest.mjs` with its `only`
   option. Never edit the manifest JSON by hand.
3. Move every file left in each old folder into the matching `hean-harness-*` folder. Stop and
   report if a file of the same name already exists in the destination.
4. Run `install-memories.mjs` from this working tree (the fixed one from Task 1), never from the
   plugin cache, passing this repository explicitly. It also re-copies the project memories, which
   are identical to the ones already installed.
5. Remove the three old folders once they are empty.
6. Check, and put the evidence in the report:
   - `.claude/agent-memory/` holds only the three `hean-harness-*` folders (and `.DS_Store`).
   - The folders hold 38, 9 and 2 files.
   - Each new `MEMORY.md` holds the same set of lines as the copy saved in step 1.
   - The manifest has no entry with a target inside the old folders, and has entries for the new
     ones.
   - The plugin's doctor script, run from this working tree, reports no problem for the agent
     memory folders.

## Task 5: Report a recorded auto-update choice on a real run

Added at the user's request after Tasks 1-4. Unrelated to the memory folders.

**Files:**
- Modify: `plugins/hean-harness/scripts/install-auto-update.mjs`
- Modify: `plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`

**Problem:** with no `--auto-update` flag, a real run prints `Auto-update was not chosen. Run
setup with --auto-update all, --auto-update hean, or --auto-update off.` and returns
(`install-auto-update.mjs:113-117`) before it reads `heanEntry.autoUpdate`. Only the dry-run branch
reads it, so a dry run says `... is already true in settings.json. Not asking again.` and the real
run right after it says no choice was made. The settings are correct; only the message is wrong.

**Changes to `install-auto-update.mjs`:**
1. In the `choice === null` branch, check `heanEntry.autoUpdate !== undefined` first, for both a
   real run and a dry run. When it is set, print the existing line
   `` `Auto-update    ${marketplace} is already ${heanEntry.autoUpdate} in settings.json. Not asking again.` ``
   and return without changing anything. A dry run still prints the blank line and
   `Dry run. Nothing was changed.` after it; a real run does not.
2. When `heanEntry.autoUpdate` is undefined, keep today's behaviour: a real run prints the
   `Auto-update was not chosen...` line, and a dry run prints the `!! ASK` lines followed by
   `Dry run. Nothing was changed.`
3. Write the reported line once. Do not copy it into two branches.
4. Header comment, the sentence starting `With no flag, a real run changes nothing`: say that with
   no flag nothing changes; a choice already recorded is reported by a real run and a dry run
   alike; otherwise a dry run asks with a `!! ASK` line and a real run says no choice was made.

**Changes to `setup-twice.test.mjs`:** in the home11 block (the one that runs `--auto-update off`
and then a dry run), add a real run of `install-auto-update.mjs` with no flag after the existing
dry-run check, and two checks:
- `'a real run after --auto-update off reports the recorded choice'`: its output includes
  `test-market is already false in settings.json` and does not include `Auto-update was not chosen`.
- `'a real run after --auto-update off changes nothing'`: `settings.json` reads the same before and
  after that run.

**Verification:** the setup-twice test file and the memory-index test file under
`plugins/hean-harness/scripts/__tests__/` both finish with their success output and exit 0. Each
test file's header says how to run it.

**Commit:** `@HEAN-1: Update install-auto-update to report a recorded choice`
