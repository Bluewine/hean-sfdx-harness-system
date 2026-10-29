# LWC Code Analyzer Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lint every LWC and Aura JavaScript, HTML and CSS file an agent writes with `sf code-analyzer run`, hand findings back at once, and refuse any `git commit` or `git push` that would carry a finding at Moderate or higher.

**Architecture:** One shared checker library runs the analyzer with a generated configuration in two kinds of run, mirroring the pipeline (`.js`: selector `eslint`, five bundled layers off, the project's `eslint.config.js` named; `.html`/`.css`: selector `eslint:slds`, lwc and slds layers on, no project config — the pipeline's own two configurations), proves the config applies with `sf code-analyzer rules`, and records clean file contents by git object ID. One hook file serves `PostToolUse` (`Edit` on `lwc`/`aura` paths) and `PreToolUse` (`Bash` `git` commands), as `runbook-compile-check.mjs` does.

**Tech Stack:** Node.js ES modules, no dependencies; git; Salesforce CLI `sf` with `@salesforce/plugin-code-analyzer` 5.x; Claude Code hooks (`if`, `onFailure`).

**Spec:** [docs/superpowers/specs/2026-10-29-lwc-code-analyzer-hooks.md](/Users/d.min/git-repos/hean-sfdx-harness-system/docs/superpowers/specs/2026-10-29-lwc-code-analyzer-hooks.md)

## Global Constraints

- Never call `npx eslint` or ESLint directly; only `sf code-analyzer run` and `sf code-analyzer rules`.
- Severity threshold 3: findings with `severity <= 3` block; 4 and 5 are ignored.
- In scope: repository has `sfdx-project.json` and `eslint.config.js` at its top, and the root-relative path matches `/^force-app\/(?:.*\/)?(?:lwc|aura)\/.+\.(?:js|html|css)$/`.
- The check fails closed: anything other than a proven clean result or a list of findings is "could not run" and refuses.
- Run kinds: `.js` → kind `js`, selector `eslint`; `.html` and `.css` → kind `slds`, selector `eslint:slds`.
- Generated config, both kinds: `auto_discover_eslint_config: false`; `disable_javascript_base_config`, `disable_typescript_base_config`, `disable_react_base_config` all `true`; every engine except `eslint` disabled (`pmd`, `cpd`, `sfge`, `regex`, `retire-js`, `flow`).
- Kind `js` adds `eslint_config_file` (absolute path of `eslint.config.js`), `disable_lwc_base_config: true`, `disable_slds_base_config: true`. Kind `slds` adds no `eslint_config_file`, and `disable_lwc_base_config: false`, `disable_slds_base_config: false`.
- Proof families: `js-lwc` (`.js` under an `lwc` folder), `js-aura` (`.js` under an `aura` folder), `slds` (`.html`, `.css`).
- Targets are always individual files, never a folder.
- Timeouts: `PostToolUse` handler `timeout` 90, checker deadline 75 s after start; `PreToolUse` handler `timeout` 150, checker deadline 130 s after start, plus `"onFailure": "block"`. The environment variable `HEAN_LWC_ANALYZER_DEADLINE_MS`, when set, replaces both deadlines (tests only).
- Work-order text, verbatim, first line of every block or refusal that lists findings: `Fix these findings now, before any other step. Do not ask the user whether to start.`
- Pre-existing text, verbatim, under the pre-existing heading: `Change only what removes the finding, and keep the functionality, behavior and output exactly as before. If a finding cannot be fixed that way, leave it, and tell the user which finding and why; the commit stays refused until the user decides.`
- Tests follow `hooks/__tests__/runbook-compile-check.test.mjs`: a plain node script, throwaway git repositories in a temp sandbox, a fake `sf` first on `PATH`, `CLAUDE_CONFIG_DIR` in the sandbox, `check`/`has` helpers, exit 1 on any failure. No run in a client repository.
- Commit subjects: `@HEAN-1: <Capitalised imperative summary>`, no trailers.

## Review Focus

