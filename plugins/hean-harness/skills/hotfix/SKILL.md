---
name: hotfix
description: Hotfix lifecycle driver for UAT-only and UAT + Production hotfixes — a script decides the type and version bumps from package.json versions, then the skill detects the hotfix's phase from git state alone, executes only that phase's steps and stops at its human gate
when_to_use: The user mentions a hotfix for the UAT release branch or for Production, or resumes one mid-flight — "start a UAT hotfix for ABC-123", "Production hotfix for ABC-123", "prod hotfix", "continue the hotfix", "open the hotfix PR", "hotfix PR is merged what next", "back-merge the hotfix into integration" — or makes any PR request while on a `work-{ID}-HF`, `hotfix-{ID}` or `work-{ID}-BM` branch. Pass the work ID as the skill argument, preceded by `uat` or `prod` only when the user names the type; never infer the ID from the branch name. Not for a fix that can wait for the normal release train.
argument-hint: "[uat|prod] <WORK-ID>"
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

You are executing the `/hotfix` skill. Check the hotfix type first, then detect the phase, then execute only that phase.

This skill applies to urgent fixes that must reach the UAT (`release`) environment ahead of the normal release train, and, for a UAT + Production hotfix, Production after it. A change that can wait for the next scheduled `integration` → `release` deployment is not a hotfix; do not use this skill for it.

The hotfix type is never the user's judgement. `hotfix-check.mjs` decides it from the `package.json` `version` on `origin/master` and `origin/release`, or, mid-flight, from the commits this skill writes — the bump commit `@{ID}: Update Release Version to v` means UAT + Production, the swap commit `@{ID}: Point QA swimlane at hotfix branch` without a bump commit means UAT-only; `origin/integration` gives only the back-merge version:

| Type | When | Version bump |
|---|---|---|
| UAT-only | `release` is ahead of `master` | none, anywhere |
| UAT + Production | `release` equals `master` | on `work-{ID}-HF` and on `work-{ID}-BM` |

The lifecycle spans days and four human gates. You will be invoked repeatedly, mid-flight, with no memory of prior runs. Never assume you are starting at Phase 1.

## Nomenclature

| Token | Meaning |
|---|---|
| `{ID}` | Work item ID — Linear (`ABC-###`) or GUS (`W-########`) |
| `{QA_ENV}` | Name of the QA swimlane in `deploy-config.yml` — resolve it once, before anything else |
| `hotfix-{ID}` | Parent branch, cut from `release` |
| `work-{ID}-HF` | Working branch where the fix is written, cut from `hotfix-{ID}` |
| `work-{ID}-BM` | Back-merge branch, cut from `integration` |

Three PRs close the loop:

| PR | Head | Base | Gate |
|---|---|---|---|
| PR 1 | `work-{ID}-HF` | `hotfix-{ID}` | Checks PASS + peer approval |
| PR 2 | `hotfix-{ID}` | `release` | Checks PASS + Team Lead off-cycle window + PO sign-off |
| PR 3 | `work-{ID}-BM` | `integration` | Checks PASS + peer approval |

## Phase 0 — Type check, work ID and phase detection

### Type check — always the first step

**Work ID.** Pass the work ID when the argument or the user's words give it; the script reads a mid-flight hotfix's type from its commits only with it. When none is given and the user is continuing a hotfix (any request other than starting one or asking which type is possible), ask for it first and run nothing. Otherwise run the check without it.

Before any other command, question or probe, run this as one Bash call. Pass `uat` or `prod` only when the argument or the user's words name the type. `--fetch` makes the script run `git fetch --prune origin` first:

```bash
cd "$(git rev-parse --show-toplevel)"
node "${CLAUDE_SKILL_DIR}/scripts/hotfix-check.mjs" --fetch [uat|prod] [<WORK-ID>]
```

Show the output verbatim, in a code block, as the first content of the reply to the user or the calling agent. Then act on the exit code:

| Exit | Verdict | Next |
|---|---|---|
| 2 | `BLOCKED:` | Stop. |
| 1 | `ERROR:` | Stop. A failed fetch is an `ERROR:` too, printed after the versions. |
| 0 | `GO: UAT-only hotfix` | Continue as a UAT-only hotfix. |
| 3 | `GO: UAT + Production hotfix` | Continue as a UAT + Production hotfix. Keep the printed versions for Phases 1, 2 and 4. |

