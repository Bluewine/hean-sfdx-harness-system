---
name: create-pr
description: GitHub PR assembler for every PR request on any base branch, except PRs release-pr, uat-hotfix or version-bump open — resolves the base branch and Linear stories, generates diff bullets, splits Sonar-fix and Framework-change bullets, detects runbook steps, asks for manual ones, writes the review body, then calls gh pr create
argument-hint: "[--base <branch>]"
---

You are executing the `/create-pr` skill. Work through the phases below in order.

Every request to open, create or raise a pull request runs this skill, whatever the target branch, except a PR that release-pr, uat-hotfix or version-bump opens or edits as one of its own steps. A PR body not rendered from this skill's template is wrong; never write one by hand and call `gh pr create` directly.

## Phase 0 — Base branch

Resolve `BASE`, the branch this PR merges into, before any other work:

- `--base <branch>` in the skill arguments sets `BASE`.
- Otherwise a branch the user named in their request as the PR target or merge base sets `BASE`.
- Otherwise `BASE` is `integration`.
- Strip a leading `origin/` from a user-given branch name: `origin/work-ABC-20-HF` becomes `work-ABC-20-HF`.

Fetch it and confirm the remote-tracking ref resolves:

```bash
git fetch origin "+refs/heads/{BASE}:refs/remotes/origin/{BASE}"
git rev-parse --verify --quiet "refs/remotes/origin/{BASE}"
```

If the fetch fails or `git rev-parse` prints nothing, stop and tell the user: "Base branch `{BASE}` does not exist on origin. Name an existing branch with `--base <branch>`."

Every later `{BASE}` in this skill is this value: merge-bases, diffs and commit ranges compare against `origin/{BASE}`, and Phase 9 submits with `--base {BASE}`.

## Phase 1 — Extract branch work ID

Run:
```bash
git branch --show-current
```

Apply regex `^work-([A-Z]+-\d+)` to the output. The captured group is the branch work ID, `BRANCH_WORK_ID` (e.g. `ABC-20`).

If the branch name does not match the pattern, stop and tell the user: "Branch name does not follow the `work-{WORK-ID}_...` pattern. Rename the branch or create a PR manually."

This `BRANCH_WORK_ID` is used only as the branch-name validation gate. PR identity (title, filename) is set later from the root story group, not from this value; the base is `BASE` from Phase 0.

## Phase 2 — Detect story groups

A branch may contain a root story plus one or more merged child branches, each a distinct Linear work ID. Group the branch's commits by their `@WORK-ID:` subject prefix.

**Compare against the remote base.** Every merge-base in this skill is computed against `origin/{BASE}`, never the local `{BASE}` branch, and the Phase 0 fetch makes that remote-tracking ref current before the first one runs.

The Phase 0 fetch is a fetch, not a pull. It updates only the remote-tracking ref `origin/{BASE}` — it does not touch the working tree, the local `{BASE}` branch, or the work branch, and it never requires rebasing the work branch onto a newer `{BASE}`.

It matters when work has been merged into **both** `{BASE}` and this branch — a merged child branch, for example. A stale local ref then places the merge-base before those merge commits, so already-merged stories look unmerged and get rendered as extra stories. The PR body would describe work that GitHub's own diff does not show, because GitHub compares against the remote base. When `{BASE}` has simply advanced with commits absent from this branch, fetching changes nothing: the merge-base stays at the fork point either way.

Run:
```bash
MB=$(git merge-base origin/{BASE} HEAD)
git diff --name-status "$MB" HEAD
```

If the diff is empty, stop and tell the user: "No changes found between this branch and `{BASE}`. Nothing to PR."

Compute the ordered, de-duplicated list of work-ID groups (first appearance first):
```bash
MB=$(git merge-base origin/{BASE} HEAD)
git log --no-merges --reverse --topo-order --format='%s' "$MB"..HEAD \
  | sed -nE 's/^@([A-Z]+-[0-9]+):.*/\1/p' | awk '!seen[$0]++'
```

