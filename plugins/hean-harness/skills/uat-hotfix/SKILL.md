---
name: uat-hotfix
description: UAT hotfix lifecycle driver for the release branch — detects which of the four phases a hotfix is in from git state alone, then executes only that phase's steps and stops at its human gate
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

You are executing the `/uat-hotfix` skill. Detect the phase first, then execute only that phase.

This skill applies to urgent fixes that must reach the UAT (`release`) environment ahead of the normal release train. A change that can wait for the next scheduled `integration` → `release` deployment is not a hotfix; do not use this skill for it.

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

## Phase 0 — Resolve the work ID and detect the phase

**The work ID is an argument. Never derive it from the branch name.** The repo's `^work-([A-Z]+-\d+)` convention returns nothing when HEAD is `hotfix-{ID}`, which is exactly where you stand during Phases 2 and 3. If the user did not supply an ID, ask for it and stop.

Refresh remote refs before probing:

```bash
git fetch origin
```

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

**Work-item commits reachable from a ref.** This is the durable marker — it survives branch deletion, unlike anything anchored to `hotfix-{ID}`.

```bash
git log <ref> --grep "^@{ID}:" --format=%h -1              # HAS(ref)
# -i on purpose: the phase is written capitalised, but a run that typed it
# lowercase still has to be found, or the hotfix loops in Phase 4b forever.
git log <ref> -i --grep "^@{ID}: Back-merge and config reset" --format=%h -1  # HAS_RESET(ref)
```

A probe whose ref is absent is `false`, not an error.

### Two traps that make naive probes lie

**Containment is trivially true for a freshly-cut branch.** `git merge-base --is-ancestor hotfix-{ID} origin/release` returns true the instant `hotfix-{ID}` is created, long before PR 2 exists. Routing on bare containment sends a Phase 1 hotfix straight to Phase 4. The same holds for `work-{ID}-BM` against `integration`.

**`hotfix-{ID}` is deleted after the loop closes.** Post-merge cleanup removes it from origin, so any state defined in terms of that branch evaluates false on a fresh clone and a finished hotfix routes backwards into Phase 4. Completion must be provable without it.

Both traps are avoided by defining every merge conclusion from work-item commit presence, which is non-trivial and permanent:

| Derived state | Definition |
|---|---|
| `SWAPPED` | `B` and `Q_HF` == `hotfix-{ID}` |
| `PR1_MERGED` | `A` and `Q_PARENT` == `hotfix-{ID}` |
| `PR2_MERGED` | `HAS(origin/release)` |
| `RESET_READY` | `C` and `HAS_RESET(REF(work-{ID}-BM))` |
| `PR3_MERGED` | `HAS(origin/integration)` |

`Q_PARENT` reads `integration` on a freshly-cut parent branch and only becomes `hotfix-{ID}` once PR 1 lands the swap. `PR2_MERGED` assumes the hotfix commits reach `release` only through PR 2, which holds — that is the whole point of the hotfix track.

### Routing table

Evaluate top to bottom; take the first row that matches.

| Condition | Phase | Next action |
|---|---|---|
| `PR3_MERGED` | Done | Run Closing verification |
| `RESET_READY` | 4c | Push `work-{ID}-BM`, open PR 3 |
| `C` | 4b | Resume on the existing branch — finish the merge, then the config reset |
| `PR2_MERGED` | 4a | Cut `work-{ID}-BM` from `integration` |
| `PR1_MERGED` | 3 | Open PR 2, coordinate the off-cycle window |
| `SWAPPED` | 2 | Confirm the fix itself is committed, then await PR 1 |
| `A` and `B` | 2 | Swap config, write the fix, open PR 1 |
| `A` | 1b | Cut `work-{ID}-HF` from `hotfix-{ID}` |
| otherwise | 1a | Cut both branches from `release` |

### Report the position before acting

Print the phase map, marking each phase from the probe results — `[x]` complete, `[>]` current, `[ ]` pending. Derive every mark from the probes; never carry marks over from a previous run or from a notes file.

```markdown
### UAT Hotfix — {ID}

- [x] Phase 1 — Setup & branching
- [>] Phase 2 — Implementation & QA routing
- [ ] Phase 3 — UAT promotion & release window
- [ ] Phase 4 — Back-merge

**Next action:** <the routing table's action for the current phase>
```

## Phase 1 — Setup and branching

Run every command in this phase separately, and stop at the first failure — including `git fetch origin`, since a stale `origin/release` still passes later checks, and the move loop in step 2. Report the failing command's output. Whenever this phase stops, report the same content as the closing report in step 6: the stash, if one was made, and the set-aside count and folder, if used. Never run the next command after a failed one.

