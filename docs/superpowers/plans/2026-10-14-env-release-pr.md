# `env-release-pr` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the skill `env-release-pr`, which opens or updates the UAT deployment PR (`integration` → `release`) or the Production Release PR (`release` → `master`), and turn off `release-pr` without changing its content.

**Architecture:** `env-release-pr/SKILL.md` starts as a copy of `release-pr/SKILL.md` and receives a fixed list of edits: new frontmatter, a new Phase 0 that settles the kind, per-kind `BASE`/`HEAD`/title/body-file values, and assignees or reviewers only when the requester names them. `release-pr/SKILL.md` is renamed to `SKILL.mdx`, which Claude Code does not load. Other skills that name `release-pr` are updated to name `env-release-pr`.

**Tech Stack:** Claude Code plugin skills (Markdown with YAML frontmatter), `gh`, `git`, headless `claude -p` for the routing check.

**Spec:** `docs/superpowers/specs/2026-10-13-env-release-pr-design.md`

## Global Constraints

- `plugins/hean-harness/skills/release-pr/SKILL.mdx` is byte-for-byte the current `SKILL.md` (a pure rename).
- Shipped text names no client project: write `{PROJECT}`, never a real project or org name.
- The skill never assigns anyone or requests reviewers on its own, and never assigns `@me` by itself; it passes only the assignees and reviewers the requester (user or calling agent) names, as `--assignee`/`--reviewer` on create and `--add-assignee`/`--add-reviewer` on edit, and never removes existing ones.
- `description` is one sentence of 20–50 words; `description` + `when_to_use` stay under 1,536 characters.
- Body contract for both kinds: `Work ID | Subject | Assignee | Sprint`, separator `-- | -- | -- | -- |`, blank line, `[Runlist]({RUNLIST_URL})`.
- Commit subjects: `@HEAN-1: Capitalised imperative summary`, at most 10 words and 77 characters, no trailers.
- Never run plugin skills or scripts in a client repository.
- Scratch folders: `T=$(mktemp -d) || exit 1; [ -n "$T" ] && [ -d "$T" ] || exit 1`; quote `"$T"`; remove only under `/var/folders` or `/tmp`.

## Review Focus

1. A vague request ("open the release PR") must ask the kind, never default to UAT because the old skill did.
2. A request that names a PR number whose base is `master` must run as Production even when the words say only "update the release PR".
3. `prod` given with a PR whose base is `release` must stop and report both, not pick one.
4. Inside a subagent the skill must return the `needs input: kind …` line before any `git fetch` or `gh` call.
5. Update mode on a PR that already has assignees must leave them unchanged, and add only the people the requester named.
6. `/hean-harness:env-release-pr prod --assignee <login>` must not read `--assignee` as a PR number.

Items 1 and 4 are pinned by Task 3's routing runs. Items 2, 3, 5 and 6 are pinned by Task 1's text checks (Phase 0 rule 2, the disagreement rule, the people rules and the edit command); a live check needs GitHub and is the user's real run.

---

### Task 1: Write `env-release-pr/SKILL.md`

**Files:**
- Create: `plugins/hean-harness/skills/env-release-pr/SKILL.md`
- Read only: `plugins/hean-harness/skills/release-pr/SKILL.md` (source of the copy; do not modify)

**Interfaces:**
- Consumes: nothing.
- Produces: the skill `hean-harness:env-release-pr` with `arguments: [kind, pr]`, the placeholder `{KIND_FILE}` (`uat` or `production`), and the exact caller line `needs input: kind — uat (integration → release) or prod (release → master)`. Task 3 checks for that line verbatim.

- [ ] **Step 1: Copy the source file**

```bash
mkdir -p plugins/hean-harness/skills/env-release-pr
cp plugins/hean-harness/skills/release-pr/SKILL.md plugins/hean-harness/skills/env-release-pr/SKILL.md
```

- [ ] **Step 2: Write the failing checks**

Create a scratch folder, then save the script below as `"$T"/check-skill.sh` (not in the repository):

