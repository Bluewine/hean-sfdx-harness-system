# Commit Message Format

Apply whenever writing a commit message in this repository.

## The shape

```
@{WORK-ID}: {Capitalised imperative summary}
```

A commit subject that names no work item cannot be traced back to what asked for the change.
Months later the diff is the only record, and someone reading release history has nothing to look
the change up by.

- **`@` then the work item reference.** Take it from the current branch name. Uppercase letters, a
  hyphen, digits — `@ABC-123`. Where a team appends a two-letter suffix, that is allowed:
  `@ABC-123-UK`.
- **One colon, then one space.**
- **`[Sonar] ` only for a Sonar fix.** Put the tag straight after the space. The PR skills list these
  commits in their own section.
- **The summary starts with a capital letter** and is in the imperative: `Add`, `Update`, `Remove`,
  `Rename` — never `Added`, `Updated`.
- **Body optional:** a blank line after the subject, then a bullet list of the non-obvious details.

```
✅  @ABC-123: Add the work type dedupe check
✅  @ABC-123-UK: Update the territory assignment flow
✅  @W-22028215: Remove the unused territory field
✅  @ABC-123: [Sonar] Remove the unused variable

❌  Add the work type dedupe check              no work item reference
❌  ABC-123: Add the check                      no @ sigil
❌  @ABC-123:Add the check                      no space after the colon
❌  @ABC-123: add the check                     summary starts lowercase
❌  @abc-123: Add the check                     work item reference is uppercase
❌  [Sonar] @ABC-123: Remove the variable       tag before the work item reference
```

## Length

Keep the subject to 10 words or fewer in the summary, and 77 characters or fewer in total,
counting the `@{WORK-ID}: ` prefix. Both limits apply — stay inside whichever is tighter.

## Writing the summary

1. Read the staged diff — `git diff --cached --stat` — and take the summary from what changed, not
   from words in the branch name.
2. Name the object, field, component or feature area the diff touches. A message that could
   describe any commit describes none.
3. Choose the opening verb from what git reports about the files: a new file is `Add`, a modified
   one `Update`, a deleted one `Remove`, a renamed one `Rename`.

## What enforces this

A hook runs before every `git commit` and refuses a subject that does not match
`^@[A-Z]+-[0-9]+(-[A-Z]{2})?:\s(\[Sonar\]\s)?[A-Z](.*)$`. It can only read a message given on the
command line with `-m`. A commit that opens an editor is checked by the repository's
`.githooks/commit-msg` instead, which applies the same pattern.

Never reach for `--no-verify` to get past it. Ask which work item the change belongs to instead.

## Reading older history

A repository may carry commits written before this convention, or under a different one — a
missing prefix, a tag before the prefix. Skills that read history tolerate those subjects on
purpose. That tolerance is for reading what already exists; it is not permission to
write a new commit in any of those shapes.
