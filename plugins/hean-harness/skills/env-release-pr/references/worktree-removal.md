# Worktree removal

On `remove`, copy the body file into the main working copy first, so the deployment's review artifact
survives the directory it was written in:

```bash
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
WT=$(git rev-parse --show-toplevel)
BRANCH=$(git branch --show-current)
REL=".claude/skills/env-release-pr/output/{KIND_FILE}-{DEPLOY_DATE}.md"
mkdir -p "$MAIN/$(dirname "$REL")"
cp "$WT/$REL" "$MAIN/$REL"
echo "$MAIN/$REL:1"
```

Then leave and remove. Which command does it depends on how the worktree came to exist, and getting
this wrong is the one failure in this phase that cannot be undone:

- **The worktree was created by `EnterWorktree` in this session** — call `ExitWorktree` with
  `action: "remove"`. It restores the session's directory as well as deleting the worktree and its
  branch. It refuses while uncommitted or unmerged work is present and lists what it found; pass
  `discard_changes: true` only after showing that list to the user and getting a second explicit
  answer.
- **The worktree came from anywhere else** — a `git worktree add` run by hand, or a previous
  session. `ExitWorktree` does nothing at all in that case, by design. Give the user these commands
  to run themselves, from the main working copy:

  ```bash
  cd "{MAIN}"
  git worktree remove --force "{WORKTREE_PATH}"
  git branch -D "{BRANCH}"
  ```

**Never run the removal from inside the worktree.** `git worktree remove --force .` succeeds from
there and leaves the shell in a directory that no longer exists, so every command after it fails for
a reason that has nothing to do with what it was trying to do. Change to the main working copy first.

**Removing a worktree does not delete its branch.** That is a separate command, which is why it is
listed separately above. A cleanup that stops after the directory leaves the branch behind, and the
next run of this skill finds a branch nobody expected.
