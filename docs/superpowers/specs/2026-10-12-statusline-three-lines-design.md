# Three-line status line with a token meter mod

## Context

The status line is a `statusLine` command that `setup` installs by copying
`assets/statusline/statusline-command.mjs` to `~/.claude/hean-harness/` and pointing the setting at
the copy. It prints one line. This change adds two lines — the commit preference with the project's
orgs, and the model with its effort and a running token and dollar meter — and moves the parts a
Claude Code mod can supply into a mod.

A mod cannot draw in the `statusLine` row: the row is no mod render site, and a plugin's
`settings.json` applies only `agent` and `subagentStatusLine`. A mod can draw only a `$.ui.status`
line (always prefixed `⚠ <mod name>:`) or replace the terminal-only `PromptHint` hint line. The row
therefore stays a `statusLine` command, and the mod supplies only data.

## Goals

- Show three lines, each part led by an icon.
- Use a mod for everything a mod provides out of the box; custom code only where a mod cannot.
- Copy no file out of the plugin folder; reuse the plugin's libraries instead of duplicating them.
- Reflect a changed commit preference or org role within 5 seconds, from any session.
- Show token and dollar figures taken from what the API and Claude Code report, never estimated.

## Non-goals

- Drawing anything in the Claude Code interface from the mod.
- Running `sf` from the status line.
- Pricing tokens: the dollar figure is Claude Code's own.

## Responsibility split

| Part | Source | Why there |
|---|---|---|
| The status line row, all three lines | `statusLine` command and an inline launcher | No mod render site covers the row |
| 💾 commit preference | `readPreference` in `scripts/lib/commit-lifecycle.mjs` | Plugin-owned data |
| Orgs | `readRoles`, `orgOf` in `scripts/lib/org-roles.mjs`; `mainCheckout` in `scripts/lib/settings.mjs` | Plugin-owned data |
| 📁 folder, 🌿 branch, 📊 context, 🧠 model, ⚡ effort, ≈$ | The `statusLine` stdin JSON | Claude Code supplies them |
| 🚕 `new` / `cached` session tokens | The mod: `turn.complete` | A mod receives each turn's API usage, subagents included |
| `↑` `↓` current turn | The mod: `turn.step` | A mod receives each request's API usage as it finishes |

## Delivery

### The `statusLine` setting

`scripts/install-statusline.mjs` writes this value through `installJsonKey`, as today:

```json
{
  "type": "command",
  "command": "node --input-type=module -e '<launcher>'",
  "refreshInterval": 5
}
```

The launcher, on every run:

1. Reads `<plugins root>/installed_plugins.json`. Setup writes the plugins root into the command as
   an absolute path: `CLAUDE_CODE_PLUGIN_CACHE_DIR` when set, otherwise `claudeDir()` + `/plugins`.
2. Takes the entries under the plugin id. Setup derives the id from its own install path
   (`cache/<marketplace>/<plugin>/<version>/`), giving `hean-harness@hean-sfdx-harness-system`.
3. Picks the entry with the latest `lastUpdated` and imports
   `<installPath>/assets/statusline/statusline-command.mjs`, which reads stdin as it does today.
4. On any failure prints `⚠ hean-harness status line: plugin not found — run /hean-harness:setup`
   and exits 0. The row is never empty.

`installed_plugins.json` and its `installPath`, `version` and `lastUpdated` fields are documented in
the plugin loading reference. A previous version's folder stays on disk for 14 days after an update,
so an open session keeps a working path during the switch.

`refreshInterval: 5` re-runs the command every 5 seconds. The event-driven refreshes do not fire for
a change made in another session, such as a commit preference saved there.

### Install, uninstall, doctor

- `install-statusline.mjs` stops calling `installFile`. Re-running setup over an older install
  removes `~/.claude/hean-harness/statusline-command.mjs` through the existing clear-previous-install
  step, which reverts recorded changes the new version no longer makes.
- `uninstall` restores the user's previous `statusLine`, unchanged.
- `doctor` compares the recorded `statusLine` value, unchanged.

### Script location

`statusline-command.mjs` runs from the plugin folder, so it imports the plugin's libraries directly.
No copy of their logic exists outside the plugin.

## The mod

### Files