**On BLOCKED or ERROR, the run ends at the output.** Do not call the advisor, spawn a subagent, run another command or probe, retry with another type, or suggest a workaround. The verdict line already says what to do.

### Work ID

**The work ID is an argument. Never derive it from the branch name.** The repo's `^work-([A-Z]+-\d+)` convention returns nothing when HEAD is `hotfix-{ID}`, which is exactly where you stand during Phases 2 and 3. If the user did not supply an ID and the check exits 0 or 3, ask for it after the output and stop. For a second hotfix on a story whose earlier hotfix completed, use a new work item: the earlier hotfix's marker commits already sit on `release` and `integration`, so the same ID reads as that finished hotfix.

### Probe set

Every probe is git-native. Do not use `gh pr list` to determine phase — PR-API calls fail outright when the active `gh` account cannot resolve the repo, which strands the skill before it detects anything. Everything needed is derivable from refs and commit history, which work offline.

**Always resolve a branch through `origin/` first.** A teammate's stale local copy of `hotfix-{ID}` or `work-{ID}-BM` reports old file contents and old history, which silently mis-routes the phase. Use `origin/<branch>` when it resolves, the local branch only when it does not.

```bash
git rev-parse --verify --quiet origin/hotfix-{ID}
git rev-parse --verify --quiet hotfix-{ID}
```

Repeat for `work-{ID}-HF` and `work-{ID}-BM` to get `A`, `B`, `C`. Call the winning ref for each `REF(branch)`.

**QA swimlane value at a ref.** Key the read on the label, never a line number — the file's offsets shift as `cab:` entries change.

```bash
# Resolve {QA_ENV} once: the swimlane whose name ends in -QA. Stop and ask if
# more than one matches, or none does.
git show <ref>:deploy-config.yml | grep -oE 'name: [A-Za-z0-9_-]+-QA'

git show <ref>:deploy-config.yml | awk '/name: {QA_ENV}/{getline; print $2}'
```

Read it at `REF(work-{ID}-HF)` and `REF(hotfix-{ID})` to get `Q_HF` and `Q_PARENT`.

**Marker commits reachable from a ref.** The swap commit (Phase 2) and the reset commit (Phase 4) are the durable markers — they survive branch deletion, unlike anything anchored to `hotfix-{ID}`. Match their exact subjects only, never any `@{ID}: ` commit.

```bash
# -i on purpose: the subjects are written capitalised, but a run that typed one
# lowercase still has to be found, or the hotfix loops in an earlier phase forever.
git log <ref> -i --grep "^@{ID}: Point QA swimlane at hotfix branch" --format=%h -1  # HAS_SWAP(ref)
git log <ref> -i --grep "^@{ID}: Back-merge and config reset" --format=%h -1  # HAS_RESET(ref)
```

A probe whose ref is absent is `false`, not an error.

### Two traps that make naive probes lie

**Containment is trivially true for a freshly-cut branch.** `git merge-base --is-ancestor hotfix-{ID} origin/release` returns true the instant `hotfix-{ID}` is created, long before PR 2 exists. Routing on bare containment sends a Phase 1 hotfix straight to Phase 4. The same holds for `work-{ID}-BM` against `integration`.

**`hotfix-{ID}` is deleted after the loop closes.** Post-merge cleanup removes it from origin, so any state defined in terms of that branch evaluates false on a fresh clone and a finished hotfix routes backwards into Phase 4. Completion must be provable without it.

Both traps are avoided by defining every merge conclusion from the presence of a marker commit, which is non-trivial and permanent:

| Derived state | Definition |
|---|---|
| `SWAPPED` | `B` and `Q_HF` == `hotfix-{ID}` |
| `PR1_MERGED` | `A` and `Q_PARENT` == `hotfix-{ID}` |
| `PR2_MERGED` | `HAS_SWAP(origin/release)` |
| `RESET_READY` | `C` and `HAS_RESET(REF(work-{ID}-BM))` |
| `PR3_MERGED` | `HAS_RESET(origin/integration)` |

`Q_PARENT` reads `integration` on a freshly-cut parent branch and only becomes `hotfix-{ID}` once PR 1 lands the swap. `PR2_MERGED` assumes the swap commit reaches `release` only through PR 2, which holds — that is the whole point of the hotfix track. Only the subjects this skill writes count: a hotfix may reuse its story's work ID, whose ordinary `@{ID}: ` commits already sit on `release` and `integration`, so any `@{ID}: ` commit would route a fresh hotfix straight to Done.