```bash
T=$(mktemp -d) || exit 1; [ -n "$T" ] && [ -d "$T" ] || exit 1
```

```bash
#!/bin/bash
F=plugins/hean-harness/skills/env-release-pr/SKILL.md
fail=0
no()  { if grep -nE -- "$1" "$F"; then echo "FAIL: found $1"; fail=1; fi; }
has() { grep -qE -- "$1" "$F" || { echo "FAIL: missing $1"; fail=1; }; }
stale=$(grep -n 'release-pr' "$F" | grep -v 'env-release-pr')
[ -z "$stale" ] || { echo "FAIL: names release-pr:"; echo "$stale"; fail=1; }
no '^[[:space:]]+--assignee @me'
no '^[[:space:]]+--(add-)?(assignee|reviewer) [^<]'
has '^## Assignees and reviewers$'
has '^- \*\*People\*\* — '
no 'REWS'
has '^name: env-release-pr$'
has '^when_to_use: '
has '^arguments: \[kind, pr\]$'
has '^## Phase 0 — Settle the kind$'
has 'needs input: kind — uat \(integration → release\) or prod \(release → master\)'
has 'env-release-pr/output/\{KIND_FILE\}-\{DEPLOY_DATE\}\.md'
has '^Work ID \| Subject \| Assignee \| Sprint$'
has '^-- \| -- \| -- \| -- \|$'
len=$(awk '/^description: |^when_to_use: /' "$F" | sed -E 's/^(description|when_to_use): //' | tr -d '\n' | wc -c)
[ "$len" -lt 1536 ] || { echo "FAIL: listing $len chars"; fail=1; }
words=$(awk '/^description: /' "$F" | sed 's/^description: //' | wc -w)
{ [ "$words" -ge 20 ] && [ "$words" -le 50 ]; } || { echo "FAIL: description $words words"; fail=1; }
[ $fail = 0 ] && echo PASS
```

- [ ] **Step 3: Run the checks to see them fail**

Run: `bash "$T"/check-skill.sh`
Expected: several `FAIL:` lines (the copy still says `release-pr`, has `--assignee @me`, has no Phase 0).

- [ ] **Step 4: Replace the frontmatter (source lines 1–4)**

Replace the opening frontmatter block with:

```yaml
---
name: env-release-pr
description: Release-train deployment PR for either environment — UAT (integration into release) or Production (release into master) — dedupes the commit range into one row per Linear story with title, assignee and sprint, names hotfix-deployed stories out loud, then opens or updates the PR
when_to_use: Any request to open, create, raise, draft, refresh or update a deployment PR between the long-lived branches — "UAT deployment PR", "UAT Deployment {PROJECT}.{date}", "Production Release PR", "prod release", "open the release PR into master", "merge release into master", "deploy integration to UAT", "update the release PR body" — and any agent that needs one, passing uat or prod. Not for story PRs from work-* or hotfix-* into integration, which create-pr opens, nor the three PRs uat-hotfix opens.
argument-hint: "[uat|prod] [PR number] [--assignee <login>] [--reviewer <login>]"
arguments: [kind, pr]
---
```

- [ ] **Step 5: Replace the introduction (source lines 9–18)**

Replace from `You are executing the \`/release-pr\` skill.` through the paragraph ending `it is reached only when the user has nothing further to raise.` with:

```markdown
You are executing the `/hean-harness:env-release-pr` skill. Work through the phases below in order.

This skill opens or updates the deployment PR between two long-lived branches, for one of two kinds:

| Kind | `HEAD` | `BASE` | PR |
|---|---|---|---|
| `uat` | `integration` (a hotfix re-deploy substitutes `hotfix-{WORK-ID}`) | `release` | the periodic UAT deployment PR |
| `prod` | `release` | `master` | the Production Release PR |

Phase 0 settles the kind before any git or GitHub call. Once it is settled, the branch pair is fixed: no request wording redirects it, including words that name a deployment target or environment.

A PR from a `work-{WORK-ID}` or `hotfix-{WORK-ID}` branch into `integration` is a story PR, not a deployment PR. Do not use this skill for it. The three PRs `uat-hotfix` opens are not this skill's either.

The same phases cover opening a new deployment PR and updating an existing one. Phase 1 decides which mode applies from the request's intent; Phases 6, 7, and 8 each behave differently under it. Every other phase is identical for both kinds and both modes, and the row set is derived the same way in all of them.

Phase 9 is separate from all of that. It offers to remove the worktree the run happened in, and it is reached only when the user has nothing further to raise.
```

