# File Search

Apply before every search for a file, a folder, or text inside files, in every repository.

## Rules

- **Root first**: Before the first search, compare the current directory with the project root
  (`git rev-parse --show-toplevel`). In a worktree, the root is the worktree's top folder.
  When the two differ, search from the root.
- **No `cd` into subfolders**: Never `cd` into a subfolder. The working directory carries over to
  every later call. A step that must change directory goes only to a repository or worktree
  root. Use paths that start at the project root.
- **Whole root**: Search the entire project root. Narrow to a subfolder only after a search of
  the whole root, never in place of it. Leave out only `.git`, `node_modules` and
  `.claude/worktrees` (other branches' copies).
- **Search tools**: When Grep or Glob is given a path, give the project root or a folder chosen
  after a whole-root search.
- **Empty results**: Before reporting that something does not exist, run the same search for a
  file known to exist. When that search also returns nothing, the search is broken. Fix it
  before answering.
- **Report**: A "not found" answer names the folder searched and the search used.
- **Refused command**: When a hook or guard refuses a command because of its path, return to
  the project root and rerun the search with a root-relative path. Do not keep rewriting the
  same command.
