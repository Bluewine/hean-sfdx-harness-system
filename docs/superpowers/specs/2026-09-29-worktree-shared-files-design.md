# Worktree shared files — design

Date: 2026-09-29. Status: approved on 2026-09-29.

## Goal

A change made inside a linked git worktree to a shared git-ignored file reaches the main checkout, so
every worktree of the repository and the main checkout see one version of it.

## What the user decided

- **Shared files:** `.mcp.json`, every file under `.claude/agent-memory/<agent>/`, and every
  `.claude/rules/*.md` file. `git worktree add` checks out committed files only, so a new worktree has
  none of the git-ignored rules setup installed in the main checkout (checked on 2026-09-29).
- **Already handled:** `.claude/hean-harness.json` always lives in the main checkout (separate, approved
  change; no link needed).
- **Out of scope for now:** `.sf/config.json` (the Salesforce CLI target org may differ per worktree on
  purpose).
- **Conflicts:** when the worktree's copy and the main checkout's copy differ, the user is asked, per
  file, to merge, keep the worktree's copy, or keep the main checkout's copy.

## What Claude Code already does

- `settings.local.json` is read from the main checkout in a worktree session.
- Auto memory is shared by every worktree of a repository.
- `.worktreeinclude` copies git-ignored files from the main checkout into a new worktree, only at
  creation. Nothing copies changes back.
- A subagent with `isolation: worktree` gets its own copy of `.claude/agent-memory/<name>/` in the
  worktree.
- Registering `WorktreeCreate` replaces Claude Code's worktree creation, so the plugin does not use it.
- `SessionStart` and `SessionEnd` hook input carries `cwd`, which is the worktree folder in a worktree
  session.

## Mechanism

1. A shared-path list lives in one place in the plugin (`scripts/lib/worktree-share.mjs`): `.mcp.json`,
   the files under `.claude/agent-memory/*/`, and `.claude/rules/*.md`. Only files are linked, never
   folders.
2. A path is shared only when git ignores it in the main checkout. A tracked `.mcp.json` belongs to the
   team and is left alone.
3. A new hook, `hooks/worktree-share.mjs`, runs on `SessionStart` and `SessionEnd`. It does nothing
   unless `cwd` is inside a linked worktree (its git-common-dir parent differs from its own top folder).
4. For each shared path, the hook compares the worktree's entry with the main checkout's file:

   | Worktree entry | Main checkout | Action |
   |---|---|---|
   | missing | file | create a symlink in the worktree to the main file |
   | symlink to the main file | file | nothing |
   | real file | missing | move the file to the main checkout, then link |
   | real file, same content | file | replace it with a link |
   | real file, different content | file | conflict: change nothing, report it |
   | missing or link | missing | nothing |

5. A tool that writes through the link changes the main checkout's file directly. A tool that replaces
   the link with a new file is caught by the next check (session end, or the next session start).

## Conflicts

1. On `SessionStart`, the hook prints (plain output, which Claude Code adds to the session's context)
   each conflicting file with both paths. It tells Claude to ask the user about each file before other work, in one `AskUserQuestion`
   per file with three options: `Merge`, `Keep worktree copy`, `Keep main copy`.
2. The answer is applied by a script command:
   `node "<plugin>/scripts/worktree-share.mjs" resolve --file <shared path> --keep worktree|main|merged [--merged-from <file>]`,
   run from inside the worktree (the command acts on the current folder).
   - **Keep worktree copy:** the main checkout's file is saved to `~/.claude/hean-harness/backups/`, the
     worktree's content replaces it, then the worktree entry becomes a link.
   - **Keep main copy:** the worktree's file is saved to the backups folder, then replaced with a link.
   - **Merge:** Claude writes the merged content to a temporary file and shows it to the user; the
     command backs up both copies, writes the merged content to the main checkout, and links.
3. On `SessionEnd`, conflicts are not asked about (the session is closing); the next `SessionStart` in
   that worktree reports them.

## Limits

- A worktree used only from a plain terminal, with no Claude Code session starting or ending there, is
  not checked.
- Where a symlink cannot be created, the hook reports it and leaves the file as it is.
- Uninstall does not remove links in worktrees. When uninstall removes the main checkout's files, those
  links point at nothing until a reinstall puts the files back; the hook treats them as already linked.

## Tests

In the existing `check()` style, in temporary repositories with a linked worktree:
- each row of the action table, for `.mcp.json` and for an agent memory file;
- a tracked `.mcp.json` is left alone;
- a session in the main checkout, or outside any repository, changes nothing;
- the conflict report lists each differing file; each `resolve --keep` value produces the right content
  in the main checkout, a link in the worktree, and a backup;
- the hook exits 0 and prints nothing on every path where nothing is shared.

## Documentation

- Register the hook in `hooks/hooks.json` under `SessionStart` and `SessionEnd`.
- Add a `docs/wiki-coverage.md` row for the new hook, marked `pending` (the user chose a dedicated
  entry on the Hooks page).
- Add a line to the README if the user wants it.
