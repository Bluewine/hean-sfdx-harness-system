# LWC code analyzer hooks

Status: approved by the user on 2026-10-29 (Claude Code hooks only; whole file clean, including pre-existing findings fixed without changing behavior; agents fix at once without asking).

## Problem

Jenkins runs `sf code-analyzer run --rule-selector eslint --severity-threshold 3 --target force-app` and fails the build on any ESLint finding at Moderate or higher. On a `rews-field-service` branch, build #2 failed on 6 findings an agent wrote and committed:

- `@lwc/lwc/no-async-operation`: a `setTimeout` in a component, and `setTimeout` in the `flushPromises` helper of two Jest test files.
- `no-use-before-define` in a test file.
- `no-irregular-whitespace`: raw U+00A0 characters in a template literal.

The plugin already tells agents to run the analyzer (`local-static-analysis.md`, step 9 of `agents/developer.md`, step 8 of `agents/lwc-tester.md`), and `lwc-conventions.md` section 4 forbids `setTimeout`. Nothing checks that the agents do it. In that session the developer agent skipped the analyzer on most LWC tasks. It ran it once with the analyzer's bundled `javascript` and `lwc` rule layers on and dismissed the one real finding among 98. On another task it stopped after `npx eslint` failed. `npx eslint` cannot work in that repository: its ESLint 8.57.1 refuses the ESLint 9 config, which registers the `jest` plugin twice. `sf code-analyzer run` bundles ESLint 9 and loads the same config.

## Intent

Agents are not trusted to remember the check. Claude Code itself runs it:

- **When an agent writes an LWC or Aura JavaScript, HTML or CSS file**, the file is linted and every finding at Moderate or higher is handed back to the agent next to the write result.
- **Before an agent's `git commit` or `git push`**, every LWC or Aura JavaScript, HTML or CSS file the commit records, or the push sends, must have a clean result. Otherwise the command is refused.
- **A refusal or a block is a work order.** The agent starts fixing every listed finding at once. It never asks the user whether to start.
- **The whole file must be clean**, including findings that were in the file before the branch touched it. A fix to such a finding must keep the code's functionality, behavior and output exactly as before. Each one is announced when it is found and again in the final report.

## Goals

- A file with a finding at Moderate or higher cannot be committed or pushed by a Claude Code session.
- The agent sees each finding (rule, file, line, message) right after the write that caused it.
- A check that could not run refuses the commit or push and says it could not run. It never reads as clean.
- A commit of files already found clean at write time does not run the analyzer again.

## Non-goals

- Commits and pushes made outside Claude Code (terminal, IDE). The user decided on Claude Code hooks only. The git `pre-commit` hook, `setup`, `uninstall` and `doctor` do not change.
- Apex and PMD. Only the `eslint` engine: the project's rules on `.js` files, and the analyzer's SLDS rules (`eslint:slds`) on `.html` and `.css` files, as the pipeline runs them.
- Reading the pipeline's `package.json` settings. The hooks copy the two configurations `config-file-service.js` in `@store-sfdcbt-net/CICD_gulp-code-analyzer-v2` writes, but use `eslint.config.js` and threshold 3 instead of reading `commonBuildFramework.pluginSettings` (`eslintConfig`, `minPriority`, `ignoreFiles`). `rews-field-service` sets only `eslintConfig: "eslint.config.js"`, which matches.
- The ESLint 9 upgrade of a client repository's `package.json`. That is the repository team's decision.
- Findings in files the commit or push does not include.

## Anti-goals

- Any route through `npx eslint`. The checker calls only `sf code-analyzer run`.
- Reporting "clean" when the config did not load, an engine failed, the analyzer is missing, or the deadline passed.
- Refusing a commit because of files the commit does not record (unstaged or untracked work).
- A hook killed by its own `timeout`. Claude Code lets the command through when that happens, so the checker must finish, or refuse, before it.

## Scope of files

A file is in scope when all of these hold:

- the repository has `sfdx-project.json` (`isSfdxRepo` in `scripts/lib/paths.mjs`) and an `eslint.config.js` at its top;
- the path from the repository top matches `force-app/**/lwc/**/*.{js,html,css}` or `force-app/**/aura/**/*.{js,html,css}`, test files included. `force-app` matches the pipeline's `--target force-app`, and the `.html` and `.css` patterns match the pipeline's SLDS run targets.

