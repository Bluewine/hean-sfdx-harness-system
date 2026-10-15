# Hotfix stories

**Leaving a hotfix story out loses it silently.** A hotfix goes straight to `release` on its own branch,
and the only thing that reaches `integration` afterwards is the commit copying it back. A rule that drops the
story on that basis removes it from the deployment PR and leaves nothing on screen to show a decision
was taken — and nobody can check a row that is not there. The hotfix route is also always the same
shape: a hotfix always has a copy-back branch. So a story that took that route is a known case to
label, not an odd one to weigh up.

The hotfix path uses branch names the `work-{WORK-ID}` convention does not cover:

| Branch | Merges into | Meaning |
|---|---|---|
| `hotfix-{WORK-ID}` | `release` | the deployed fix |
| `work-{WORK-ID}-HF` | `hotfix-{WORK-ID}` | work on the fix |
| `work-{WORK-ID}-BM` | `integration` | the back-merge |

**For `prod`.** A hotfix merges into `release`, which is `HEAD` here, and reaches `master` only through a production release. So the `hotfix-*` merge subjects Test 2 looks for appear in `master` history only after an earlier production release carried them there. A story whose hotfix reached `master` that way, and whose copy-back commit only now reaches `release`, is the third kind in the Test 2 table in `SKILL.md`: its fix is already live in production, and the closing report names it. A hotfix that is in `release` but not yet in `master` is the first kind: it goes out with this PR.

**Read the `BASE`-side commits to tell the last two apart.** For `uat`, a `hotfix-*` merge subject means the fix
went out on its own; a `HEAD` → `BASE` merge subject means it went out with a previous deployment. For `prod`, both
subjects reach `master` inside earlier production releases: a `hotfix-*` merge subject in `master` history means the
fix went live in an earlier production release, ahead of the rest of its story.
`backmerge ≥ 1` supports the hotfix answer but is not required, because the copy-back commit can arrive
on a differently-named branch.