- [ ] **Step 6: Insert Phase 0 directly above `## Phase 1 — Resolve inputs and verify refs`**

```markdown
## Phase 0 — Settle the kind

Settle the kind before any git or GitHub call. The first rule that decides wins:

1. **Argument.** `$kind` is `uat`, `prod` or `production` (`production` means `prod`). Any other value decides nothing.
2. **An existing PR.** The request names a PR by number (`$pr` when it is all digits, or a number in its words) or by title. Read its base branch:

   ```bash
   gh pr view {PR} --json baseRefName,title --jq '.baseRefName + " " + .title'
   ```

   `release` → `uat`. `master` → `prod`. Any other base: stop and tell the user this PR is not a deployment PR, naming its base. This PR is also `PR_NUMBER` for Phase 1, so the run is in update mode.
3. **Words in the request.** "UAT" → `uat`. "prod", "production" or "master" → `prod`. Words for both kinds, or for neither, decide nothing. "release" alone decides nothing: it appears in "Production Release" and is also the UAT base branch.
4. **Ask.** When no rule decided:
   - `AskUserQuestion` is in your tool list → ask one question with it: "UAT (`integration` → `release`) or Production (`release` → `master`)?"
   - `AskUserQuestion` is not in your tool list → you are running inside a subagent, where Claude Code removes that tool. Stop now, before any git or GitHub call, and return exactly this line to your caller:

     `needs input: kind — uat (integration → release) or prod (release → master)`

     The caller asks the user, or calls again with `uat` or `prod`.

**When two sources disagree, stop.** A `$kind` or request words that name one kind and a named PR whose base belongs to the other: report both facts and ask which is meant. Never pick one.

**Never decide the kind from** the current branch, which PRs happen to be open, the calendar or the release cadence, or an earlier PR's body. Each can point either way, and a wrong guess opens a PR into the wrong environment.

Set `{KIND_FILE}` from the kind: `uat` → `uat`, `prod` → `production`. It names the review file in Phases 7 to 9.

Phase 6 states the kind and both branches every run, including when the request decided it.
```

- [ ] **Step 7: Replace the `BASE` and `HEAD` bullets in Phase 1 (source lines 55–56)**

Replace the two bullets starting `- \`BASE\` — always \`release\`.` and `- \`HEAD\` — \`integration\`, except for a hotfix re-deploy` with:

```markdown
- `BASE` — `release` for `uat`, `master` for `prod`, from the kind Phase 0 settled. There is no other value: never infer, substitute, or resolve it from a branch→environment mapping table or from deployment-target language in the request.
- `HEAD` — for `uat`, `integration`, except for a hotfix re-deploy, where it is that hotfix's `hotfix-{WORK-ID}` branch instead; for `prod`, always `release`, because a production hotfix also reaches `master` through `release`. Every later phase is unchanged. Confirm the kind and both branches at the Phase 6 checkpoint regardless — stating them back to the user catches a mismatched request before Phase 2 computes a range from the wrong pair.
```

In the `PR_NUMBER` bullet that follows, append this sentence at its end: `When Phase 0 already read a PR, that PR is PR_NUMBER.`

- [ ] **Step 8: Replace the suffix rules in Phase 6 (source lines 262–265)**

Replace from `Two things drive a suffix, and they are independent:` through the bullet ending `This is the same-day re-cut case.` with:

```markdown
Two things drive a suffix, and they are independent:

- `HEAD` is a `hotfix-*` branch (`uat` only) → append ` (Fixes)`. The suffix marks the deployment as a fix, not a same-day counter, and appears on hotfix deployments that are the only deployment for their date.
- A PR with the identical title already exists:
  - `uat` → append ` (Fixes)`, then ` (Extra Fixes)` for a third. This is the same-day re-cut case.
  - `prod` → list the suffixes this repository's earlier production titles in the `gh pr list` result used — for example ` (Fixes)`, ` v2`, ` (fix)`, ` (Hotfix)` — and ask which to append, as its own numbered question. Never pick one.
```

In the same phase, replace the bullet `- **Range** — the two branches and how many work IDs are in the range.` with:

```markdown
- **Range** — the kind (`uat` or `prod`), the two branches, and how many work IDs are in the range.
- **People** — the assignees and reviewers the requester named, or `none`.
```

- [ ] **Step 9: Point every review-file path at the new folder**

Replace each `.claude/skills/release-pr/output/release-{DEPLOY_DATE}.md` with `.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md` (six places: Phase 7 write and check, Phase 8 create and both edit blocks, Phase 9 Step 4 `REL=`). Replace `` `release-{DEPLOY_DATE}.md` path `` in Phase 7 with `` `{KIND_FILE}-{DEPLOY_DATE}.md` path ``.

- [ ] **Step 10: Add the "Assignees and reviewers" section and change Phase 8**

Insert this section directly above `## Phase 8 — Open or update the PR`:

```markdown
## Assignees and reviewers

Release champions lead UAT and Production releases, and any developer may open the PR. So the skill never chooses people itself: it adds no assignee and no reviewer of its own, and never assigns `@me` because the person running it opened the PR.

It passes only the people the requester names. The requester is the user, or the agent that called the skill.

- **Arguments:** `--assignee <login>` and `--reviewer <login>`, each repeatable; a comma-separated list also works.
- **Words:** the requester's own request naming who to assign or ask for review — "assign it to <login>", "request review from <login>".
- **`@me`:** only when the requester writes `@me` or asks to be assigned.

Never take people from earlier release PRs, CODEOWNERS, commit authors, Linear assignees, or the GitHub account running the session.

Collect them in Phase 1 and show them at the Phase 6 checkpoint as **People**, or `none`.
```

Replace the create block's command with:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
gh pr create \
  --base {BASE} \
  --head {HEAD} \
  --title "{PR_TITLE}" \
  --body-file "$BODY_FILE"
```

Directly under it add: `Append one \`--assignee <login>\` per named assignee and one \`--reviewer <login>\` per named reviewer. With nobody named, run the command as shown: the PR opens unassigned with no reviewers.`

Replace everything from `**Updating an existing PR** — \`PR_NUMBER\` set:` through the paragraph starting `**Pass only \`--body-file\` on edit` with:

````markdown
**Updating an existing PR** — `PR_NUMBER` set:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BODY_FILE="$REPO_ROOT/.claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
gh pr edit {PR_NUMBER} \
  --body-file "$BODY_FILE"
```

Append one `--add-assignee <login>` per named assignee and one `--add-reviewer <login>` per named reviewer. Never pass `--remove-assignee` or `--remove-reviewer`: people already on the PR stay.

**Pass only `--body-file` on edit, plus the named people.** Never pass `--title`, even when it appears unchanged — the title is the deployment's scheduled identity and this skill has no reason to rewrite it. Never pass `--base` or `--head` either; retargeting an open deployment PR is not this skill's job.
````

In Phase 1, add this bullet after the `PR_NUMBER` bullet:

```markdown
- `ASSIGNEES` and `REVIEWERS` — only the people the requester named, by the rules in "Assignees and reviewers". Usually empty. `$pr` counts as a PR number only when it is all digits, so `prod --assignee <login>` never reads `--assignee` as a PR.
```

- [ ] **Step 11: Update the Verification list**

Replace the bullet starting `` - `gh pr create` returned a URL `` with:

```markdown
- `gh pr create` returned a URL and the new PR has exactly the assignees and reviewers the requester named (none when none were named), or `gh pr edit` succeeded and re-reading the PR shows the intended body, an unchanged title, the earlier assignees and reviewers, and any named ones added.
- The kind was settled by a Phase 0 rule, never by the current branch, open PRs or the calendar, and the checkpoint stated it with both branches.
```

- [ ] **Step 12: Update the Common mistakes table**

Replace the row starting `| Deployment/environment wording ("prod", "master", "production") read as an instruction to change \`BASE\`` with:

```markdown
| Deployment wording read as an instruction to change `BASE` after the kind is settled | Phase 0 settles the kind once; `BASE` and `HEAD` follow from it and nothing later redirects them |
| Kind guessed from the current branch, open PRs or the calendar | Only the Phase 0 rules decide; otherwise ask, or return the needs-input line to the caller |
| Kind question attempted inside a subagent | `AskUserQuestion` is absent there; return the needs-input line before any git or GitHub call |
| A `prod` request and a PR based on `release` resolved by picking one | Stop, report both, and ask |
```

Replace the row starting ``| `--title` passed to `gh pr edit` `` with:

```markdown
| `--title` passed to `gh pr edit` | Body plus named people only; the title is the deployment's identity |
| `--assignee @me` added because the person running the skill opened the PR | Release champions lead releases; pass only people the requester named |
| Assignees or reviewers copied from an earlier release PR, CODEOWNERS or Linear | Only the requester's arguments or words name people |
| `--remove-assignee` or `--remove-reviewer` on update | People already on the PR stay |
```

- [ ] **Step 13: Run the checks to see them pass**

Run: `bash "$T"/check-skill.sh`
Expected: `PASS`. Then confirm the source is untouched: `git diff --quiet -- plugins/hean-harness/skills/release-pr/SKILL.md && echo UNTOUCHED` prints `UNTOUCHED`.

- [ ] **Step 14: Commit**

```bash
git add plugins/hean-harness/skills/env-release-pr/SKILL.md
git commit -m "@HEAN-1: Add the env-release-pr skill for UAT and Production"
```

### Task 2: Turn off `release-pr` and point other files at `env-release-pr`

**Files:**
- Rename: `plugins/hean-harness/skills/release-pr/SKILL.md` → `plugins/hean-harness/skills/release-pr/SKILL.mdx`
- Modify: `plugins/hean-harness/skills/create-pr/SKILL.md:3,9`
- Modify: `plugins/hean-harness/skills/update-pr/SKILL.md:8`
- Modify: `plugins/hean-harness/skills/open-work-report/SKILL.md:10,12,64,80,112`
- Modify: `plugins/hean-harness/skills/open-work-report/scripts/open-work.mjs:72` (comment)
- Modify: `plugins/hean-harness/skills/open-work-report/__tests__/verify-open-work.mjs:21` (comment)
- Modify: `plugins/hean-harness/skills/org-roles/SKILL.md:46`
- Modify: `plugins/hean-harness/assets/rules/project/linear-story-resolution.md` frontmatter `paths:`
- Modify: `docs/wiki-coverage.md:27`

**Interfaces:**
- Consumes: the skill name `env-release-pr` from Task 1.
- Produces: no loadable `release-pr` skill.

- [ ] **Step 1: Write the failing checks**

Create a scratch folder with `T=$(mktemp -d) || exit 1; [ -n "$T" ] && [ -d "$T" ] || exit 1`, then save as `"$T"/check-refs.sh`:

```bash
#!/bin/bash
fail=0
P=plugins/hean-harness
[ -f $P/skills/release-pr/SKILL.mdx ] && [ ! -e $P/skills/release-pr/SKILL.md ] || { echo "FAIL: rename"; fail=1; }
hits=$(grep -rn 'release-pr' $P --exclude=SKILL.mdx | grep -v 'env-release-pr' | grep -v '"\*\*/skills/release-pr/\*\*"')
[ -z "$hits" ] || { echo "FAIL: stale references:"; echo "$hits"; fail=1; }
grep -q '"\*\*/skills/env-release-pr/\*\*"' $P/assets/rules/project/linear-story-resolution.md || { echo "FAIL: rule paths"; fail=1; }
grep -q '^| env-release-pr | Skills | pending |$' docs/wiki-coverage.md || { echo "FAIL: coverage row"; fail=1; }
grep -q '^| release-pr | Skills | excluded (turned off, SKILL.mdx) |$' docs/wiki-coverage.md || { echo "FAIL: release-pr row"; fail=1; }
[ $fail = 0 ] && echo PASS
```