A repository without `sfdx-project.json` gets no output. A repository with `sfdx-project.json` but no `eslint.config.js` gets one `!!` line saying the code analyzer check does not apply, and is not blocked.

## Parts

### 1. Shared checker, `scripts/lib/lwc-code-analyzer.mjs`

- **Input:** the repository root, a list of in-scope files from the root, and a deadline (milliseconds since the epoch).
- **Rules checked**, at Moderate or higher, in two runs that mirror the pipeline's two ESLint runs:
  - **JavaScript run** (`.js` files): every rule the repository's `eslint.config.js` turns on, including what it extends. No rule is singled out; `@lwc/lwc/no-async-operation` is one rule among them. All five bundled layers are off, because they are not the project's rules.
  - **SLDS run** (`.html` and `.css` files): the analyzer's bundled SLDS rules, selected with `eslint:slds` as the pipeline does. The project's `eslint.config.js` is not named, as in the pipeline; it would not apply anyway, because `rews-field-service/eslint.config.js` ignores `**/lwc/**/*.css` and `**/lwc/**/*.html`. At Moderate these are `@salesforce-ux/slds/lwc-token-to-slds-hook`, `@salesforce-ux/slds/no-deprecated-classes-slds2`, `@salesforce-ux/slds/no-slds-private-var`, `@salesforce-ux/slds/no-slds-var-without-fallback`, `@salesforce-ux/slds/no-unsupported-hooks-slds2` and `@salesforce-ux/slds/modal-close-button-issue`; the rest, such as `@salesforce-ux/slds/no-hardcoded-values-slds2`, are Low and never block.
  - A change that touches files of both kinds runs both, under one deadline.
- **Command:** `sf code-analyzer run` with the workspace at the root, the given files as targets (never a folder, never the whole tree, because a whole-tree run crashes on `no-irregular-whitespace`), the `eslint` rule selector for the JavaScript run and `eslint:slds` for the SLDS run, severity threshold 3, and JSON output to a temporary file.
- **Generated configuration**, written to a temporary folder outside the repository, copying the pipeline's `config-file-service.js`:
  - both runs: `auto_discover_eslint_config: false`, and `disable_javascript_base_config`, `disable_typescript_base_config` and `disable_react_base_config` set to `true` (`local-static-analysis.md` names only the javascript and lwc layers; the other three were found in the installed analyzer);
  - JavaScript run: `eslint.eslint_config_file` set to the absolute path of the repository's `eslint.config.js`, and `disable_lwc_base_config` and `disable_slds_base_config` set to `true`;
  - SLDS run: no `eslint_config_file`, and `disable_lwc_base_config` and `disable_slds_base_config` set to `false`;
  - every engine other than `eslint` disabled. Without a JDK, `pmd`, `cpd` and `sfge` each record a Critical violation attached to no file even when only `eslint` rules are selected.