- `--no-merges` excludes merge commits, including back-merges of `integration` (`@XXX: Merge integration`), so they never form a story.
- `merge-base` moves forward past any back-merged `{BASE}` commits, so upstream commits do not leak into a group.
- The first line is `ROOT_WORK_ID` — the root branch, rendered as **Story 1**. Each subsequent line is the next story in order.
- `STORY_COUNT` is the number of lines.

Defensive fallback: every non-merge commit is expected to carry an `@WORK-ID:` prefix. If a commit's subject does not match, assign that commit to the root group (Story 1). Do not treat this as normal.

If `STORY_COUNT` is 1, this is a single-story PR (Phase 7 uses `pr-body.md`). If `STORY_COUNT` is 2 or more, it is multi-story (Phase 7 uses `pr-body-multiple.md`). If `STORY_COUNT` is 0 (no commit carries an `@WORK-ID:` prefix — not expected), set `ROOT_WORK_ID` to `BRANCH_WORK_ID` from Phase 1, create one synthetic root group (work ID `BRANCH_WORK_ID`) containing every commit in range, and treat it as a single-story PR — Phases 3–7 then resolve and render that single group normally.

## Phase 3 — Resolve story title and Linear URL

Read `.claude/rules/linear-story-resolution.md` first.

For **each** work-ID group from Phase 2 (root first), resolve its Linear metadata. Repeat the steps below once per group and keep the results keyed by work ID.

**Check Linear MCP availability:** attempt a Linear MCP tool call (search or fetch issue by ID). If it responds successfully, fetch per work ID. If unavailable or an auth error, use the manual fallback.

**Linear MCP available** (per group):
- Fetch the issue title → `TITLE`.
- Fetch the issue URL → `LINEAR_URL`.
- Fetch the full description → `ISSUE_DESCRIPTION`.

**Linear MCP unavailable** (per group, asking one message per work ID):
```
Linear MCP is not connected. For {WORK-ID}, please provide:
1. Issue title:
2. Linear issue URL (copy from browser):
3. Issue description or requirements (paste from Linear):
```
Wait for the response; use the values verbatim. If any value is empty, re-ask for that value until provided.

The root group's title is `ROOT_TITLE` and its work ID is `ROOT_WORK_ID`; these drive the PR title and body filename in Phase 8/9.

## Phase 4 — Generate "What was Done?" bullets and Sonar Fix bullets

Build one authoritative net-status map for the whole branch, then generate intent-based bullets for **each** group from that group's files plus its `ISSUE_DESCRIPTION`.

Net-status map (clean net status per file, the same source the single-story path uses):
```bash
MB=$(git merge-base origin/{BASE} HEAD)
git diff --name-status "$MB" HEAD
```
Read this into a `{ file → A|M|D|R }` map.

Per-group membership (which files each story touched):
```bash
MB=$(git merge-base origin/{BASE} HEAD)
# the group's commits:
git log --no-merges --reverse --topo-order --format='%H %s' "$MB"..HEAD
# files for one commit (no commit header, status + path only):
git diff-tree --no-commit-id --name-status -r <SHA>
```
For each group, a commit belongs to it when its subject matches `@<WORK-ID>:`. Non-matching commits belong to the root group.

**Split each group's commits into a main bucket, a Sonar bucket, and a Framework bucket.** A commit falls into the Sonar bucket when its subject, after stripping the `@WORK-ID:` prefix, matches `/^\[Sonar\] /` — case-sensitive, anchored to the start: the literal tag `[Sonar] ` must be the first thing after the `@WORK-ID:` prefix, per the opt-in tag convention in `.claude/rules/commit-message-format.md`. A commit that merely mentions "Sonar" elsewhere in its subject (case-insensitively or not) does not qualify — this is deliberately strict so commits about the *concept* of Sonar (e.g. documenting the tag convention itself) don't get miscategorized as fixes. A commit not already in the Sonar bucket falls into the Framework bucket when none of its files (per `git diff-tree`) are under `force-app/` — i.e. every file it touches is repo tooling (`.claude/`, dotfiles, root config) rather than the Salesforce deliverable. Every other commit stays in the main bucket. Exception: if every commit in a group would land outside the main bucket, keep them in the main bucket instead — a story must never render an empty "What was Done?" section.