**1. Move to the repository root and fetch:**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin
```

**2. Resolve the ref this phase cuts from, move aside anything it tracks that collides with the working tree — anywhere in the repository, not only `.claude/` — and report any tracked `.claude/` file both sides touch.** A path counts as a collision when the ref tracks it, it exists on disk (a regular file or a dangling symlink), and the current index does not track it under any case — an APFS case-only match still counts as tracked, so it is never moved. Build the aside folder from the git dir, not a literal `.git/`: in a linked worktree, `.git` is a file, so a literal path fails there while an unguarded loop keeps counting and exits 0.

At Phase 1a:

```bash
REF=origin/release
GIT_DIR=$(git rev-parse --git-dir)
ASIDE="$GIT_DIR/hean-hotfix-aside/{ID}"
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
git diff --name-only -z -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$LOCAL_MOD"
git diff --name-only -z HEAD "$REF" -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$REF_DIFF"
grep -Fxf "$REF_DIFF" "$LOCAL_MOD" || true
```

At Phase 1b, `hotfix-{ID}` may exist only locally — Phase 2 is what pushes it — so resolve it the way Phase 0 does, `origin/` first, and stop if neither resolves. The rest of the block is identical to Phase 1a's:

```bash
if git rev-parse --verify --quiet origin/hotfix-{ID} >/dev/null; then
  REF=origin/hotfix-{ID}
elif git rev-parse --verify --quiet hotfix-{ID} >/dev/null; then
  REF=hotfix-{ID}
else
  echo "hotfix-{ID} does not resolve on origin or locally" >&2
  exit 1
