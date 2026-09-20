---
name: prettier-write-reformats-whole-touched-file
description: npx prettier --write on a touched LWC file rewrites it wholesale, not just changed lines
type: reference
---

`.claude/rules/local-static-analysis.md`'s Formatting section says to run `npx prettier --write <the paths you modified>` on touched files only, as opposed to a repo-wide `gulp check` run. That scoping only limits which *files* get touched, not how much of *each* file changes.

An LWC tree written at 4-space indentation while `.prettierrc` targets 2-space is the common case. Running `prettier --write` on a file in that state reformats the entire file — thousands of line changes on a file where the actual functional edit was ten lines — because the file was never prettier-clean to begin with, not because of anything the edit introduced.

**Why:** A whole-file reformat buries the real diff under a whitespace migration the task never asked for, which is exactly what the "no adjacent refactoring" / "smallest viable diff" discipline exists to prevent, and undermines reviewability.

**How to apply:** Before running `prettier --write` on a touched file, run `npx prettier --check <path>` first. If it already fails (file not prettier-clean), do not run `--write` on the whole file — hand-format only the new/changed lines to match the file's existing style instead, and note in the report that the file remains non-conformant like its siblings, with the one-line command available if the user wants the full conformance pass. If `--check` passes, `--write` is safe to run normally.

**Reading the check result — the exit code is NOT reliable here.** Earlier advice in this entry said to trust `echo $?` over truncated output. That is wrong when prettier is invoked through `npx`: `npx --no-install prettier --check <file>` returns **exit 0** on a file prettier simultaneously reports as `[warn] … Code style issues found in the above file`. A loop that prints only `exit $?` therefore reports every changed file as clean while every one of them fails. Piping through `tail` breaks it a second way, since the exit code then belongs to `tail`.

**How to apply:** judge conformance from prettier's printed text, not its exit status — a clean file prints `All matched files use Prettier code style!`, a failing one prints a `[warn]` line naming the file. Run the check without redirecting stdout, on a small enough set that the output is not truncated.