- **A crash in the gate with `onFailure: "block"`:** every `git` Bash command would be refused. Expected: any command that is not `git commit` or `git push` exits 0 before dynamic imports. Test in Task 3.
- **A file deleted in the commit:** nothing to lint. Expected: left out, no "could not run". Test in Task 3.
- **A new untracked file written by `Write`:** `git diff` against the base has no lines. Expected: every finding labelled new. Test in Task 2.
- **`git push --dry-run` or `git push origin --delete x`:** sends nothing. Expected: no check (`pushTargets(args).sends === false`). Test in Task 3.
- **A second write after a fix in the same session:** the proof is cached. Expected: no second `sf code-analyzer rules` call for the same session, record key and proof family. Test in Task 1.
- **A commit with both `foo.js` and `foo.css`:** two run kinds. Expected: one `run` per kind, each with only its own files as targets, under one deadline. Test in Task 1.

---

### Task 1: Shared checker library

**Files:**
- Create: `plugins/hean-harness/scripts/lib/lwc-code-analyzer.mjs`
- Test: `plugins/hean-harness/scripts/__tests__/lwc-code-analyzer.test.mjs`

**Interfaces:**
- Produces:
  - `IN_SCOPE: RegExp` — the path pattern from Global Constraints.
  - `kindOf(rel: string): 'js' | 'slds'` — by extension.
  - `familyOf(rel: string): 'js-lwc' | 'js-aura' | 'slds'`.
  - `applies(root: string): { ok: true } | { ok: false, note: string | null }` — `note` is `null` without `sfdx-project.json`, and `!! The code analyzer check does not apply: <root> has no eslint.config.js.` without the config.
  - `recordKey(root: string, sessionId: string): string` — sha1 of `eslint.config.js` content + `node_modules/.package-lock.json` content (or `none`) + analyzer version. The version comes from `sf plugins --json`, cached in the session file.
  - `isRecordedClean(root, rel, oid, key): boolean` (the run kind follows from `rel`, so the key needs no kind), `recordClean(root, rel, oid, key): void` — record at `<claudeDir()>/hean-harness/lwc-code-analyzer/<sha1(root).slice(0,12)>/clean.json`, `{ [rel]: { oid, key } }`.
  - `analyze(root: string, files: string[], { deadline: number, sessionId: string }): Promise<Result>` where `Result = { kind: 'clean' } | { kind: 'findings', findings: Finding[] } | { kind: 'could-not-run', reason: string }` and `Finding = { file, line, column, rule, severity, message }` (`file` root-relative).
  - `labelFindings(root: string, findings: Finding[]): (Finding & { preExisting: boolean })[]`.
  - `findingsText(labelled): string` — the block and refusal body.
  - `couldNotRunText(reason: string): string` — starts `!! The code analyzer check could not run: `.