The group's main-bucket file set is the union of `git diff-tree` paths across its main-bucket commits. The group's Framework-bucket file set is the union of `git diff-tree` paths across its Framework-bucket commits. For each file in either set, take its status from the **net-status map**, never from `git diff-tree`. If a file is absent from the net map (added then later deleted within the branch), drop it. A file touched by both the root and a child appears in both stories' bullets — once per story — which is intended.

Generate main bullets for each group using its main-bucket file set + that group's `ISSUE_DESCRIPTION`, following these rules:
- Group all files serving the same story intent into a single bullet, even across metadata types.
- **Roll up internal details of a net-new artifact.** When a file is an internal detail of another file in the same set that is itself net-new (status `A`) — a new LWC's own CSS/HTML/test files, a helper class created solely for a new component, an attribute or markup change inside a component being added for the first time — describe it within that artifact's own bullet, not as a separate bullet. Give a change its own bullet only when it is a capability a reviewer needs to evaluate independently (e.g. a shared service class other callers depend on, a distinct object/profile/permission change).
- Each bullet is a short past-tense phrase describing what was accomplished, not what files changed.
- Use the story description to name the intent accurately.
- Files matching no requirement (e.g. `.claude/` config) → one trailing bullet: "Updated project configuration".
- Aim for 3–7 bullets per story; consolidate closely related bullets before exceeding 7 — only exceed it when the extra items are genuinely unrelated capabilities that would lose meaning if combined.
- Wrap any Salesforce API identifier in backticks (field references, object names used technically, metadata artifact names, Apex/Flow/Label/LWC names). Plain-English Salesforce concepts ("permission set", "record type", "flow") stay unformatted.
- Verb selection from net status: `A` → **Add**/**Create**/**Introduce** (describe the capability, not an incremental change); `M` → **Update**/**Extend**/**Migrate** (describe what changed). When a bullet groups both `A` and `M` files, the verb follows the primary artifact's status.
- **State the fact, not a defense of it.** A bullet reports what changed; it does not pre-empt or argue against a hypothetical reviewer objection (e.g. no "...so this is expected, not a leftover file" framing). If a design choice genuinely needs explaining (e.g. why a change is split across two files), state the reason plainly and stop — don't editorialize about how it should be perceived.

Generate `SONAR_BULLETS` for each group from its Sonar-bucket commits only: one short past-tense bullet per commit, derived from the commit subject, identifiers wrapped in backticks under the same convention as main bullets. Merge two commits into one bullet only when they clearly describe the same fix. If a group's Sonar bucket is empty, its `SONAR_BULLETS` is empty — Phase 7 omits the Sonar Fixes block for that story.

Generate `FRAMEWORK_BULLETS` for each group from its Framework-bucket file set the same way main bullets are generated (group by intent, one bullet per distinct change, identifiers wrapped in backticks). If a group's Framework bucket is empty, its `FRAMEWORK_BULLETS` is empty — Phase 7 omits the Framework Changes block for that story.

## Phase 5 — Pre and post deployment steps

For **each** work-ID group from Phase 2 (root first), assemble that group's deployment steps and keep them keyed by work ID as `DEPLOYMENT_STEPS`. Automatic steps are detected from the branch; manual steps are asked for.

**Step 1 — Detect the automatic steps.**

Take the group's own file set (the union of its `git diff-tree` paths across every bucket), reading each file's status from the net-status map, and derive one row per item found by the Automatic rows table in `.claude/rules/runbook-deployment-steps.md`. That rule is the single source of truth for which paths produce which rows, how to describe a runbook script, and how to diff the destructive manifests against the merge base — follow it rather than restating it here.