- [ ] **Step 2: Run them to see them fail**

Run: `bash "$T"/check-refs.sh`
Expected: `FAIL: rename` and a list of stale references.

- [ ] **Step 3: Rename without changing content**

```bash
git mv plugins/hean-harness/skills/release-pr/SKILL.md plugins/hean-harness/skills/release-pr/SKILL.mdx
```

- [ ] **Step 4: Swap the references**

- `create-pr/SKILL.md` line 3 and line 9: `except PRs release-pr, uat-hotfix or version-bump open` → `except PRs env-release-pr, uat-hotfix or version-bump open`; `except a PR that release-pr, uat-hotfix or version-bump opens` → `except a PR that env-release-pr, uat-hotfix or version-bump opens`.
- `update-pr/SKILL.md` line 8: `except a PR that release-pr, uat-hotfix` → `except a PR that env-release-pr, uat-hotfix`.
- `open-work-report/SKILL.md`: every `` `/release-pr` `` → `` `/hean-harness:env-release-pr` `` (lines 10, 12, 64, 80, 112). On line 12 replace `that skill computes \`origin/release..origin/integration\` for the UAT deployment` with `that skill computes \`origin/release..origin/integration\` for the UAT deployment and \`origin/master..origin/release\` for the Production Release`.
- `open-work-report/scripts/open-work.mjs` line 72: `identical in intent to release-pr` → `identical in intent to env-release-pr`.
- `open-work-report/__tests__/verify-open-work.mjs` line 21: `disjoint from /release-pr.` → `disjoint from /hean-harness:env-release-pr.`
- `org-roles/SKILL.md` line 46: `` or a skill such as `release-pr`. `` → `` or a skill such as `env-release-pr`. ``
- `assets/rules/project/linear-story-resolution.md`: add the line `  - "**/skills/env-release-pr/**"` directly below `  - "**/skills/release-pr/**"`.
- `docs/wiki-coverage.md` line 27: `| release-pr | Skills | documented |` → `| release-pr | Skills | excluded (turned off, SKILL.mdx) |`, and add `| env-release-pr | Skills | pending |` on the line below it.

- [ ] **Step 5: Run the checks and the existing open-work check**

Run: `bash "$T"/check-refs.sh`
Expected: `PASS`.
Run: `git diff -M --stat HEAD -- plugins/hean-harness/skills/release-pr/` 
Expected: one line showing `SKILL.md => SKILL.mdx` with `0` insertions and `0` deletions.
Run: `node plugins/hean-harness/skills/open-work-report/__tests__/verify-open-work.mjs`
Expected: the same pass result it gives on `main` (run it on `main` first if unsure).

- [ ] **Step 6: Commit**

```bash
git add plugins/hean-harness/skills/release-pr plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md plugins/hean-harness/skills/open-work-report plugins/hean-harness/skills/org-roles/SKILL.md plugins/hean-harness/assets/rules/project/linear-story-resolution.md docs/wiki-coverage.md
git commit -m "@HEAN-1: Turn off release-pr and name env-release-pr instead"
```

### Task 3: Check routing with headless sessions

**Files:**
- No repository file changes. Write the evidence to `"$T"/routing-report.md` and report its path and contents to the caller.

**Interfaces:**
- Consumes: the skill from Task 1 and the rename from Task 2; the exact line `needs input: kind — uat (integration → release) or prod (release → master)`.
- Produces: the routing report.

- [ ] **Step 1: Build a throwaway repository with no remote**

```bash
T=$(mktemp -d) || exit 1; [ -n "$T" ] && [ -d "$T" ] || exit 1
R="$T/repo"; mkdir "$R" && git -C "$R" init -q -b master
echo '{"packageDirectories":[{"path":"force-app","default":true}]}' > "$R/sfdx-project.json"
git -C "$R" add . && git -C "$R" -c user.name=t -c user.email=t@example.com commit -qm "@ABC-1: Add the project"
git -C "$R" branch release && git -C "$R" branch integration
```