fi
GIT_DIR=$(git rev-parse --git-dir)
ASIDE="$GIT_DIR/hean-hotfix-aside/{ID}"
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
git diff --name-only -z -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$LOCAL_MOD"
git diff --name-only -z HEAD "$REF" -- .claude | while IFS= read -r -d '' f; do printf '%s\n' "$f"; done > "$REF_DIFF"
grep -Fxf "$REF_DIFF" "$LOCAL_MOD" || true
```

Report the set-aside count, and report any path the overlap check prints — a **modified tracked** file under `.claude/` is never stashed in step 3, so if `$REF` also changed it, the cut in step 4 fails on it.

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

At Phase 1b, `hotfix-{ID}` already exists — never re-cut it, it may already carry merged work. Cut only the working branch, from whichever ref resolved in step 2 — `origin/hotfix-{ID}` if it resolved, `hotfix-{ID}` only if it did not:

```bash
git checkout -b work-{ID}-HF --no-track origin/hotfix-{ID}
```

**5. Apply the stash, if one was made, on `work-{ID}-HF`.** Find it by its `{ID}` message rather than assuming it is `stash@{0}` — a resumed run has no memory of which entry it created:

```bash
STASH_REF=$(git stash list --format='%gd %s' | grep -F "{ID}: pre-hotfix work" | head -1 | cut -d' ' -f1)
[ -n "$STASH_REF" ] && git stash apply "$STASH_REF"
```

On conflict, stop and report; do not drop the entry, and never re-apply it on a later run. On a clean apply, drop it:

```bash
git stash drop "$STASH_REF"
```

**6. Report:** the stash, if any; the set-aside count and folder; and that switching back to `integration` later deletes every path `release` tracks that `integration` does not — root `CLAUDE.md` included, not only `.claude/` — so the user restores the set-aside copies from the folder reported in step 2, or reruns `/hean-harness:setup`.

## Phase 2 — Implementation and QA routing

On `work-{ID}-HF`:

**1. Route the QA environment at the hotfix branch.** Edit `deploy-config.yml` so the `{QA_ENV}` swimlane's `branch` reads `hotfix-{ID}` instead of `integration`. Change that one value; leave every other swimlane untouched.

**2. Stop for the fix itself.** The config swap only points QA at the branch — it deploys nothing. Tell the user to apply the remediation on `work-{ID}-HF`, and wait for explicit confirmation that it is complete before staging anything. Do not infer the fix from the work item title.

`SWAPPED` becomes true on the swap commit alone, so on a resumed run re-confirm the remediation is committed rather than assuming this phase finished.

**3. Commit.** Inspect `git status` and stage named paths only. Never `git add .` and never force-add an ignored path. Follow the project's commit convention — `@{ID}: ` prefix, then a capitalised imperative phrase, kept short. One commit in Phase 4 must use one exact phrase, because a resumed run detects the phase by matching it; it is called out there. Keep the swap and the fix as separate commits so each is reviewable on its own:

```bash
git commit -m "@{ID}: Point QA swimlane at hotfix branch" deploy-config.yml
```

Commits follow `~/.claude/rules/implementation-commits.md`; when the commit approval gate refuses, list the changes, stop, and continue after the user asks for the commit.

**4. Push both branches** — `hotfix-{ID}` must exist remotely before PR 1 can target it:

```bash
git push -u origin hotfix-{ID}
git push -u origin work-{ID}-HF
```

**5. Open PR 1**, head `work-{ID}-HF`, base `hotfix-{ID}`.

**Gate — stop here.** PR 1 merges only on checks PASS plus peer approval. Report the PR URL and end the run.

### Version bumping

A UAT hotfix does **not** touch `package.json`. The version ladder (`master` < `release` < `integration`) is advanced by the scheduled release train, which would double-bump if the hotfix bumped too.

**Nothing in the repository says which kind of hotfix this is.** A UAT hotfix and a Production hotfix have the same branch names, the same PR directions and the same merge order. The only difference happens outside a developer's reach: a release champion merges `release` into `master` separately, and a developer's part ends at an open PR into `release`. The release champion decides the kind at run time, and a version bump is a consequence of that decision — never evidence of it. So the type cannot be inferred from git state, and a bump must never be used to infer it either.

If the user states this is a **Production** hotfix, stop and ask where to bump before editing `package.json`. Do not bump on your own judgement. When a bump is authorized, stage `package-lock.json` with it — the lockfile carries the same version and drifts if left behind.

## Phase 3 — UAT promotion and release window

**1. Open PR 2**, head `hotfix-{ID}`, base `release`.

**2. Once checks pass, hand off to a human.** Tell the user to contact the Team Lead to schedule the off-cycle release window. You cannot schedule it.

**3. Merge to `release` only when both hold:** the PR is approved, **and** you are inside the authorized off-cycle window. Being approved early is not permission to merge early.

**4. PO sign-off.** After the merge deploys, the fix is verified in UAT and the Product Owner approves.

**Gate — stop here.** Each of these is another party's action. Report status and end the run.

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

**3. Reset the config.** Set the `{QA_ENV}` swimlane's `branch` back to `integration`. This step is load-bearing: without it, `hotfix-{ID}` propagates onward as the QA branch and survives long after the branch itself is deleted.

**4. Commit and push.** Use `Back-merge and config reset` exactly as written. A resumed run finds
this phase by matching that phrase, so any rewording — including a lowercase first letter — hides
the phase from the next run:

```bash
git commit -m "@{ID}: Back-merge and config reset" deploy-config.yml
git push -u origin work-{ID}-BM
```

**5. Open PR 3**, head `work-{ID}-BM`, base `integration`.

**Gate — stop here.** PR 3 merges on checks PASS plus peer approval.

## Opening a PR

All three PRs follow the same shape. Write the body to `.claude/skills/uat-hotfix/output/{ID}.md` first so the user can review it before anything reaches GitHub, then submit with an explicit head and base:

```bash
gh pr create \
  --base <base> \
  --head <head> \
  --title "@{ID}: <Summary>" \
  --body-file .claude/skills/uat-hotfix/output/{ID}.md \
  --assignee @me
```

Both refs are always explicit — none of these PRs targets `integration` by default, and two of them have a base that exists only for this hotfix.

**Merging is a human action.** If asked to merge on the user's behalf, use a merge commit (`gh pr merge --merge`), never `--squash`. Squashing collapses the `@{ID}: ` subjects that Phase 0 detects the phase from.

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
- Bumping `package.json` without the user calling this a Production hotfix

## Common mistakes

| Mistake | Consequence |
|---|---|
| Skipping the back-merge | Next release overwrites the fix; QA swimlane drifts to a deleted branch |
| Cutting `work-{ID}-BM` from `release` | Back-merge PR carries no delta against `integration` |
| Cutting `hotfix-{ID}` from `integration` | Hotfix ships untested `integration` work into UAT |
| Pulling local `release` before cutting, or continuing after the pull fails | Both branches get cut from a stale `release`, commits behind `origin/release` |
| Resetting the config on the HF branch | The swap is reverted before QA ever deploys from it |
| Rewording the `Back-merge and config reset` commit | Resumed runs miss `RESET_READY` and re-enter Phase 4b |
| Squash-merging any of the three PRs | Destroys the `@{ID}: ` subjects Phase 0 detects from |
| Committing with `git add .` | Sweeps unrelated working-tree changes into an urgent, lightly-reviewed PR |
