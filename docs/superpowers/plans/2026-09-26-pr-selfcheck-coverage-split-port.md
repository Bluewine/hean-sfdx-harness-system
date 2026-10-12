# PR Self-check, Coverage Split and Pre/Post Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three items the user approved on 2026-09-26: a body self-check inside create-pr and update-pr with room for user-requested templates; a coverage split in `/hean-harness:test-changed` plus the `npx jest` reason note; and the port of field-service's DEXRWO-259 lessons into the pre/post deploy skill and the runbook rule.

**Architecture:** Markdown skill and rule edits for Tasks 1 and 3. Task 2 adds one Node script to the test-changed skill and moves branch-manifest's base-branch detection into a shared `scripts/lib/merge-base.mjs` so both use one copy.

**Tech Stack:** Node.js ES modules (no dependencies), bash tests for branch-manifest, `node` check scripts, Markdown.

**Spec:** The user's answers in the controller session of 2026-09-26 (quoted per task).

## Global Constraints

- Paths are relative to `plugins/hean-harness/`.
- Commit subjects `@HEAN-1: Capitalised imperative summary`, 10 words and 77 characters or fewer. No trailer.
- Commit by explicit path; `docs/superpowers/` stays uncommitted.
- Never run `git checkout`, `git restore`, `git stash`, `git reset`, `git clean`; never push.
- Run every test file under `hooks/__tests__/` and `scripts/__tests__/` once, one at a time, before each commit; Task 2 also runs `bash skills/branch-manifest/__tests__/branch-manifest.test.sh`.
- Skill and rule files: no `---` after the frontmatter, exactly one trailing newline; skill descriptions one sentence, 50 words or fewer.
- Team rule: no repeated code or logic.

## Review Focus

- A user who says "don't use the template, write it like this: …" must get their PR without the skill fighting them (Task 1).
- Coverage numbers must come from the files as they are now, committed or not (Task 2).
- A repository with no Jest tests, or a branch with no LWC changes, must not error in the new coverage step (Task 2).
- The port must not reintroduce REWS-specific names (`REWS_Deployment`, `rews-base`, `corrigo`) (Task 3).
- The port must keep every plugin change made after field-service's copy: org-roles check, script-presence check, base-branch wording, Story reminder (Task 3).

---

### Task 1: create-pr and update-pr — body self-check and user-requested templates

User: "for gh tool, i do not want to block its usability outside of the create, update, release, uat-hotfix, version-bump custom skills … users would say in the chat 'don't use template for this' … then it should be flexible to create PR body that doesn't match the template." Approved: "Self-check in skills" and "Allow other templates".

**Files:** Modify `skills/create-pr/SKILL.md` (line 9, and Phase 9 before the `gh pr create` step); modify `skills/update-pr/SKILL.md` (line 8, and Phase 10 before `gh pr edit`).

**Before (create-pr line 9; update-pr line 8 is the same with `gh pr edit`):**
```
… A PR body not rendered from this skill's template is wrong; never write one by hand and call `gh pr create` directly.
```

**After:**
```
… Render the body from this skill's template, unless the user asks in their own words for a different body or template — then write the body as they ask, skip the template self-check, and keep every other phase.
```

**Added step, immediately before the `gh pr create` call (create-pr) and the `gh pr edit` call (update-pr), same wording in both:**
```
**Check the rendered body.** Unless the user asked for a different body or template, confirm the body file starts with `<!-- PR Title:` and contains `### What was Done?`. When either is missing, render the body again from the template and check once more; if it is still missing, show the file path and stop.
```

- [ ] Edit both files as above; keep step numbering consistent in each file (re-read the whole phase).
- [ ] `grep -n 'Check the rendered body\|in their own words' skills/create-pr/SKILL.md skills/update-pr/SKILL.md` shows both edits in both files.
- [ ] Run every test file; commit `@HEAN-1: Self-check PR bodies and allow user-requested templates`.

### Task 2: Coverage split in test-changed, and the npx jest reason note

User: "Split the report" with the three lines; "It must run test and report from the latest status of the file. Commited or uncommited." Approved the reason note.

**Files:**
- Create: `scripts/lib/merge-base.mjs` — move `refExists`, `creationSource`, `originDefault`, `COMMON_BASES`, `resolveMergeBase` (and the `git`/`gitOut` helpers they need, or import existing ones if `scripts/lib` already has equivalents) out of `skills/branch-manifest/scripts/branch-manifest.mjs` unchanged, exported.
- Modify: `skills/branch-manifest/scripts/branch-manifest.mjs` — import them from `../../../scripts/lib/merge-base.mjs`; no behaviour change.
- Create: `skills/test-changed/scripts/coverage-split.mjs` — reads `coverage/coverage-summary.json`, takes the branch's changed files (merge-base from `resolveMergeBase`, plus staged, unstaged and untracked files), and prints the three lines.
- Modify: `skills/test-changed/SKILL.md` — add Phase 8.
- Modify: `assets/rules/project/lwc-conventions.md` — add section 9.
- Test: `scripts/__tests__/coverage-split.test.mjs` (new, same `check()` style as the other script tests) — a throwaway repo with a fake `coverage-summary.json`.

**Phase 8 (after the testers return), SKILL.md text:**
```
## Phase 8 — Whole-suite coverage split

When `runLwc` was true, run the whole Jest suite once with coverage from the current files, then print the split:

    npx jest --coverage --coverageReporters=json-summary
    node "${CLAUDE_SKILL_DIR}/scripts/coverage-split.mjs"