### Routing table

Evaluate top to bottom; take the first row that matches.

| Condition | Phase | Next action |
|---|---|---|
| `PR3_MERGED` | Done | Run Closing verification |
| `RESET_READY` | 4c | Push `work-{ID}-BM`, open PR 3 |
| `C` | 4b | Resume on the existing branch — finish the merge, then the back-merge bump for UAT + Production, then the config reset |
| `PR2_MERGED` | 4a | Cut `work-{ID}-BM` from `integration` |
| `PR1_MERGED` | 3 | Open PR 2, coordinate the off-cycle window |
| `SWAPPED` | 2 | Confirm the fix itself is committed, then await PR 1 |
| `A` and `B` | 2 | Make the hotfix bump if Phase 0 says it is missing, swap config, write the fix, open PR 1 |
| `A` | 1b | Cut `work-{ID}-HF` from `hotfix-{ID}` |
| otherwise | 1a | Cut both branches from `release` |

### Report the position before acting

Print the phase map, marking each phase from the probe results — `[x]` complete, `[>]` current, `[ ]` pending. Derive every mark from the probes; never carry marks over from a previous run or from a notes file.

```markdown
### {UAT-only | UAT + Production} hotfix — {ID}

- [x] Phase 1 — Setup & branching
- [>] Phase 2 — Implementation & QA routing
- [ ] Phase 3 — UAT promotion & release window
- [ ] Phase 4 — Back-merge

**Next action:** <the routing table's action for the current phase>
```

## Phase 1 — Setup and branching

Run each fenced block below as one Bash call. Stop the phase when any block exits non-zero — including `git fetch origin`, since a stale `origin/release` still passes later checks — and report the failing block's output. Whenever this phase stops, report the same content as the closing report in step 7: the stash, if one was made, and the set-aside count and folder, if used.

**1. Move to the repository root and fetch:**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin
```

**2. Resolve the ref this phase cuts from, move aside anything it tracks that collides with the working tree — anywhere in the repository, not only `.claude/` — and report any tracked `.claude/` file both sides touch.** A path counts as a collision when the ref tracks it, it exists on disk (a regular file or a dangling symlink), and the current index does not track it under any case — an APFS case-only match still counts as tracked, so it is never moved. Build the aside folder from the git **common** dir, not a literal `.git/` and not the per-worktree git dir: in a linked worktree, `.git` is a file, so a literal path fails there; the per-worktree git dir is deleted by `git worktree remove`, taking the aside folder with it, while the common dir survives every worktree's lifecycle. Set `PHASE` to `1a` or `1b` on the first line and run the block as one Bash call. At Phase 1b, `hotfix-{ID}` may exist only locally — Phase 2 is what pushes it — so it resolves `origin/` first and stops if neither resolves:

```bash
PHASE=1a
if [ "$PHASE" = 1a ]; then
  REF=origin/release
elif git rev-parse --verify --quiet origin/hotfix-{ID} >/dev/null; then
  REF=origin/hotfix-{ID}
elif git rev-parse --verify --quiet hotfix-{ID} >/dev/null; then
  REF=hotfix-{ID}
else
  echo "hotfix-{ID} does not resolve on origin or locally" >&2
  exit 1
fi
echo "cut ref: $REF"
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
ASIDE="$GIT_COMMON_DIR/hean-hotfix-aside/{ID}"
RELEASE_LIST=$(mktemp); TRACKED_LIST=$(mktemp); CANDIDATES=$(mktemp)
git ls-tree -r -z --name-only "$REF" | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$RELEASE_LIST"
git ls-files -z | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$TRACKED_LIST"
grep -Fxvif "$TRACKED_LIST" "$RELEASE_LIST" > "$CANDIDATES"

count=0
while IFS= read -r f; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  mkdir -p "$ASIDE/$(dirname "$f")" && mv "$f" "$ASIDE/$f" && count=$((count + 1)) \
    || { echo "failed to move $f aside" >&2; exit 1; }
done < "$CANDIDATES"
echo "moved aside: $count"