**Step 2 — Ask for the manual steps.**

Ask once per group, in a single `AskUserQuestion` call with `multiSelect` enabled, following the Manual rows policy in `.claude/rules/runbook-deployment-steps.md` — that rule states when to ask, when to skip because the user already named the steps, which recurring candidates to offer, and what must never be rendered.

**Step 3 — Build the group's rows.**

If Steps 1 and 2 together produced no rows, that group's `DEPLOYMENT_STEPS` is empty and Phase 7 omits the section for that story. Otherwise build one table per stage that has rows, in the shape and ordering the rule defines, and apply its Omission section to decide what may not be written.

## Phase 6 — Screenshots (optional, per story)

For **each** work-ID group from Phase 2 (root first), ask:
```
Add screenshots to Story {N} ({WORK-ID}: {TITLE})? (yes/no)
```
If the answer is anything other than an explicit yes, set that group's `SCREENSHOTS` to empty and move to the next group — Phase 7 omits the Screenshots block for that story. Each group's screenshots are independent; answering no for one group does not skip the question for the next.

If yes for a group, collect one or more screenshots for it. Repeat Steps 1–3 per screenshot; stop when the user answers no to "Any more screenshots?" in Step 3.

**Step 1 — What to capture.**
```
Which area should this screenshot cover — the entire page, a specific window, or a specific section/component?
```
Record the answer as `CAPTURE_TARGET`.

**Step 2 — Capture the image.**

Check whether Playwright MCP browser tools are available in this session.

Playwright available:
- Ask for the page URL if it was not already given earlier in this conversation → `TARGET_URL`.
- Ask for login credentials if the page requires them and they were not already given → `CREDENTIALS`. State plainly that credentials are typed into the live browser session only, never stored or logged.
- Navigate to `TARGET_URL`, sign in if `CREDENTIALS` were given, then take a page snapshot to locate `CAPTURE_TARGET` if it names a specific element.
- Take the screenshot: full page when `CAPTURE_TARGET` is "entire page"/"window", scoped to the located element otherwise. Save it to a temporary file.

Playwright unavailable, or the capture attempt fails:
```
I can't capture that automatically. Provide either:
1. A file path to an existing screenshot, or
2. Paste the image from your clipboard.
```
- File path → use as-is.
- Clipboard paste → `pbpaste` does not handle images; extract the clipboard image to a temp PNG via `osascript` reading the clipboard's PNG class instead.

**Step 3 — Caption and continue.**

Ask for a short caption describing the screenshot → `CAPTION`. Then ask:
```
Any more screenshots?
```
Loop back to Step 1 while yes; otherwise continue.

**Step 4 — Save locally.**