- **Result**, one of:
  - `clean`;
  - `findings`: each with rule, file, line, column, severity and message, Moderate or higher only, only for the given files;
  - `could not run`: with the reason and the error text. This covers: `sf` or the code analyzer plugin missing; a non-JSON or missing output; any violation attached to no file (the tool's own failure, shown as "across 0 file(s)"); a config that fails to load (for example `npm install` not run); the deadline passing; and a failed config proof (below).
- **Config proof.** A zero from a config that failed to load looks identical to clean code. Before the first `clean` in a session for a repository, the checker proves, for each proof family (`js-lwc`, `js-aura`, `slds`), that at least one rule of that run reaches a file of that family. JavaScript is split by bundle folder because a project config can name `files` patterns for `lwc` and not for `aura`; one family's proof must never stand in for the other's. It caches the proof in a file keyed by `session_id` and the content hash of `eslint.config.js`, because every hook run is a new process. The proof must use a path the config's `files` patterns match; a scratch file outside the repository may match none of them and would then fail every check. How the proof is made is the builder's call, verified in the plan's research step (see "Left to the builder").
- **Clean record.** A `clean` result records each file's git object ID with the hash of `eslint.config.js` and the analyzer version, in a record file kept the way `scripts/lib/runbook-compile.mjs` keeps its compile record. The record key also holds the installed versions of the packages the config loads from `node_modules` (for example `@salesforce/eslint-config-lwc` and the internal base config package), because those are pinned to `latest` and a reinstall can change the rules without changing `eslint.config.js`. A change to any part of the key makes every earlier record stale.

### 2. Writing-time hook, `hooks/lwc-code-analyzer-check.mjs`, `PostToolUse` on `Write|Edit`

- **Trigger, scoped by path in `hooks.json`:** one handler per `if` rule, because an `if` field holds exactly one permission rule: `"Edit(**/lwc/**)"` and `"Edit(**/aura/**)"`. `Edit(...)` rules also match `Write` calls. Every new or modified file inside an `lwc` or `aura` folder starts the hook. The `if` filter is best-effort, so the script repeats the scope test itself.
- **What it lints:** the written file when it is an in-scope `.js`, `.html` or `.css` file, with the run that matches its kind. A write of a `.js-meta.xml` or `.svg` file in a bundle exits with no output, because neither pipeline run reads it.
- Runs the checker on that one file with a deadline 15 seconds before the hook `timeout`.
- `findings`: returns `"decision": "block"` with a `reason` that lists each finding as `file:line rule — message`. For `@lwc/lwc/no-async-operation` it names `lwc-conventions.md` section 4.
- **Each finding is labelled.** The hook compares the finding's line with `git diff -U0` against the merge-base or `HEAD`: a finding on a line the branch changed is "new"; any other is "pre-existing (in the file before this branch)". The reason has a separate heading for the pre-existing ones.
- **The reason is a work order.** It opens with: "Fix these findings now, before any other step. Do not ask the user whether to start." For pre-existing findings it adds: "Change only what removes the finding, and keep the functionality, behavior and output exactly as before. If a finding cannot be fixed that way, leave it, and tell the user which finding and why; the commit stays refused until the user decides." A test run on this machine confirmed that a `PostToolUse` block puts the reason next to the tool result and the agent carries on, so the block does not stop an agent mid-task. The commit and push gate is what enforces the fix.
- `could not run`: returns a block whose reason starts with "the code analyzer check could not run" and gives the error and its fix (for example `sf plugins install @salesforce/plugin-code-analyzer`, or `npm install` in the repository).
- `clean`: no output; the checker has recorded the file.
- Registered in `hooks.json` in the existing `PostToolUse` `Write|Edit` group, after `runbook-compile-check.mjs`.

### 3. Commit and push gate, the same file, `PreToolUse` on `Bash`

- **`git commit`, including `--amend`, `-a` and same-call `git add`:** takes the in-scope files the commit records from `commitsIn()` and `commitIndex()` in `scripts/lib/commit-index.mjs`, as `apex-class-header-gate.mjs` does. Deleted files are left out.
- **`git push`:** takes the in-scope files changed by the pushed commits that are on no remote-tracking branch, at their content in each pushed tip (`<tip>:<path>`), not the current branch's. This is the method `git-identity-guard.mjs` uses. Merge-base detection is not used: `resolveMergeBase` throws when no base exists, and on a push of `integration` or `release` it compares against an old ancestor and would check teammates' files.
- **What a push sends:**
  - the file list uses `git log --cc --name-only --diff-filter=AMR`, so a finding added while resolving a merge conflict is checked; plain `--name-only` lists no files for a merge commit;
  - with no typed refspec, the revisions in `remote.<remote>.push` are added, or every local branch for `push.default=matching`; a typed or configured `:` adds every local branch;
  - a refspec or remote word holding a variable, a glob or a brace (`$BRANCH`, `feat*`, `{a,b}`, `@{u}`) is refused with a request to name the branch literally, because the hook cannot tell what the shell expands it to;
  - a literal revision that names no commit is refused; git would refuse that push anyway;
  - the file listing gets the time left before the deadline, and a timeout refuses with the could-not-run text naming `--check`.
- **Labels on a push** compare against the remote-tracking side of the pushed commits; when none resolves, every finding is labelled new.
- **For each file:**
  - its recorded object ID matches the content being committed or pushed: passes without a run;
  - otherwise, when the working-tree file has that same content: it goes into one checker run with the other unrecorded files;
  - otherwise (the working copy differs from what is committed or pushed): refused, naming the file. For a commit: "stage the whole file". For a push: "commit or stash the change, so the pushed content can be checked".
- **Refusal:** `permissionDecision: "deny"` listing every finding, labelled new or pre-existing, with the same work-order text as the writing-time hook; or "the code analyzer check could not run" with the reason.
- **Trigger:** the `Bash` handler uses `"if": "Bash(git *)"` and `"onFailure": "block"`. `git *` also matches `git -C <dir> commit`, and the documentation says the hook runs whenever Claude Code cannot tell which commands a Bash input runs. The script's own command parsing (`commitsIn()` and `gitCommands()`) decides whether the command is a commit or a push, as in the existing gates.
- Not checked, as in the existing gates: a commit during a merge, cherry-pick, revert or rebase (`operationInProgress` in `scripts/lib/manifest-check.mjs`), and a command whose staging the text cannot name. The second prints a `!!` line.
- The plugin modules load only after the repository is found to have `sfdx-project.json`, in both hooks, so a library that fails to load never refuses a commit, push or write in any other repository.
- Registered in the existing `PreToolUse` `Bash` group.

### 4. Deadlines and timeouts

| Hook | `hooks.json` `timeout` | Checker deadline |
|---|---|---|
| `PostToolUse` `Write\|Edit` | 90 seconds | 75 seconds after start |
| `PreToolUse` `Bash` | 150 seconds | 130 seconds after start |

When the deadline passes, the checker stops the analyzer process and returns `could not run`, so the gate refuses with a readable reason rather than being killed.

The `PreToolUse` handler also sets `"onFailure": "block"` (Claude Code 2.1.295 or later; this machine runs 2.1.312). Without it, the hooks documentation says a timed-out or crashed `PreToolUse` hook "doesn't block the tool call". With it, a hook that crashes or is cancelled at its `timeout` still refuses the commit or push. The deadline gives the readable reason; `onFailure` covers the cases the script cannot report itself.

These values are starting points. The plan's research step measures one-file runs, the config proof and a multi-file run with the installed analyzer, and may raise both columns in `hooks.json`, keeping the deadline 15 to 20 seconds below the timeout.

A `--check <file>...` command-line mode, like the one in `runbook-compile-check.mjs`, checks and records files outside a hook. A refusal for the deadline names that command, so a commit or push too large for one run can be checked in parts and then retried.

### 5. Rule, agent and memory updates

- `assets/rules/project/local-static-analysis.md`:
  - add `npx eslint` to "Commands not to use", with the reason: a repository's own ESLint 8 cannot load an ESLint 9 flat config that registers a plugin twice; `sf code-analyzer run` bundles ESLint 9;
  - add that a whole-tree target crashes with "sourceCode.getAllComments is not a function" and shows as one Critical violation across 0 files, and that a target narrowed to the changed files works;
  - add a short section: the plugin's hooks lint LWC and Aura JavaScript, HTML and CSS on every write and refuse a commit or push with a finding; a hook message is a finding to fix at once, never noise, and never a reason to ask the user whether to start;
  - add the rule for pre-existing findings: fix them only with a change that keeps functionality, behavior and output exactly as before; a finding that cannot be fixed that way is left and reported to the user; this is the one exception to "do not fix unrelated problems", and it applies only to findings a hook reported.
- `assets/rules/project/lwc-conventions.md`:
  - section 4: add the "wait after a user event ends" pattern (the end event, such as `scrollend`, plus a CSS `transition-delay`, with a feature check where the event is missing);
  - section 5: state that `flushPromises` uses `process.nextTick`, never `setTimeout`.
- `agents/developer.md` and `agents/lwc-tester.md`:
  - add to `<Success_Criteria>`: zero code analyzer findings at Moderate or higher in changed LWC and Aura JavaScript, HTML and CSS files;
  - add to `<Failure_Modes_To_Avoid>`: stopping the static-analysis step after `npx eslint` fails; use `sf code-analyzer run` per `local-static-analysis.md`;
  - add to `<Failure_Modes_To_Avoid>`: asking the caller or the user whether to fix findings a hook reported, instead of fixing them;
  - add to `<Output_Format>` a section "Pre-existing code analyzer findings" listing each one as fixed (with why the behavior is unchanged) or left (with why), and to `<Final_Checklist>` a matching question. Both agents' `<Final_Checklist>` already ask whether the analyzer ran.
- The main session relays that section from each agent report to the user word for word, both when the agent reports it and in the final summary of the work. This goes in the new section of `local-static-analysis.md`, which the main session loads for `force-app/**`.
- `assets/memories/agent/developer/reference_eslint_unavailable_locally.md`: say `npx eslint` is not used at all, and point to the rule.

### 6. Tests, `hooks/__tests__/lwc-code-analyzer-check.test.mjs`

Follow `hooks/__tests__/runbook-compile-check.test.mjs`, with a stubbed `sf` and fixture repositories. No runs in a client repository.

- A component file containing `setTimeout` is blocked at write time, with the rule and line.
- A finding on a line the branch did not change is labelled pre-existing; one on a changed line is labelled new. Both block.
- The block reason opens with the work-order text.
- A write of an `.html` or `.css` file in an `lwc` folder runs the SLDS run; a Moderate SLDS finding blocks, a Low one does not.
- A write of a `.js-meta.xml` file in an `lwc` folder runs no analyzer.
- A test file containing raw U+00A0 characters is blocked at write time.
- A clean file is recorded, and a commit of it runs no analyzer.
- An analyzer result with a violation attached to no file gives "could not run", not clean.
- `sf` missing gives "could not run".
- The deadline passing gives a refusal, not a pass.
- A commit recording a file with a finding is refused; a commit with only out-of-scope files (for example `README.md` or a `.js-meta.xml`) runs nothing.
- A commit whose staged content differs from the working copy of an unrecorded file is refused with "stage the whole file".
- A push with an unrecorded file whose content in the pushed tip has a finding is refused.
- A repository without `eslint.config.js` gets the `!!` line and no refusal.

### 7. Documentation

- `docs/wiki-coverage.md`: add a row for `lwc-code-analyzer-check.mjs` under Hooks with status `documented`, and rows for the rule changes. The user decided the hook gets its own entry on the wiki's Hooks page; the hean-wiki session writes it after the version bump is pushed.

## Decisions the user made

- Claude Code hooks only; commits and pushes outside Claude Code are not checked.
- The check fails closed.
- The checker uses `sf code-analyzer run`, never `npx eslint`.
- The client repository's ESLint 9 upgrade is left to its team.
- The whole file must be clean, including findings that were there before the branch.
- A pre-existing finding is fixed only by a change that keeps functionality, behavior and output exactly as before, and is announced when found and in the final report.
- A hook block or refusal makes the agent start fixing at once, without asking.
- The writing-time hook is scoped to `lwc` and `aura` folders by path in `hooks.json`.
- The hooks also run the pipeline's SLDS check on LWC and Aura `.html` and `.css` files.
- `lwc-code-analyzer-check.mjs` gets its own entry on the wiki's Hooks page.

## Calls made in this design

- One hook file for both events, as `runbook-compile-check.mjs` does, instead of the two files the incident report proposed.
- The commit gate checks what the commit records, not the branch's unstaged and untracked files as the report proposed.
- A clean result is recorded per file content, so commits do not re-run the analyzer.
- Scope is `force-app/`, matching the pipeline's target.
- No `eslint.config.js`: not checked, with a `!!` line.
- Deadlines and timeouts as in part 4, measured and raised in the plan's research step when needed, plus a `--check` mode.
- The push gate checks commits on no remote-tracking branch, not the merge-base diff.
- The clean record key includes the versions of the packages the config loads.
- The SLDS run copies the pipeline's configuration exactly; `package.json` pipeline settings are not read.
- The config proof is kept per family (`js-lwc`, `js-aura`, `slds`).
- The clean record key includes a schema version of the hook's own generated configuration, so a plugin update that changes it makes old records stale.
- The push argument parser is shared with `git-identity-guard.mjs` (`pushWords`), whose behaviour does not change. That guard still judges only `HEAD` for a push with a configured `remote.<name>.push`; closing that is a separate change.

## Confirmed before planning (code analyzer 5.13.0, Claude Code 2.1.312, scratch fixture)

- One-file `sf code-analyzer run` took 6.7 seconds; two files 5.3 seconds; `sf code-analyzer rules` 3.9 seconds.
- `-f <file>.json` writes `{ runDir, violationCounts, versions, violations[] }`; each violation has `rule`, `engine`, `severity` (1 Critical to 5 Info), `message`, and `locations[0]` holding `file` (relative to the folder `sf` starts in), `startLine` and `startColumn`. The analyzer sets the severity per rule (for example `no-var` 3, `no-use-before-define` 2, `no-irregular-whitespace` 2), not ESLint's `"error"`.
- The exit code is non-zero when a violation meets the threshold; the JSON file is written either way.
- A config that throws gives one violation, `UninstantiableEngineError`, whose location is `{ "comment": "Undefined Code Location" }` (no file).
- The eslint engine has five bundled layers: `disable_javascript_base_config`, `disable_lwc_base_config`, `disable_typescript_base_config`, `disable_react_base_config`, `disable_slds_base_config`. The JavaScript run switches off all five, so only the project's rules run.
- The pipeline's SLDS run is `sf code-analyzer run --rule-selector 'eslint:slds' --severity-threshold '3'` on `force-app/**/{lwc,aura}/**/*.{html,css}`, with a `code-analyzer.yml` the Jenkins shared library writes (the client repository holds none).
- The pipeline's configurations come from `src/services/rule-selectors/config-file-service.js` in `@store-sfdcbt-net/CICD_gulp-code-analyzer-v2` (read in `rews-field-service/node_modules`). Its SLDS run names no ESLint config and leaves the lwc and slds layers on. Its threshold comes from `minPriority`, default 3, and `failOnViolation` defaults to `true` for SLDS as for ESLint, so a Moderate SLDS finding fails the build as "Failed engine(s): SLDS".
- With the pipeline's SLDS configuration, `eslint:slds` on a copy of `rewsfsContactSrCard.css` gave only `@salesforce-ux/slds/no-hardcoded-values-slds2` findings at Low, as Jenkins did. A fixture `.css` line `color: var(--slds-g-color-surface-1);` gave `@salesforce-ux/slds/no-slds-var-without-fallback` at severity 3 and exit code 3. One run took 8.1 seconds.
- `rews-field-service/eslint.config.js` extends `CICD_gulp-code-analyzer-v2/config/sfdx/eslint.config.js`, which has no `files` patterns, so its rules reach `lwc` and `aura` `.js` alike.
- `sf code-analyzer rules -r eslint:slds` lists 12 SLDS rules for a `.css` target, 3 for an `.html` target and 0 for a `.js` target, so the same rules listing is the SLDS run's config proof.
- **Config proof:** `sf code-analyzer rules -t <files> -c <config> -r eslint -f <file>.json` lists only the rules that apply to the targets. With the five layers off, it lists the project's rules for a file the config's `files` patterns match, and an empty list for a file outside them or a config that throws. A non-empty list is the proof; no probe file is written.
- `Edit(...)` permission rules cover `Write` calls, and `Write(...)` rules never match. The two writing-time handlers use `"Edit(**/lwc/**)"` and `"Edit(**/aura/**)"`.
- The `Bash` handler uses `"if": "Bash(git *)"`. The documentation says that when Claude Code cannot tell which commands a Bash input runs, it runs the hook anyway, so the filter never skips a commit. With `"onFailure": "block"`, a crash would block every matched command, so the hook exits 0 for any command that is not a `git commit` or `git push` before it loads anything else.

## Left to the builder

- The record file's location and format, following `scripts/lib/runbook-compile.mjs`.
- How `git push` with an explicit refspec other than the current branch is handled, as long as it never passes unchecked content. Resolved: see "What a push sends" in part 3.
- The wording of messages, following the `!!` convention of the existing hooks.