- [ ] **Step 1: Write the failing tests** with a fake `sf` that handles `code-analyzer run`, `code-analyzer rules` and `plugins --json`, writes JSON to the `-f` path, and logs every call. It finds `setTimeout` → `@lwc/lwc/no-async-operation` severity 3, U+00A0 → `no-irregular-whitespace` severity 2, `debugger` → `no-debugger` severity 4; with selector `eslint:slds` it finds `var(--slds-g-color-surface-1)` → `@salesforce-ux/slds/no-slds-var-without-fallback` severity 3 and `#ffffff` → `@salesforce-ux/slds/no-hardcoded-values-slds2` severity 4, and its `rules` call lists rules only for targets of the selector's kind. `FAKE_SF_MODE=nolwcrules` makes `rules` list none for `lwc` `.js` targets only. The fake writes line and column in `locations[0].startLine` and `locations[0].startColumn`, as the real analyzer does. `FAKE_SF_MODE` values: `broken` (one `UninstantiableEngineError` with location `{ comment: 'Undefined Code Location' }`), `norules` (`rules` lists none), `slow` (sleeps 5 s), `text` (prints no JSON). Tests:
  - `analyze` on a file with `setTimeout` → `findings` with `{ rule: '@lwc/lwc/no-async-operation', line: <its line>, severity: 3 }`.
  - A file with only `debugger` → `clean` (severity 4 ignored).
  - `broken` → `could-not-run`, reason includes `UninstantiableEngineError`.
  - `norules` → `could-not-run`, reason says the project's rules do not apply to the file.
  - `text` → `could-not-run`.
  - `sf` missing from `PATH` → `could-not-run`, reason includes `sf plugins install @salesforce/plugin-code-analyzer`.
  - `slow` with `deadline: Date.now() + 1000` → `could-not-run`, reason includes `deadline`, returns in under 3 s.
  - For a `.js` file, the generated config passed with `-c` contains all five `disable_*_base_config: true` lines, the absolute `eslint_config_file`, and `disable_engine: true` for the six other engines, and the run uses `-r eslint`; every `-t` value is a file.
  - For a `.css` file, the config has no `eslint_config_file`, `disable_lwc_base_config: false`, `disable_slds_base_config: false`, the other three `true`, and the run uses `-r eslint:slds`.
  - A `.css` file with `var(--slds-g-color-surface-1)` → `findings` with `@salesforce-ux/slds/no-slds-var-without-fallback`; one with only `#ffffff` → `clean`.
  - After an `lwc` `.js` proof is cached, `analyze` on an `aura` `.js` file makes its own `rules` call; with `FAKE_SF_MODE=nolwcrules`, an `lwc` `.js` file → `could-not-run` while an `aura` `.js` file still runs.
  - `analyze` on `foo.js` and `foo.css` together → two `run` calls, the first with only `foo.js` as `-t`, the second with only `foo.css`.
  - Two `analyze` calls on `.js` files in one session with the same key make one `rules` call; a later `.css` call makes one more `rules` call with `-r eslint:slds`.
  - `applies` gives the two notes above.
  - `recordKey` changes when `eslint.config.js` or `node_modules/.package-lock.json` changes.
  - `labelFindings`: on a committed file whose line 3 changed on the branch, a finding on line 3 is `preExisting: false` and one on line 10 is `preExisting: true`; on an untracked file, all `false`.
  - `findingsText` starts with the work-order line, groups pre-existing findings under `Pre-existing (in the file before this branch):` followed by the pre-existing text, and names `lwc-conventions.md` section 4 for `@lwc/lwc/no-async-operation`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node plugins/hean-harness/scripts/__tests__/lwc-code-analyzer.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the library**
  - Run `sf` with `spawn` (not `spawnSync`) and `cwd: root`, kill it at the deadline, `NO_COLOR=1`. The output's `locations[0].file` is relative to the folder `sf` starts in, so `cwd: root` keeps it root-relative.
  - `analyze` groups files by `kindOf`. For each kind present: the proof for each family present (`rules -r <selector> -t <first file of the family>`, only when the session file has no proof for this key and family), then `run -w <root> -t <file>... -r <selector> -s 3 -c <tmp>/<kind>.yml -f <tmp>/<kind>.json`. Merge findings; any `could-not-run` wins.
  - Treat any violation without `locations[0].file`, or whose file is not among the targets, as `could-not-run`.
  - Keep the session file at `<state dir>/session-<sessionId>.json`, holding `{ analyzerVersion, provenKeys: [] }`, where each entry is `<family>:<key>`.
  - A finding's `line` and `column` come from `locations[0].startLine` and `locations[0].startColumn`.
  - `labelFindings` diffs against `resolveMergeBase` from `merge-base.mjs` when it resolves, else `HEAD`, with `git diff -U0`; an untracked file is all new.
  - Remove the temp folder in `finally`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node plugins/hean-harness/scripts/__tests__/lwc-code-analyzer.test.mjs`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/lib/lwc-code-analyzer.mjs plugins/hean-harness/scripts/__tests__/lwc-code-analyzer.test.mjs
git commit -m "@HEAN-1: Add the LWC code analyzer checker library"
```

### Task 2: Writing-time hook

