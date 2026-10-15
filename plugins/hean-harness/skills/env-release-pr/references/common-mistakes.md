# Common mistakes

| Mistake | Correction |
|---|---|
| Rows built from commit subjects | Rows are stories; dedupe work IDs and use the Linear title |
| One story split across several rows | Dedupe on work ID — many commits, one row |
| Row set pulled from a Linear cycle or board | Only `git log {BASE}..{HEAD}` defines the row set |
| A work ID given a row because the tracker knows it, though it has no commits of its own here | Being in the tracker proves the issue exists, not that it was delivered here; require at least one commit of its own |
| Hotfix story dropped because its fix already reached `BASE` | Every candidate Test 1 kept is a row; Test 2 classifies, it never drops |
| Hotfix row included silently | Name it in the closing report, or the table reads as a claim that the fix ships today |
| "Already deployed" written into a table cell or an extra column | The table's four columns are fixed; say it in the closing report |
| Hotfix block reduced to a count | Name every work ID and title; a count says a category exists, not which story |
| Stories left out because their diff touches no deployable metadata | Wrong test — how the work reached `BASE` is what matters, and no answer to that leaves a story out |
| A prior release PR's body cited as precedent | Prior bodies reproduce prior errors; re-derive from the range every run |
| Stale refs after a failed fetch | Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-remote-refs.mjs" {BASE} {HEAD}`; a non-zero exit stops the run |
| Reimplementing the freshness check inline | It lives in one shared script so it cannot drift; a `sed`-based rewrite already broke it silently on one platform |
| Issue URL slugified from the title | Copy `url` from `get_issue` verbatim |
| Workspace slug hardcoded in the sprint link | Take it from the `url` Linear returned |
| Sprint cell filled with the `cycleId` UUID | Map via `list_cycles`; use `title` and `number` |
| Sprint blocks ordered by cycle `number` | Numbers restart per team; order blocks by `startsAt` |
| Work IDs sorted as text within a sprint | Compare the numeric part as a number — `-96` precedes `-146` |
| Assignee inferred from commit author | Use Linear's `assignee`; commit author is who pushed, not who owned |
| Unresolvable work ID quietly dropped | Surface it at the checkpoint; never guess a substitute |
| Run abandoned because Linear is not connected | Fall back to asking per work ID; say how many questions that is first |
| Sprint link built from parts in the fallback path | Take the URL the user pasted verbatim, as with the issue URL |
| Story with no start date slotted into a sprint block | It forms its own block, placed last; never invent a date to place it |
| Decisions asked in three separate messages | One consolidated checkpoint carries every open item |
| Deployment wording read as an instruction to change `BASE` after the kind is settled | Phase 0 settles the kind once; `BASE` and `HEAD` follow from it and nothing later redirects them |
| Kind guessed from the current branch, open PRs or the calendar | Only the Phase 0 rules decide; otherwise ask, or return the needs-input line to the caller |
| Kind question attempted inside a subagent | `AskUserQuestion` is absent there; return the needs-input line before any git or GitHub call |
| A `prod` request and a PR based on `release` resolved by picking one | Stop, report both, and ask |
| Runlist URL reused from a prior PR | It is per-deployment; ask for it. The same PR's own runlist is not a prior PR's |
| `DEPLOY_DATE` defaulted to today | Release champions set deployment dates; ask for it, never read the clock |
| Placeholder date shown at the checkpoint to fill the title | An invented date reads as decided and gets approved unnoticed; leave it unresolved |
| Title recomputed when updating | Take it from the existing PR; it already carries the champion's date |
| `--title` passed to `gh pr edit` | Body plus named people only; the title is the deployment's identity |
| `--assignee @me` added because the person running the skill opened the PR | Release champions lead releases; pass only people the requester named |
| Assignees or reviewers copied from an earlier release PR, CODEOWNERS or Linear | Only the requester's arguments or words name people |
| `--remove-assignee` or `--remove-reviewer` on update | People already on the PR stay |
| Update presented as a fresh table | Show it as a diff — rows added, removed, moved |
| Extra headings or a summary added to the body | The body is the table plus the runlist line, nothing else |
| PR opened without the review gate | Write the file, wait for an explicit `yes`, then submit |
| Body file named as plain text, or as a relative path | Give it as an absolute path ending in `:1`, which the terminal makes clickable |
| `$BODY_FILE` reused in a later command | Shell variables do not survive between commands; set it again in each one |
| Closing report names only the PR | Name the body file too; it is the review artifact and stays on disk |
| An answered input mistaken for approval | Confirming a branch or title is not `yes` |
| Something unsettled shown as a note rather than asked | Give it a number and say which answers it takes; what you found and what you need answered are separate |
| Checkpoint treated as settled because one question was answered | Each numbered question needs its own answer; list the ones still open and ask again for only those |
| A default acted on because nobody objected | Silence decides nothing; an unanswered question stops the run |
| Worktree cleaned up on the skill's own judgement | Ask; anything other than an explicit `remove` means keep |
| Approval to publish read as approval to clean up | Two separate decisions, two separate answers |
| Worktree removed while a question was still open | Phase 9 runs only when nothing is outstanding |
| `git worktree remove --force .` run from inside | It succeeds and strands the shell in a deleted directory; run it from the main working copy |
| Worktree removed and the branch left behind | Removal does not delete the branch; `git branch -D` is a separate step |
| Body file lost with the worktree | It is untracked, so copy it into the main working copy before removing anything |
| `ExitWorktree` expected to clean up a hand-made worktree | It only touches one `EnterWorktree` made this session; otherwise give the user the git commands |
| User's hand edits re-rendered away | After `yes`, submit the file as it stands |