Screenshots stay local and uncommitted. In a private repository they have to: `raw.githubusercontent.com` 404s on anonymous fetch and GitHub's PR-body image proxy fetches anonymously, so a committed image can never render. In a public one it would render, but the image then outlives the PR in the repository's history for no benefit. Copy each captured/provided file into the skill's dedicated, gitignored directory, keyed by this group's own work ID (not the root's):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$REPO_ROOT/.claude/skills/create-pr/output/screenshots/{WORK-ID}"
# copy each captured/provided file into that directory as {WORK-ID}-{index}.{ext}
```

For each screenshot, build one line:
```
- **{CAPTION}** — `{REPO_ROOT}/.claude/skills/create-pr/output/screenshots/{WORK-ID}/{filename}`
```
Concatenate these lines, then append one closing line: "Drag the file(s) above into this PR's description on GitHub to embed them — `gh` CLI can't embed local images directly." Together this is that group's `SCREENSHOTS`.

## Phase 7 — Render and write to review file

Select the template by `STORY_COUNT`.

**Single story (`STORY_COUNT == 1`):** read `${CLAUDE_PLUGIN_ROOT}/skills/create-pr/templates/pr-body.md` and replace `{WORK-ID}` → `ROOT_WORK_ID`, `{TITLE}` → `ROOT_TITLE`, `{LINEAR_URL}` → the root group URL, `{BULLETS}` → the root group main bullets (each prefixed `- `), `{SONAR_BULLETS}` → the root group's Sonar bullets (each prefixed `- `), `{FRAMEWORK_BULLETS}` → the root group's Framework bullets (each prefixed `- `), `{DEPLOYMENT_STEPS}` → the root group's Phase 5 table, `{SCREENSHOTS}` → the root group's Phase 6 output.
- If the root group's `SONAR_BULLETS` is empty, delete the entire block from `### Sonar Fixes` through its following `---` line, both included.
- If the root group's `FRAMEWORK_BULLETS` is empty, delete the entire block from `### Framework Changes` through its following `---` line, both included.
- If the root group's `DEPLOYMENT_STEPS` is empty, delete the entire block from `### Pre and Post Deployment Steps` through its following `---` line, both included.
- If the root group's `SCREENSHOTS` is empty, delete the entire block from `### Screenshots` through its following `---` line, both included.

**Multi-story (`STORY_COUNT >= 2`):** read `${CLAUDE_PLUGIN_ROOT}/skills/create-pr/templates/pr-body-multiple.md`. It contains one repeatable `## Story {N}` block (which itself contains that story's own Screenshots block) and, at the end, one repeatable `Resolves {WORK-ID}` line (ignore the leading instruction comments when rendering). For each group in order, emit one copy of the `## Story {N}` block with:
- `{N}` → 1-based story index (root = 1),
- `{WORK-ID}` → the group work ID,
- `{TITLE}` → the group title,
- `{LINEAR_URL}` → the group URL,
- `{BULLETS}` → the group main bullets (each prefixed `- `),
- `{SONAR_BULLETS}` → the group's Sonar bullets (each prefixed `- `); if empty, delete that story's `### Sonar Fixes` block through its following `---` line, both included.
- `{FRAMEWORK_BULLETS}` → the group's Framework bullets (each prefixed `- `); if empty, delete that story's `### Framework Changes` block through its following `---` line, both included.
- `{DEPLOYMENT_STEPS}` → that group's own Phase 5 table; if empty, delete that story's `### Pre and Post Deployment Steps` block through its following `---` line, both included.
- `{SCREENSHOTS}` → that group's own Phase 6 output; if empty, delete that story's `### Screenshots` block through its following `---` line, both included.
Concatenate the rendered `## Story {N}` blocks in story order, then append one `Resolves {WORK-ID}` line per group in story order — this keeps every Resolves line grouped at the very end of the document, after every story's own content.

**PR identity** comes from the root group, not the branch name:
- `ROOT_WORK_ID` and `ROOT_TITLE` (root group from Phase 2/3).
- **PR title convention:** `@{ROOT_WORK_ID}: {ROOT_TITLE}` — total length ≤77 characters including the `@` sigil, work ID, colon, space, and title. Truncate `ROOT_TITLE` from the right until ≤77.

Derive the repo root and write the rendered body there (never a bare relative path):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$REPO_ROOT/.claude/skills/create-pr/output"
BODY_FILE="$REPO_ROOT/.claude/skills/create-pr/output/{ROOT_WORK_ID}.md"
cat > "$BODY_FILE" << 'EOF'
...
EOF
```

Do not use the Write tool for this file.

Write the PR title as the first line as a comment so the user sees it:

```
<!-- PR Title: @{ROOT_WORK_ID}: {ROOT_TITLE} -->
## Story 1
...
```

(For single-story, the first content line after the comment is `### Story` from `pr-body.md`, unchanged.)

**Verify the rendered body before handing it over.** Read the file back and confirm no Claude attribution reached it:

```bash
BODY_FILE="$(git rev-parse --show-toplevel)/.claude/skills/create-pr/output/{ROOT_WORK_ID}.md"
grep -nEi 'co-authored-by|generated with \[?claude|claude-session|claude\.(ai|com)/(code/session|claude-code)' "$BODY_FILE"
echo "$BODY_FILE:1"
```

Expect no output. The templates carry none of these, so any hit was introduced while rendering — strip the offending lines, including the blank line and any `---` separator that preceded them, rewrite the file, and re-run the check. Never submit a body containing a `Co-Authored-By` trailer, a "Generated with Claude Code" line, or a session URL.

Tell the user:

```
PR body written to {ABSOLUTE_PATH}:1 (base: {BASE})
Review or edit the file, then type `yes` to submit.
```

**Give the path as an absolute path ending in `:1`.** Claude Code turns a `path:line` reference into
something the reader can click straight from the terminal; a bare path is plain text they have to copy
out and open by hand. A relative path resolves against the session's working directory, which is not
always the repository root, so give it in full. `{ABSOLUTE_PATH}` is what a command's closing `echo`
printed. Print exactly one form of the path.

**`BODY_FILE` is set in every command that uses it.** A shell variable does not survive from one
command to the next, so a later command that leans on an earlier one's variable gets an empty string —
and `--body-file ""` publishes an empty body, which reads like the render failed rather than like a
variable was lost.

Wait for the user to type `yes` before proceeding.

## Phase 8 — Check gh CLI

Run:
```bash
which gh
```

If `gh` is not found, install it automatically:
```bash
brew install gh
```

Wait for the install to complete. If it fails, stop and tell the user: "`brew install gh` failed. Install manually and re-run /create-pr."

After install (or if `gh` was already present), run:
```bash
gh auth status
```

If the output shows `github.com` as authenticated, proceed. If not, stop and tell the user: "Run `gh auth login` to authenticate with GitHub, then re-run /create-pr."

## Phase 9 — Submit the PR

**Step 1 — Ensure the branch is pushed and up to date.**

Derive `{owner}/{repo}` from `git remote get-url origin` (strip `git@github.com:` prefix and `.git` suffix). Use the current branch name as `{branch}`.

Run:
```bash
gh api repos/{owner}/{repo}/branches/{branch} 2>/dev/null
git rev-list --count @{u}..HEAD 2>/dev/null
```

If the `gh api` call is a 404 (branch not on the remote yet) or `git rev-list --count @{u}..HEAD` reports 1 or more (local commits not yet pushed), push:
```bash
git push origin {branch}
```
No confirmation needed — this is a non-force push of the user's own feature branch. If the push fails (e.g. diverged history), stop and tell the user: "Push failed — resolve manually (`git pull --rebase` or similar), then re-run `/create-pr`."

**Step 2 — Create the PR.**

```bash
BODY_FILE="$(git rev-parse --show-toplevel)/.claude/skills/create-pr/output/{ROOT_WORK_ID}.md"
gh pr create \
  --base {BASE} \
  --title "@{ROOT_WORK_ID}: {ROOT_TITLE}" \
  --body-file "$BODY_FILE" \
  --assignee @me
```

After the command completes, close with both links, in this order:

```
PR: {PR_URL}
Body: {ABSOLUTE_PATH}:1
```

The PR URL is what was published. The body file is what it was published from, and it stays on disk
after the run — so name it here too rather than leaving the reader to scroll back for it.

## Phase 10 — Wipe local screenshots

Skip this phase entirely if no group collected any screenshots in Phase 6.

For each group that has screenshots, after Phase 9 reports the PR URL, tell the user:
```
Screenshots for Story {N} ({WORK-ID}) saved at: {REPO_ROOT}/.claude/skills/create-pr/output/screenshots/{WORK-ID}/
Drag them into the PR description at {PR_URL} to embed them.
Type `done` once added, or `skip` to leave the files in place.
```

If the user replies `done` (or equivalent confirmation) for that group:
```bash
rm -rf "$REPO_ROOT/.claude/skills/create-pr/output/screenshots/{WORK-ID}"
```

If the user replies `skip` for that group, leave its directory in place and tell them where it is for later manual cleanup. Repeat for every group with screenshots, in story order.