LOCAL_MOD=$(mktemp); REF_DIFF=$(mktemp)
git diff HEAD --name-only -z -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$LOCAL_MOD"
git diff --name-only -z HEAD "$REF" -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$REF_DIFF"
grep -Fxf "$REF_DIFF" "$LOCAL_MOD" || true
```

Report the set-aside count and the resolved `cut ref:`, and report any path the overlap check prints — a **modified tracked** file under `.claude/` (staged or not) is never stashed in step 3, so if `$REF` also changed it, the cut in step 4 fails on it. Any later step that needs the ref resolves it the same way, reusing this block rather than new logic.

**3. Inspect what's left, then stash it.** Moving collisions aside runs first, so a file the ref tracks and `.claude/` excludes from the stash never enters it, and never gets caught mid-apply between a checkout and a pop:

```bash
git status --porcelain
```

Anything outside `.claude/` is the user's fix, or other work. Show it, then stash it — including untracked files, excluding `.claude/` — with a message naming `{ID}`:

```bash
git stash push -u -m "{ID}: pre-hotfix work" -- . ':!.claude'
```

Nothing under `.claude/` goes into the stash. When `git status --porcelain` shows nothing outside `.claude/`, skip the stash.

**4. Cut the branch(es) directly from `$REF`, untracked.** Never from a local `release`, and never with a pull:

At Phase 1a:

```bash
git checkout -b hotfix-{ID} --no-track origin/release
```

```bash
git checkout -b work-{ID}-HF --no-track
```

Verify `hotfix-{ID}` resolves to the same commit as `origin/release`:

```bash
git rev-parse hotfix-{ID}
git rev-parse origin/release
```

At Phase 1b, `hotfix-{ID}` already exists — never re-cut it, it may already carry merged work. Cut only the working branch, from `{REF}` — the ref step 2 printed after `cut ref:`:

```bash
git checkout -b work-{ID}-HF --no-track {REF}
```

**5. UAT + Production only: commit the hotfix version bump on `work-{ID}-HF`.** Skip this step for a UAT-only hotfix. Commit it right after the cut, before the stash returns and before the swap commit in Phase 2: the script reads a swap commit without a bump commit as a UAT-only hotfix. Skip it when the Phase 0 verdict reads `the hotfix bump to {H} is already committed`. Run the bump block in "Version bumps" with `NEW` set to the new version after `hotfix bump` in the Phase 0 output, and `{ID}` filled in.

**6. Apply the stash, if one was made, on `work-{ID}-HF`, and drop it only after a clean apply — in one block, so a no-stash run does not exit non-zero on an empty reference.** Find it by its `{ID}` message rather than assuming it is `stash@{0}` — a resumed run has no memory of which entry it created:

```bash
STASH_REF=$(git stash list --format='%gd %s' | grep -F "{ID}: pre-hotfix work" | head -1 | cut -d' ' -f1)
[ -z "$STASH_REF" ] || { git stash apply "$STASH_REF" && git stash drop "$STASH_REF"; }
```

On conflict, the block exits non-zero and the drop never runs; stop and report, and never re-apply the entry on a later run.

**7. Report:** the type, and for UAT + Production the hotfix bump commit; the stash, if any; the set-aside count and folder; and that switching back to `integration` later deletes every path `release` tracks that `integration` does not — root `CLAUDE.md` included, not only `.claude/` — so the user restores the set-aside copies from the common-dir folder reported in step 2, or reruns `/hean-harness:setup`.

## Phase 2 — Implementation and QA routing

On `work-{ID}-HF`:

**0. UAT + Production only: make the hotfix bump if it is missing.** When the Phase 0 verdict reads `hotfix bump {R} -> {R+1}` rather than `already committed`, run the bump block in "Version bumps" on `work-{ID}-HF` before anything else, so it comes before the swap commit — the script reads a swap commit without a bump commit as a UAT-only hotfix. A Phase 1 interrupted between the cut and step 5 leaves the branch without it.

**1. Route the QA environment at the hotfix branch.** Edit `deploy-config.yml` so the `{QA_ENV}` swimlane's `branch` reads `hotfix-{ID}` instead of `integration`. Change that one value; leave every other swimlane untouched.

**2. Stop for the fix itself.** The config swap only points QA at the branch — it deploys nothing. Tell the user to apply the remediation on `work-{ID}-HF`, and wait for explicit confirmation that it is complete before staging anything. Do not infer the fix from the work item title.

`SWAPPED` becomes true on the swap commit alone, so on a resumed run re-confirm the remediation is committed rather than assuming this phase finished.

**3. Commit.** Inspect `git status` and stage named paths only. Never `git add .` and never force-add an ignored path. Follow the project's commit convention — `@{ID}: ` prefix, then a capitalised imperative phrase, kept short. Three subjects are exact phrases, because a resumed run detects the type or the phase by matching them: the swap commit below, the version bump in "Version bumps" and one commit in Phase 4, called out there. Keep the swap and the fix as separate commits so each is reviewable on its own:

```bash
git commit -m "@{ID}: Point QA swimlane at hotfix branch" deploy-config.yml
```

Running this skill is the user's request for the commits its steps make. Commits follow `~/.claude/rules/implementation-commits.md`.

**4. Push both branches** — `hotfix-{ID}` must exist remotely before PR 1 can target it:

```bash
git push -u origin hotfix-{ID}
git push -u origin work-{ID}-HF
```

**5. Open PR 1**, head `work-{ID}-HF`, base `hotfix-{ID}`.

**Gate — stop here.** PR 1 merges only on checks PASS plus peer approval. Report the PR URL and end the run.

## Phase 3 — UAT promotion and release window

**1. Open PR 2**, head `hotfix-{ID}`, base `release`.

**2. Once checks pass, hand off to a human.** Tell the user to contact the Team Lead to schedule the off-cycle release window. You cannot schedule it.

**3. Merge to `release` only when both hold:** the PR is approved, **and** you are inside the authorized off-cycle window. Being approved early is not permission to merge early.

**4. PO sign-off.** After the merge deploys, the fix is verified in UAT and the Product Owner approves.

**5. UAT + Production only: the release to Production.** After PO sign-off, the release champion merges `release` into `master`, which carries the hotfix and its version to Production. That merge is the release champion's action, not this skill's.

**Gate — stop here.** Each of these is another party's action. Report status — for UAT + Production, including that the release champion merges `release` into `master` after PO sign-off — and end the run.

## Phase 4 — Back-merge

The hotfix is **not done** until this lands. `release` now carries commits that `integration` lacks; the next regular release would overwrite the fix and re-point the QA swimlane at a branch that is about to be deleted.

**1. Cut the back-merge branch from `integration`:**

```bash
git checkout integration
git pull origin integration
git checkout -b work-{ID}-BM
```

**2. Merge `release` in:**

```bash
git merge --no-ff origin/release
```

Merge `origin/release`, not a local `release` that may be behind. If conflicts arise, resolve them manually and stop to have the resolution reviewed. Never take a whole-side resolution (`-X ours` / `-X theirs`) to clear a conflict quickly — it silently drops one side of the hotfix.

**Keep `integration`'s version through the merge.** After the merge, the `version` in `package.json` and `package-lock.json` must read the `integration:` version from the Phase 0 output. Resolve a version conflict to it, and set it back when the merge took `release`'s version.

**3. UAT + Production only: commit the back-merge version bump on `work-{ID}-BM`.** Conclude the merge commit first; a path-limited commit fails while `MERGE_HEAD` exists. Skip this step for a UAT-only hotfix; `integration` keeps its own version. Run it after the merge and before the config reset, so a resumed run that finds the reset commit never skips it. Run the bump block in "Version bumps" with `NEW` set to the new version after `back-merge bump` in the Phase 0 output, and `{ID}` filled in. On a resumed run at Phase 4b, skip the block when `package.json` on `work-{ID}-BM` already reads that version.

**4. Reset the config.** Set the `{QA_ENV}` swimlane's `branch` back to `integration`. This step is load-bearing: without it, `hotfix-{ID}` propagates onward as the QA branch and survives long after the branch itself is deleted.

**5. Commit and push.** Use `Back-merge and config reset` exactly as written. A resumed run finds
this phase by matching that phrase, so any rewording — including a lowercase first letter — hides
the phase from the next run:

```bash
git commit -m "@{ID}: Back-merge and config reset" deploy-config.yml
git push -u origin work-{ID}-BM
```

**6. Open PR 3**, head `work-{ID}-BM`, base `integration`.

**Gate — stop here.** PR 3 merges on checks PASS plus peer approval.

## Version bumps

The type, and with it every bump, comes from the Phase 0 script — never from the user's words or your own judgement.

- **UAT-only:** no bump anywhere. `release` is already ahead of `master`, and the scheduled release train advances the version ladder (`master` < `release` < `integration`); a hotfix bump would double-bump it. On the back-merge, `integration` keeps its own version.
- **UAT + Production:** two bumps. `release` equals `master`, so it is already in Production, and the hotfix ships to Production under a new version.
  - **Hotfix bump:** Phase 1 step 5 (Phase 2 step 0 when Phase 1 was interrupted before it), on `work-{ID}-HF`, to the version after `hotfix bump` in the Phase 0 output (`release` with its last segment + 1).
  - **Back-merge bump:** Phase 4 step 3, on `work-{ID}-BM` after the merge from `release`, to the version after `back-merge bump` in the Phase 0 output (`integration` with its last segment + 1).

**The bump commit subject is exact.** The script finds a mid-flight UAT + Production hotfix by the subject prefix `@{ID}: Update Release Version to v`, so any rewording makes the next run misread the type.

Bump block — run as one Bash call on the branch being bumped, with `NEW` and `{ID}` filled in. It stages `package-lock.json` with `package.json`, because the lockfile carries the same version (root `version` and `packages[""].version`) and drifts if left behind:

```bash
NEW='{NEW}'
node -e '
const fs = require("node:fs");
const v = process.argv[1];
for (const f of ["package.json", "package-lock.json"]) {
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  const json = JSON.parse(text);
  if (f === "package.json" || "version" in json) json.version = v;
  if (f === "package-lock.json" && json.packages && json.packages[""]) json.packages[""].version = v;
  const indent = (text.match(/^[ \t]+(?=")/m) || ["  "])[0];
  fs.writeFileSync(f, JSON.stringify(json, null, indent) + (text.endsWith("\n") ? "\n" : ""));
  console.log(f + ": " + v);
}' "$NEW" || exit 1
FILES=package.json; [ -f package-lock.json ] && FILES="$FILES package-lock.json"
git commit -m "@{ID}: Update Release Version to v$NEW" -- $FILES
```

## Pull requests

All three PRs follow the same shape and build their body from create-pr's own files, rules and checks. Write the body to `.claude/skills/hotfix/output/{ID}.md` first so the user can review it before anything reaches GitHub.

| PR | Head | Base | Body content |
|---|---|---|---|
| 1 | `work-{ID}-HF` | `hotfix-{ID}` | the story bullets for the fix and its deployment steps |
| 2 | `hotfix-{ID}` | `release` | the same story bullets and deployment steps, because it carries the same fix to UAT |
| 3 | `work-{ID}-BM` | `integration` | the same story bullets and deployment steps, plus one bullet for the config reset: "The QA swimlane builds from `integration` again" |

Build each body in this order. The commit range for a PR is `git merge-base origin/<base> <head>` to `<head>`.

1. **Story lookup.** Resolve `TITLE`, `LINEAR_URL` and `ISSUE_DESCRIPTION` for `{ID}` as create-pr's Phase 3 does, including the manual fallback. Build `PR_TITLE` for the PR being opened:

   | PR | `PR_TITLE` |
   |---|---|
   | 1 | `@{ID}: ` + `TITLE` with the `[Hotfix]` tag removed |
   | 2 | `@{ID}: [Hotfix] ` + `TITLE` with the `[Hotfix]` tag removed |
   | 3 | exactly `@{ID}: Backmerge` |

   - **The tag:** only `[Hotfix]` in square brackets, in any capitalisation (`[Hotfix]`, `[HotFix]`, `[HOTFIX]`). A plain `Hotfix` word without square brackets is not the tag: PR 1 and PR 2 keep it in the title, and PR 2 still adds `[Hotfix] ` after `@{ID}: `.
   - **Removal in PR 1 and PR 2:** remove the tag together with one separator directly after it (` - ` or `:`), then collapse doubled spaces and trim. If nothing but the tag was there, keep the rest as is. PR 2 then puts `[Hotfix] ` right after `@{ID}: `, so the tag always sits before the Linear title.
   - **Length:** the whole title is 77 characters or fewer. When it must be shortened, shorten only the part taken from `TITLE`; never cut `[Hotfix]` or `Backmerge`.

   | Linear `TITLE` | PR 1 | PR 2 | PR 3 |
   |---|---|---|---|
   | `ABC: [Hotfix] - Remove X` | `@{ID}: ABC: Remove X` | `@{ID}: [Hotfix] ABC: Remove X` | `@{ID}: Backmerge` |
   | `[Hotfix] Simplify criteria` | `@{ID}: Simplify criteria` | `@{ID}: [Hotfix] Simplify criteria` | `@{ID}: Backmerge` |
   | `Grant edit access to Active__c` | `@{ID}: Grant edit access to Active__c` | `@{ID}: [Hotfix] Grant edit access to Active__c` | `@{ID}: Backmerge` |
   | `RE Approval Hotfix` | `@{ID}: RE Approval Hotfix` | `@{ID}: [Hotfix] RE Approval Hotfix` | `@{ID}: Backmerge` |
2. **Template.** Read `${CLAUDE_PLUGIN_ROOT}/skills/create-pr/assets/pr-body.md`. Replace `{WORK-ID}` with `{ID}`, `{TITLE}` and `{LINEAR_URL}` with the story values. `{TITLE}` is the plain Linear title in all three PRs, never `PR_TITLE`.
3. **Bullets.** Read `${CLAUDE_PLUGIN_ROOT}/skills/create-pr/references/bullets.md`. Write the "What was Done?" bullets from `ISSUE_DESCRIPTION` and the PR's commits. Sort the commits into the main, Sonar and Framework buckets as create-pr's Phase 4 does, and fill `{BULLETS}`, `{SONAR_BULLETS}` and `{FRAMEWORK_BULLETS}`. Remove each empty section as create-pr's Phase 7 does. PR 3 adds its config-reset bullet to `{BULLETS}`.
4. **Deployment steps.** Fill `{DEPLOYMENT_STEPS}` as create-pr's Phase 5 does, from the files the PR's commit range changes. Follow `.claude/rules/runbook-deployment-steps.md` and read the repository's `deploy.yml` for the steps each stage runs. Ask the manual-steps question from Phase 5 once per hotfix, at PR 1, and reuse its answers for PRs 2 and 3 because they carry the same fix. Do not ask again. Remove the section when no rows result.
5. **Screenshots.** Ask create-pr's Phase 6 question once per PR, reading its "Story {N}" as the hotfix story `{ID}`, with `{ID}` and `TITLE`. An answer other than an explicit yes removes the template's Screenshots block. On yes, run Phase 6's capture flow and save the files here:

   ```bash
   SHOTS_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
   mkdir -p "$SHOTS_ROOT/.claude/skills/hotfix/output/screenshots/{ID}"
   ```

   Build the body lines and the closing drag-in note in the format Phase 6 Step 4 gives, with the path `{SHOTS_ROOT}/.claude/skills/hotfix/output/screenshots/{ID}/{filename}`. After the PR is created, offer create-pr's Phase 10 wipe, applied to the hotfix folder `$SHOTS_ROOT/.claude/skills/hotfix/output/screenshots/{ID}` and not create-pr's.
6. **Body check.** Write the body with the PR title comment (`PR_TITLE`) as its first line, as create-pr's Phase 7 does. Run create-pr's template-marker check and its attribution check on the file, as update-pr does. Strip any hit, rewrite the file and re-run the check before `gh pr create`.

Submit with an explicit head and base:

```bash
gh pr create \
  --base <base> \
  --head <head> \
  --title "{PR_TITLE}" \
  --body-file .claude/skills/hotfix/output/{ID}.md \
  --assignee @me
```

Both refs are always explicit — none of these PRs targets `integration` by default, and two of them have a base that exists only for this hotfix.

**Merging is a human action.** If asked to merge on the user's behalf, use a merge commit (`gh pr merge --merge`), never `--squash`. Squashing collapses the swap, bump and reset subjects that Phase 0 detects the type and phase from.

## Closing verification

Once `PR3_MERGED` holds, confirm the swimlane reset reached everywhere it propagated:

```bash
git show origin/integration:deploy-config.yml | awk '/name: {QA_ENV}/{getline; print $2}'
git show origin/release:deploy-config.yml | awk '/name: {QA_ENV}/{getline; print $2}'
git show origin/master:deploy-config.yml | awk '/name: {QA_ENV}/{getline; print $2}'
```

`origin/integration` must read `integration`. Any ref still naming a `hotfix-` branch is unreset drift — report it with the ref name. A `hotfix-` value on `origin/master` means production's QA swimlane points at a branch that has very likely been deleted.

`origin/release` and `origin/master` lag by design: each keeps its value until the next release train carries the reset forward. Report drift as a finding rather than fixing it here — correcting a long-lived branch is its own change.

Report the hotfix complete only when `PR3_MERGED` holds and `origin/integration` reads `integration`.

## Constraints

- **Work ID is supplied, never inferred.** Branch-name extraction fails on `hotfix-{ID}`.
- **Phase is detected, never assumed.** Run the probe set on every invocation, including ones where the user says which phase they are in, and never from a hand-maintained notes or tracker file.
- **Every branch resolves through `origin/` first.** Stale local refs mis-route the phase.
- **Completion never depends on `hotfix-{ID}` existing.** It gets deleted after the loop closes.
- **The fix is the user's work.** Wait for explicit confirmation before staging it.
- **One phase per run.** Stop at the gate. Do not open the next phase's PR because the previous PR "will obviously pass".
- **Named paths only when staging.** No `git add .`, no force-adding ignored paths.
- **Only the `{QA_ENV}` swimlane changes.** Every other swimlane stays as it is, in both directions.

## Red flags — stop and re-detect

- Concluding "PR merged" from `--is-ancestor` — it is true for any freshly-cut branch
- Defining "done" in terms of `hotfix-{ID}`, which no longer exists once cleanup runs
- Probing a bare local branch name when an `origin/` ref resolves
- Trusting a checklist or tracker file over a fresh probe
- About to run Phase 1 commands when `hotfix-{ID}` already exists on origin
- Chaining `git checkout release && git pull` into the branch cuts, or continuing past a failed pull — cut both branches from `origin/release` directly, never from a pulled local `release`
- About to merge PR 2 without confirming the off-cycle window is open
- About to call the hotfix done at PR 2 merge — it is done at PR 3 merge
- Reaching for `gh pr list` to work out which phase you are in
- Reading `deploy-config.yml` by line number
- Choosing the hotfix type, or a bump, from the user's words instead of the Phase 0 script output

## Common mistakes

| Mistake | Consequence |
|---|---|
| Skipping the back-merge | Next release overwrites the fix; QA swimlane drifts to a deleted branch |
| Cutting `work-{ID}-BM` from `release` | Back-merge PR carries no delta against `integration` |
| Cutting `hotfix-{ID}` from `integration` | Hotfix ships untested `integration` work into UAT |
| Pulling local `release` before cutting, or continuing after the pull fails | Both branches get cut from a stale `release`, commits behind `origin/release` |
| Resetting the config on the HF branch | The swap is reverted before QA ever deploys from it |
| Rewording the `Back-merge and config reset` commit | Resumed runs miss `RESET_READY` and `PR3_MERGED`, and re-enter Phase 4; the check reports the back-merge as not done and, for a UAT + Production hotfix, asks for another back-merge bump |
| Rewording the `Point QA swimlane at hotfix branch` commit | Resumed runs miss `PR2_MERGED`, and a UAT-only hotfix without a bump commit falls back to the start rule (`release` against `master`) for its type |
| Squash-merging any of the three PRs | Destroys the swap, bump and reset subjects Phase 0 detects from |
| Committing with `git add .` | Sweeps unrelated working-tree changes into an urgent, lightly-reviewed PR |
| `[Hotfix]` added twice, or left mid-title, in PR 2 | The title reads `[Hotfix] [Hotfix] ...` or `@{ID}: ABC: [Hotfix] - ...`; remove the tag from `TITLE` first, then put `[Hotfix] ` right after `@{ID}: ` |
| Story title used for the back-merge PR | PR 3 reads like the fix; its title is exactly `@{ID}: Backmerge` |
| Bumping `package.json` in a UAT-only hotfix | The release train bumps the same ladder again, so `release` and `integration` skip a version |
| Skipping a required bump in a UAT + Production hotfix | Production receives the hotfix under the version it already runs, and the back-merge leaves `integration` at or below the hotfix version |
| Rewording the `Update Release Version to v` commit | The next run does not see the bump, so it reads the swap commit as a UAT-only hotfix: it skips the back-merge bump, or reports BLOCKED for `prod` |