- `hooks/hooks.json` gains `"modules": ["./statusline-meter.mjs"]` beside the existing `"hooks"` key.
- `hooks/statusline-meter.mjs` is the hooks module. It registers three hooks and nothing else: no
  UI, no commands, no tools.
- `hooks/statusline-meter.test.ts` holds its tests, run by `claude plugin test`.

### Hooks

- `turn.start` (main loop only, `agentId` absent): resets the current turn's `up` and `down` to 0.
- `turn.step` (main loop only): after `yield* next(e)` returns the step's result, adds its `usage`:
  `up += input_tokens + cache_creation_input_tokens + cache_read_input_tokens`,
  `down += output_tokens`. A `null` usage adds nothing.
- `turn.complete` (every loop, main and subagent): adds the turn's `usage` to the session totals:
  `new += input_tokens + cache_creation_input_tokens + output_tokens`,
  `cached += cache_read_input_tokens`. An absent `usage` adds nothing.

A main turn's `usage` sums only the main loop's responses, and each subagent run is its own
`turn.complete` with its `agentId`. Summing every `turn.complete` therefore counts each response once.

### Meter file

After each hook that changes a figure, the mod writes
`<claudeDir>/hean-harness/meter/<session-id>.json`:

```json
{ "new": 180412, "cached": 2396257, "turn": { "up": 74210, "down": 1830 }, "updatedAt": 1791820000000 }
```

- `<session-id>` is `$.session.id()`, the transcript file's name, which equals the status line's
  `session_id`.
- `<claudeDir>` is `CLAUDE_CONFIG_DIR` when set, else `HOME` + `/.claude`, read through `$.env.get`.
- On `session.start` and on `classic.SessionStart` with `source` `resume`, the mod reads an existing
  file for the session and continues from its totals, so a resumed session keeps its count. `/clear`
  starts a new session id, so the meter restarts at 0, as `cost.total_cost_usd` does.
- `$.fs.write` is not atomic. The status line treats an unparsable file as absent for that run.
- The `meter/` folder is separate from `sessions/`, which the commit lifecycle owns.

### Without the mod

Claude Code before 2.1.287, `disableAllHooks`, `--safe-mode` and an organization's mod policy all
leave no meter file. Line 3 then shows `🚕 –` with the `≈$` figure, and line 1 leaves out `↑` `↓`.

## The three lines

### Line 1

```
➜  📁 ~/git-repos/repo 🌿 work-mySecondBranch (mySecondBranch-wt) ☁️ dev 📊 12% (24k/200k) │ ↑74.2k ↓1.8k 🏷️ my-session
```

- 📁 the working directory, with the home directory written as `~`; a directory outside the home
  directory shows its full path. A linked worktree uses the same rule. Shortening a worktree's path
  to start at its parent folder (`worktrees/abc`) is decided after the `~` form is tried.
- 🌿 the branch, always; in a linked worktree followed by the worktree folder name in brackets.
- ☁️ the CLI default org, read as today.
- 📊 context fill and `(used/window)`, as today.
- `↑` `↓` the current main turn from the meter file; left out without it.
- 🏷️ the session name, only when set.
- The model and `Σ` move off this line. Colours stay as today. A part with no value is left out.

### Line 2

```
💾 commits: per task │ 🛠️ dev: hean-dev → 🧱 reint (work-*): hean-reint → 🧪 qa (integration): hean-qa → 🎭 uat (release): - → 🔭 research: hean-res → 🏦 prod: hean-prod
```

- Commit preference: `commits: per task`, `commits: none`, or `commits: not set`.
- Orgs come from the `orgs` key of the main checkout's `.claude/hean-harness.json`, ordered:
  1. `development`
  2. `pipeline`, ranked by saved `branch`: `work-*`, `integration`, `release*`, `main` or `master`,
     then any other branch alphabetically; ties keep the saved order
  3. `research`
  4. `production`
- Each org reads `<icon> <environment name>[ (<branch>)]: <alias>`:
  - Environment name: the part after the last `.` of a sandbox username; `prod` for a production
    org; the role name for any other non-sandbox org.
  - Branch: pipeline orgs only.
  - Alias: the saved alias when the org is logged in on this machine (`~/.sfdx/<username>.json`
    exists); the username when logged in without an alias; `-` when not logged in.
- Icons: 🛠️ `development`; 🧱 `work-*`, 🧪 `integration`, 🎭 `release*`, 🚚 any other pipeline
  branch; 🔭 `research`; 🏦 `production`.