**Files:**
- Create: `plugins/hean-harness/hooks/lwc-code-analyzer-check.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json` (the `PostToolUse` `Write|Edit` group)
- Test: `plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `--check <file>...` CLI mode (exit 0 when all are clean and recorded, 1 otherwise, findings on stderr); PreToolUse handling is added in Task 3 to the same file.

- [ ] **Step 1: Write the failing tests** (fake `sf` as in Task 1, hook driven with `PostToolUse` JSON on stdin including `session_id`, following `afterWrite` in `runbook-compile-check.test.mjs`):
  - A write of `force-app/main/default/lwc/foo/foo.js` with `setTimeout` → `decision: 'block'`, reason starts with the work-order line and names `foo.js:<line>` and `@lwc/lwc/no-async-operation`.
  - A write of a test file with U+00A0 → block naming `no-irregular-whitespace`.
  - A clean write → `{}` and the file's object ID is in `clean.json`.
  - A write of `foo.css` with `var(--slds-g-color-surface-1)` → block naming `@salesforce-ux/slds/no-slds-var-without-fallback`; a write of `foo.css` with only `#ffffff` → `{}`.
  - A write of `foo.js-meta.xml` → `{}` and no `sf` call.
  - `broken` mode → block whose reason starts `!! The code analyzer check could not run: `.
  - A repository with `sfdx-project.json` and no `eslint.config.js` → `additionalContext` with the `!!` "does not apply" line, no block.
  - `--check force-app/main/default/lwc/foo/foo.js` on a clean file exits 0 and records it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs`
Expected: FAIL, hook file missing.

- [ ] **Step 3: Implement the PostToolUse path and `--check`, and register two handlers** in the existing `PostToolUse` `Write|Edit` group, after `runbook-compile-check.mjs`:

```json
{ "type": "command", "if": "Edit(**/lwc/**)", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/lwc-code-analyzer-check.mjs\"", "timeout": 90 },
{ "type": "command", "if": "Edit(**/aura/**)", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/lwc-code-analyzer-check.mjs\"", "timeout": 90 }
```

The script repeats the `IN_SCOPE` and `applies` tests itself. Output for findings: `{ "decision": "block", "reason": findingsText(labelFindings(...)) }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/hooks/lwc-code-analyzer-check.mjs plugins/hean-harness/hooks/hooks.json plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs
git commit -m "@HEAN-1: Add the LWC code analyzer check after each write"
```

### Task 3: Commit and push gate

**Files:**
- Modify: `plugins/hean-harness/hooks/lwc-code-analyzer-check.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json` (the `PreToolUse` `Bash` group)
- Modify: `plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs`

**Interfaces:**
- Consumes: Task 1; `commitsIn`, `commitIndex` from `scripts/lib/commit-index.mjs`; `gitCommands`, `repoOf`, `tryGit` from `scripts/lib/command-line.mjs`; `pushTargets` from `hooks/git-identity-guard.mjs`; `operationInProgress` from `scripts/lib/manifest-check.mjs`; `isSfdxRepo` from `scripts/lib/paths.mjs`.
- Produces: `export async function gateRefusal(command: string, sessionCwd: string, sessionId: string): Promise<{ deny: string } | { warn: string } | null>`.

- [ ] **Step 1: Write the failing tests** (`gate`/`refusal` helpers as in `runbook-compile-check.test.mjs`, plus `session_id`):
  - `git commit -m x` with a staged `foo.js` holding `setTimeout` → deny starting with the work-order line.
  - The same file already recorded clean → allowed, and the fake `sf` log shows no `run` call.
  - `git add foo.js && git commit -m x` on an unrecorded clean working file → allowed and recorded.
  - Staged content differs from the working copy of an unrecorded file → deny containing `stage the whole file`.
  - A commit of only `foo.js-meta.xml` and `README.md` → allowed, no `sf` call.
  - A commit of a staged `foo.css` with `var(--slds-g-color-surface-1)` → deny naming `@salesforce-ux/slds/no-slds-var-without-fallback`.
  - A commit that deletes `foo.js` → allowed.
  - `git push` with a pushed commit (not on any remote-tracking branch) carrying an unrecorded `foo.js` with a finding → deny.
  - `git push --dry-run` → allowed, no `sf` call.
  - On branch `a`, `git push origin b` where branch `b`'s `foo.js` has a finding and `a`'s copy is clean and recorded → deny.
  - `slow` mode with the deadline shortened by `HEAN_LWC_ANALYZER_DEADLINE_MS=1000` → deny containing `could not run` and the `--check` command.
  - `git status` → `{}` and no `sf` call. In a copy of the hook folder whose `scripts/lib/lwc-code-analyzer.mjs` holds `throw new Error('loaded')`, `git status` still exits 0 with `{}`.
  - During a merge (`.git/MERGE_HEAD` present) → allowed.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs`
Expected: the Task 3 cases FAIL, Task 2 cases pass.

- [ ] **Step 3: Implement `gateRefusal` and the PreToolUse path.**
  - The top of the file holds only `node:` imports. The PreToolUse path returns 0 at once unless the command text contains `git` and `commit` or `push`; the library and git helpers load with `await import()` after that.
  - Commit files come from `commitIndex` with `git diff --cached --name-only --diff-filter=AMR`. Push files come from `git log --cc --name-only --diff-filter=AMR --format= <revs> --not --remotes`, where `revs` is `pushTargets(args).revs`. Each file is judged at its blob in each pushed tip (`git rev-parse <tip>:<path>`), never at `HEAD`; when that blob is unrecorded and differs from the working copy, refuse.
  - Register the gate as the last handler of the existing `PreToolUse` `Bash` group:

```json
{ "type": "command", "if": "Bash(git *)", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/lwc-code-analyzer-check.mjs\"", "timeout": 150, "onFailure": "block" }
```

- [ ] **Step 4: Run all hook tests**

Run: `node plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs && node plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs && node plugins/hean-harness/hooks/__tests__/git-identity-guard.test.mjs`
Expected: each ends `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/hooks/lwc-code-analyzer-check.mjs plugins/hean-harness/hooks/hooks.json plugins/hean-harness/hooks/__tests__/lwc-code-analyzer-check.test.mjs
git commit -m "@HEAN-1: Add the LWC code analyzer commit and push gate"
```

### Task 4: Rules, agents and memory

**Files:**
- Modify: `plugins/hean-harness/assets/rules/project/local-static-analysis.md`
- Modify: `plugins/hean-harness/assets/rules/project/lwc-conventions.md` (sections 4 and 5)
- Modify: `plugins/hean-harness/agents/developer.md`, `plugins/hean-harness/agents/lwc-tester.md`
- Modify: `plugins/hean-harness/assets/memories/agent/developer/reference_eslint_unavailable_locally.md`

Write each change as the spec's part 5 lists it, following `writing-style-meta-files.md` and `agent-writing-style.md`. In `local-static-analysis.md`, replace the `## Command` config block with the five `disable_*_base_config` lines, add the SLDS run for `.html` and `.css` (`-r eslint:slds`, no `eslint_config_file`, `disable_lwc_base_config` and `disable_slds_base_config` both `false`), and point out that the hooks generate both configs themselves.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify**

Run: `grep -n "npx eslint" plugins/hean-harness/assets/rules/project/local-static-analysis.md plugins/hean-harness/agents/developer.md plugins/hean-harness/agents/lwc-tester.md; grep -n "process.nextTick\|scrollend" plugins/hean-harness/assets/rules/project/lwc-conventions.md; grep -n "Pre-existing code analyzer findings" plugins/hean-harness/agents/*.md`
Expected: `npx eslint` appears only as a command not to use or a failure mode; both `lwc-conventions.md` patterns found; the section in both agents. No `---` line after frontmatter and no trailing blank line in any edited file.

- [ ] **Step 3: Commit**

```bash
git add plugins/hean-harness/assets/rules/project/local-static-analysis.md plugins/hean-harness/assets/rules/project/lwc-conventions.md plugins/hean-harness/agents/developer.md plugins/hean-harness/agents/lwc-tester.md plugins/hean-harness/assets/memories/agent/developer/reference_eslint_unavailable_locally.md
git commit -m "@HEAN-1: Update analyzer rules and agents for the new hooks"
```

### Task 5: Wiki coverage and version

**Files:**
- Modify: `docs/wiki-coverage.md` (Hooks table: `| lwc-code-analyzer-check.mjs | Hooks | documented |`, matching the existing rows' columns)
- Modify: `plugins/hean-harness/.claude-plugin/plugin.json` (`"version": "0.1.70"`)

- [ ] **Step 1: Add the row** with status `documented`: the user decided the hook gets its own entry on the wiki's Hooks page. After the version bump is pushed, the hean-wiki session writes the entry (memory `feedback_brief_wiki_after_version_bump.md`).
- [ ] **Step 2: Commit**

```bash
git add docs/wiki-coverage.md
git commit -m "@HEAN-1: Update wiki coverage for the code analyzer hook"
```

- [ ] **Step 3: Bump the version and commit**

```bash
git add plugins/hean-harness/.claude-plugin/plugin.json
git commit -m "@HEAN-1: Update plugin version to 0.1.70"
```

Tag `hean-harness-v0.1.70` and push only when the user asks.

## Changes made during implementation

- Task 3 adds `--cc` to the push file listing: plain `--name-only` lists no files for a merge commit, so a finding added in a conflict resolution passed unchecked.
- The final review added to the push gate: refusal of variable, glob and brace refspecs and remote words; refusal of a revision that names no commit; the revisions from `remote.<remote>.push`, `push.default=matching` and a typed or configured `:`; a time limit on the push file listing; push labels against the remote-tracking side.
- Both hooks load the library only after `sfdx-project.json` is found.
- The clean record key gains a configuration schema version.
- `git-identity-guard.mjs` exports `pushWords`, which the gate uses instead of its own copy of the argument parsing.