- [ ] **Step 2: Confirm the session loads the working copy's skills**

Run from `"$R"`:

```bash
claude -p "List the names of every hean-harness skill you can use, one per line." --model haiku \
  --plugin-dir /Users/d.min/git-repos/hean-sfdx-harness-system/plugins/hean-harness \
  --dangerously-skip-permissions --output-format stream-json --verbose < /dev/null > "$T/init.jsonl"
jq -r 'select(.type=="system" and .subtype=="init") | ((.skills // []) + (.slash_commands // []))[]' "$T/init.jsonl" | grep -E 'release-pr'
```

Expected: `hean-harness:env-release-pr` and no `hean-harness:release-pr`. If `hean-harness:release-pr` is listed, the installed plugin is also loaded: write `"$T/settings.json"` containing `{"enabledPlugins":{"hean-harness@hean-sfdx-harness-system":false}}`, add `--settings "$T/settings.json"` to every `claude -p` call in this task, and repeat this step until the expected result holds.

- [ ] **Step 3: Run the four prompts**

For each prompt below, run from `"$R"` with the same flags as Step 2 (plus `--settings` if Step 2 needed it), saving to `"$T/run-N.jsonl"`:

1. `open the Production Release PR`
2. `open the UAT deployment PR`
3. `open the release PR`
4. `Use the Agent tool to start a general-purpose subagent whose whole prompt is "open the release PR". Then print the subagent's final message verbatim.`

For each run, extract the skills invoked, the tools used, and the final text:

```bash
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name + " " + ((.input.skill // .input.command // "")|tostring|.[:120])' "$T/run-N.jsonl"
jq -r 'select(.type=="result") | .result' "$T/run-N.jsonl"
```

- [ ] **Step 4: Compare with the expected results**

| Run | Expected |
|---|---|
| 1 | `Skill hean-harness:env-release-pr`; no `AskUserQuestion`; the run states the kind as Production (`release` → `master`) and stops at the ref freshness check because the repository has no remote |
| 2 | same, with UAT (`integration` → `release`) |
| 3 | `Skill hean-harness:env-release-pr`, then an `AskUserQuestion` tool call asking UAT or Production. If the init event's tool list has no `AskUserQuestion` in `-p` mode, the final text carries the `needs input: kind …` line instead |
| 4 | the subagent's final message contains `needs input: kind — uat (integration → release) or prod (release → master)`, and no `git fetch` or `gh` call ran inside the subagent |
| all | no `Skill hean-harness:release-pr` and no `Skill hean-harness:create-pr` |

Any mismatch: fix the wording in `env-release-pr/SKILL.md` (frontmatter or Phase 0) and rerun the affected prompt. After 3 failed attempts on the same mismatch, stop and report it with the transcripts.

- [ ] **Step 5: Write the report and clean up**

Write `"$T/routing-report.md"` with one section per run: the prompt, the tool lines, the final text, and PASS or FAIL against the table. Report its full content to the caller. Remove `"$T"` only after the content has been reported, and only when it starts with `/var/folders` or `/tmp`.

## After the tasks

1. Run the full test loop once, in the background or with a timeout above 600 s:
   `for t in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do node "$t"; done`
   Every file passes. Then `ps -axo pid,ppid,etime,command | grep -E "check-environment|ego-browser nodejs|test\.mjs|setup\.mjs" | grep -v grep` prints nothing.
2. Run `/hean-harness:finish-implementation` and list every file created, changed or renamed.
3. Release only on the user's own message containing "commit": change commits by path, then `version` → `0.1.51` in `plugins/hean-harness/.claude-plugin/plugin.json` in its own commit, tag `hean-harness-v0.1.51`, push, update this machine's plugin, and brief `hean-wiki` for an `env-release-pr` Skills entry and the `release-pr` entry marked turned off.