- No saved roles: `🔌 no org roles saved · /hean-harness:org-roles`.
- Roles saved, none logged in: `🔌 no org connected`.
- Outside a git repository: only the commit part.

### Line 3

```
🧠 Opus 5.5 · ⚡ high │ 🚕 180.4k new + 2.3M cached · ≈$4.18
```

- 🧠 `model.display_name`.
- ⚡ `effort.level`; left out when absent.
- 🚕 `new` and `cached` from the meter file; `🚕 –` without it.
- `≈$` `cost.total_cost_usd` with two decimals. Claude Code computes it at list price; on a
  subscription it is the API-equivalent value, not a charge.
- Numbers: below 1,000 as is, then `k` and `M` with one decimal, truncated, not rounded.

## Failure handling

- Each line is built inside its own `try`/`catch`; a failing part is left out or shows its marker,
  and the other lines still print.
- The script exits 0 in every case.
- The script deletes meter files older than 30 days, at most once a day, tracked by the
  modification time of `meter/.pruned`. The mod cannot delete files: `$.fs` has no delete.

## Testing

- `hooks/statusline-meter.test.ts`, run by `claude plugin test`:
  - main turn steps add to `turn.up` and `turn.down`; `turn.start` resets them
  - `turn.complete` adds main and subagent usage to `new` and `cached`; absent usage adds nothing
  - a resumed session continues from an existing meter file
- `scripts/__tests__/statusline.test.mjs`, plain Node with a sandbox home, following the existing
  `*.test.mjs` convention:
  - org order, icons, environment names, branch brackets, alias, username and `-`
  - both no-org texts, and the commit text for `yes`, `no` and no preference
  - meter file present, absent and unparsable
  - effort left out, `≈$` format, number format
  - branch with and without a linked worktree
- Launcher, in the same test file: with a sandbox `installed_plugins.json` the command runs the
  script; without it the command prints the fallback line and exits 0.
- `setup-twice.test.mjs` and `clear-previous-install.test.mjs`: the `statusLine` value carries
  `refreshInterval: 5` and no copied script path; setup over an older install removes the copy.
- `claude plugin validate plugins/hean-harness` lists the mod's hooks and reports no errors.
- Manual, in a real session that runs one subagent and one web fetch:
  - the meter's figures match the per-model token totals `/cost` reports; any difference is
    reported, not hidden
  - `/clear` restarts the meter; `/resume` continues it
  - a commit preference saved in another session shows within 5 seconds

## Documentation

- `skills/setup/SKILL.md` `description`: the status line is set, not copied.
- Header comments of `install-statusline.mjs` and `statusline-command.mjs`.
- `docs/porting-rules.md`: the status line is no longer a copied asset.
- `docs/tasks.md` row 11, when its wording depends on the copy.
- `docs/wiki-coverage.md`: a row for the mod under Hooks, and the user is asked whether it gets a
  wiki entry, per `.claude/rules/wiki-coverage-tracking.md`.

## Platform facts

- Mods need Claude Code 2.1.287 or later; 2.1.296 is installed. [Mods overview]
- A mod cannot draw in the `statusLine` row; `$.ui.status` prefixes `⚠ <mod>:`; `PromptHint` is
  terminal-only. [Mods reference: render sites; mods API: show something without starting a turn]
- A plugin's `settings` applies only `agent` and `subagentStatusLine`. [Plugin manifest reference]
- `turn.complete` carries `agentId` on subagent turns and `usage` summed over the turn's responses;
  `turn.step` results carry each request's `usage`. [`mods/types/claude-code.d.ts`]
- `hooks/hooks.json` may hold `modules` and `hooks` together. [Mods reference: files]
- `$.fs` has `read`, `write`, `list`, `exists`, `stat`, `ancestors`; `write` is not atomic.
  [Mods reference: mods API methods]
- The `statusLine` input carries `model.display_name`, `effort.level`, `cost.total_cost_usd`,
  `session_id`; `context_window.total_*_tokens` describe the current context, not session totals.
  [Status line docs]
- `installed_plugins.json` records `scope`, `installPath`, `version`; old version folders are
  removed 14 days after an update. [Plugin loading reference]
- `tool_result` content is billed as input on the next request and appears in that response's
  `usage`. [Tool use overview: pricing]