Report its three lines as they are. Skip this phase when no LWC was in scope.
```

**coverage-split.mjs output (line coverage, from the json-summary totals per file):**
```
Files this branch changed (3):                 100.0%
Files this branch did not touch (212):          99.9%   ← 3 uncovered lines, not from this branch
Whole repository (215):                         99.9%
```
Rules: a file counts as "changed" when it differs from the merge-base or is staged, unstaged or untracked; only files present in the summary are counted; no summary file → print `No coverage summary found — run npx jest --coverage --coverageReporters=json-summary first.` and exit 0; no changed file in the summary → print `Files this branch changed (0): —`.

**lwc-conventions.md section 9:**
```
## 9. LWC Jest — Run Jest with `npx jest`

Run Jest as `npx jest`, never `npm run test:unit`. `test:unit` runs the `sfdx-lwc-jest` wrapper, which passes on only `--coverage`, `--updateSnapshot`, `--verbose` and `--watch` and silently drops every other option — so `npm run test:unit -- --coverage --collectCoverageFrom "<path>"` measures the whole repository instead of `<path>`, with no warning.
```

- [ ] Write `coverage-split.test.mjs` (changed file 100%, untouched file with 1 uncovered line, untracked changed file, missing summary, no changed files); run it and record RED.
- [ ] Move the base-branch functions to `scripts/lib/merge-base.mjs`; run `branch-manifest.test.sh` — it must pass unchanged.
- [ ] Implement `coverage-split.mjs`; test GREEN.
- [ ] Add Phase 8 and section 9.
- [ ] Run every test file and `branch-manifest.test.sh`; commit `@HEAN-1: Add a coverage split for branch files to test-changed`.

### Task 3: Port field-service's DEXRWO-259 lessons

Source: field-service commit `cb76a417` ("@DEXRWO-259: Replace Secondary Service Provider lookup with free-text field"); final copies are at `07507dc5^:.claude/rules/runbook-deployment-steps.md` and `07507dc5^:.claude/skills/jenkins-pre-post-deploy/SKILL.md` in `~/git-repos/REWS-Workplace-Services/rews-field-service` (read with `git show`, read-only).

**Files:** Modify `assets/rules/project/runbook-deployment-steps.md` (Stage mechanics; new section after it); modify `skills/jenkins-pre-post-deploy/SKILL.md` (notes at the end); modify `assets/memories/project/reference_runbook_stage_destructive_rule.md` (description and body: "anything in pre must also exist in post" becomes "a component nested in a shared container file declared in pre must also be declared in post; a standalone-file component need not be").

**Piece 1 — shared conversion folder (corrects the plugin's rule).**
Before (plugin):
```
**Both stages share one conversion output folder, and it is not cleared between them.** Anything declared in `pre` must also exist in `post`, at minimum as an empty declaration, or `post`'s generated `package.xml` omits it and the deploy fails with "Not in package.xml". Declaring a transient component in one stage only avoids this entirely.
```
After: field-service's paragraph and its two bullets verbatim — a component nested inside a shared container file (a `CustomField` inside an `.object` file) needs a matching declaration in the later stage; a standalone-file component (`ApexClass`, `Flow`, `FlowDefinition`) needs none.

**Piece 2 — deleting a component something still references.**
Before (plugin):
```
**A destructive entry naming a component absent from the target org does not fail the deploy.** Deprecating a component that predates the branch belongs in the post destructive manifest, alongside deleting it from the repo.
```
After: field-service's paragraph and its two options verbatim ("Defer the deletion to the post destructive manifest." / "Deploy the referencing components' updated content early …"), keeping the plugin's "alongside deleting it from the repo" in the first option.

**Piece 3 — new section `## Writing pre/post-deploy Apex scripts`** after Stage mechanics: field-service's section verbatim (compile-time schema resolution, string-keyed access, the `containsKey` guard, apply to fields added and removed, a `pre` script's field need not be deleted in `pre`).

**Piece 4 — jenkins-pre-post-deploy notes.**
Before (plugin):
```
- **`both` runs `pre` immediately followed by `post`.** The real pipeline deploys `force-app` between them; this does not. `post` therefore runs against an org that has not received the release.
```
After: field-service's longer version of that bullet (why a clean `both` result cannot prove a `post` deletion of a still-referenced component is safe), plus its two bullets "`both` does faithfully catch a metaData component `pre` declares that `post` is missing" and "Script and manifest content is out of scope", verbatim.

**Keep unchanged:** the plugin's `ACME_Deployment` placeholder name (never `REWS_Deployment`), its general Manual rows candidates (never the `rews-base`/`corrigo` order), its org-roles step and script-presence check in the skill, its base-branch wording, and the Story reminder.

- [ ] Apply the four pieces; `grep -n -i 'REWS\|rews-base\|corrigo' assets/rules/project/runbook-deployment-steps.md skills/jenkins-pre-post-deploy/SKILL.md` returns nothing.
- [ ] Re-read both whole files for coherence (the skill's "out of scope" bullet points at the rule by path).
- [ ] Update the memory's description and body as listed under Files; keep its other facts.
- [ ] Run every test file (memory-index checks the memory index); commit `@HEAN-1: Port DEXRWO-259 runbook lessons into the rule and skill`.

### Task 4: Release

Run by the controller after the final whole-change review, together with the auto-update commits already on `main`: version bump in its own commit, trailer check, push with the dpark identity procedure, `claude plugin update`.
