---
name: flow-description-comment
description: Dated change-log verifier for Flow metadata — reads each staged Flow against the top entry of its description, adds or sharpens that entry only when the staged change is not already covered, never touching the entries beneath it, then retries the blocked commit
---

# Flow Description Comment

## Overview

`flow-description-gate.sh` blocks `git commit` whenever staged Flow metadata changes haven't
been verified for a dated description entry. This skill is the verification and remediation
step it invokes. It never skips a genuinely unverified change and never touches a Flow that
wasn't actually staged.

A Flow's top-level `<description>` holds two zones — a dated change log on top, and one undated
standing note beneath it. Every example in this file is invented to show shape and register; none
describes a real flow, and any resemblance to one is incidental:

```
<description>7/29 - Notify the primary contact only (ABC-123).
5/5 - Stop the send failing when no email is on file.
4/16 - Require a full name before sending.
Recipients are resolved from the account&apos;s current primary contact. Changing that contact redirects future notifications immediately; already-queued sends are unaffected.</description>
```

Dated entries use `M/D - <reason>`: no year, no leading zero on month or day, newest prepended on
top.

**The top entry is live; everything beneath it is closed.** The entry at the top of the stack is
the current statement about this flow and may be rewritten in place. Every entry below it is
history — never edit, correct, reword or remove one, whatever its date and whoever wrote it.
Position in the stack decides this, not the date on the entry. The standing note sits below the
stack but is not part of it, and is governed separately — see "Description content rules".

**Top-level only.** A Flow's own `<description>` sits at exactly 4-space indent, as a direct
child of the flow root. `variables`, screen fields, and other sub-elements also carry their own
`<description>` children at deeper indent — never touch those; they are unrelated to this
requirement.

**An entry is never "already handled" because of its date.** Every commit re-reads the top entry
against the *current* staged diff and asks one thing: does that entry account for what is staged?
Content answers it; the date never does.

That matters in both directions. A Flow committed several times in one day already carries a
`TODAY - ...` line, written against an earlier and smaller diff — it does not cover what has since
been added, so the top entry gets rewritten to cover it. A Flow arriving from elsewhere carries an
entry with an older date that describes precisely what is staged — it covers it, so nothing is
added and nothing is touched. Both follow from the same question.

## Description content rules

A Flow's top-level `<description>` renders in Setup → Flows and in the Flow Builder properties
panel. Its reader is an admin looking at the flow list, not an engineer reading the XML. Every
rule below follows from that.

**The two zones are written and maintained differently.**

- **Dated entries** (`M/D - ...`, newest on top) are append-only history — one per commit. Each
  records what changed and what was expected *at that moment*. An entry with a successor is
  **expected to become false** as the flow evolves; that is what makes it history rather than
  documentation. The top entry is the current statement; everything beneath it is the record of
  how the flow got here. Never correct, edit, or remove an entry once a later one sits above it —
  a superseded entry that has gone stale is working as intended, not a defect to repair.
- **The standing note** — undated, sitting below every dated entry — states what the flow does and
  what an admin must know to work with it safely. It is a live claim about current behavior, not
  history. **Rewrite it in place when it stops being true. Never date it, never prepend to it,
  never add a second one.** Treating it as another log line is the failure mode to avoid.

**Short enough to be read standing up.** An admin scanning the flow list reads the first few words
and stops. Whatever is not in those words is not read.

- **Lead with the change.** The first three to five words carry it. "Stop the send failing when no
  email is on file" works, because the first three words are the point. "Following a report from
  the field, the notification logic has been adjusted so that" fails — five words in, the reader
  still knows nothing.
- **One short phrase.** A second only when it earns its place: a consequence the admin will hit,
  or a limit that would otherwise surprise them. A third almost never earns it.
- **Never span a line.** If the entry wraps in a normal editor window it is too long, whatever the
  character count says.

**210 characters is the hard stop, not the target.** It exists to catch an entry that ran away,
not to be filled; an entry at 190 has already lost its reader, and most good entries sit well
under half of it. Count the raw line including the `M/D - ` prefix and any XML entities
(`&apos;` costs six characters, not one). The ceiling binds dated entries only — when a change
needs more explanation than a short phrase, that explanation belongs in the standing note, and the
dated entry still gets the short version.

**Name observable behavior, never internals.** Prohibited in both zones: Flow element names,
variable names, object and field API names, platform event API names, picklist API values. The
reader cannot see any of them, and the diff already records them permanently.

**Keep the gotchas — state them generally.** A gotcha earns its place when acting on it prevents
a silent failure. State the consequence, not the mechanism: "a certification is matched by name
alone, so renaming one silently stops it counting" belongs; the element performing the match does
not.

**Route do-not-edit constraints elsewhere.** A rule aimed at whoever edits this flow next — an
entry condition that must not be narrowed, an element type the context forbids — is engineering
guidance, not a change log entry. It belongs in `.claude/rules/flow-conventions.md`. Putting it in
the description hides it from the engineer who needs it and shows it to the admin who does not.

**Shape to copy.** Dated entries, each readable at a glance:

```
7/29 - Notify the primary contact only (ABC-123).
5/5 - Stop the send failing when no email is on file.
4/16 - Require a full name before sending.
```

Two phrases, where the second is a consequence worth knowing:

```
6/3 - Re-derive certification status from the account&apos;s records (ABC-123). Safe to re-run.
```

An invented first-time description carrying both zones. The dated entry gives the purpose briefly;
the standing note is where the operational detail goes, in the admin's own terms, saying what to
do instead of the thing that will not stick:

```
6/3 - Keep certification status in step with the account&apos;s records (ABC-123).
Certification status here is maintained automatically from the account&apos;s certification records. Setting it by hand may work, and may be undone without warning the next time any certification on that account changes. To hold a status deliberately, adjust the underlying certification records instead.
```

**What too long looks like.** Both of these say something true, and both lose the reader first:

```
6/3 - Following a review of how certification statuses were being maintained, this flow now re-derives an account&apos;s certification status from its current certification records (ABC-123).
6/3 - Re-derive an account&apos;s certification status from its current certification records (ABC-123). Safe to re-run any time; every certification on the account counts, not just the changed one.
```

The first buries the change behind its own preamble. The second leads correctly and then keeps
going — its closing phrase is standing-note material sitting in an entry.

## Task list

Create a task per phase below before starting.

1. Detect staged Flow files
2. Verify, adjust, or add an entry per file
3. Write the verification marker
4. Retry the original commit

## Phase 1 — Detect staged Flow files

```bash
ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" diff --cached --name-only -- '*.flow-meta.xml'
```

If this is empty, there is nothing to verify — skip directly to Phase 3.

**Never ask how a change arrived.** A Flow can be staged because work happened on this branch,
because the merge-base was merged in, because a commit was cherry-picked, or because a rebase
replayed it. None of that changes what Phase 2 does, because Phase 2 asks about the description's
content rather than the change's origin. A Flow that arrived carrying an entry describing exactly
this change is already correct, and Phase 2 leaves it alone — the answer the merge case needs,
reached without detecting a merge.

## Phase 2 — Verify, adjust, or add an entry, per file

For each staged Flow file from Phase 1:

1. Read its staged diff: `git -C "$ROOT" diff --cached -- "<file>"`. This is the change being
   committed — what is written below must reflect it specifically, not a generic placeholder. When
   the file is newly added, the diff is the whole flow: read it for the flow's purpose rather than
   for a change.
2. Compute today's date in the team's format:
   ```bash
   TODAY=$(date +%m/%d | sed -E 's#(^|/)0([0-9])#\1\2#g')
   ```
3. Find the top-level `<description>` line — the one at exactly 4-space indent
   (`grep -E '^    <description>'` against the file's current full content, not the diff).

**The question is always the same: does the top entry already account for everything this diff
stages?** Answer it by reading the diff against that entry. The date decides nothing — an entry
written weeks ago, or on another branch, is correct if it describes what is staged; an entry
written today is not correct merely for being today's.

Exactly one of these applies.

- **No description at all — a first-time description.** No 4-space-indented `<description>` exists.
  The flow is brand new, so there is no "what changed" to state — the flow *is* the change, and
  answering literally produces an unbounded dump. Write both zones: a dated `TODAY - <purpose>`
  entry giving the flow's purpose in one short phrase, and beneath it an undated standing note
  carrying what an admin must know to work with it safely. Position the new `<description>`
  immediately before `<environments>` (alphabetical XML ordering — see `flow-conventions.md`).
- **The top entry does not account for the diff.** Prepend a new `TODAY - <summary>` line inside
  the existing tag, above everything already there. Every prior entry stays exactly as it is,
  below the new one. Leave the standing note at the bottom.
- **The top entry accounts for the diff, but reads weakly.** Nothing needs adding. Rewrite that
  single line in place to say it better — front-loaded, short, no internals. Keep its date, do not
  add a second line for the same day, and do not touch anything below it.
- **The top entry accounts for the diff and reads well.** Leave the file untouched and do not
  re-stage it.

Write every summary as a genuine description of what changed — never a restatement of the commit
message, never a placeholder like "update flow". A first-time entry states purpose, not change.
All of them are governed by "Description content rules" above.

Separately, and whichever case applied: if the staged diff makes the existing standing note
untrue, rewrite the note in place in the same commit — a stale standing note is worse than none.
This applies to the standing note alone. Dated entries the diff has falsified stay exactly as
written; the newer entry supersedes them, and that is the point of keeping them.

4. Re-stage the file if you changed it: `git -C "$ROOT" add "<file>"`. A file left untouched needs
   no re-staging.

**Report per file which of the four outcomes applied** — first description written, entry added,
top entry sharpened, or left as it was. When a Flow was left alone, say which entry already
covered it. That is what shows a merge or a cherry-pick was handled correctly rather than skipped
by accident.

## Phase 3 — Write the verification marker

```bash
ROOT=$(git rev-parse --show-toplevel)
node "${CLAUDE_PLUGIN_ROOT}/hooks/flow-description-gate.mjs" --mark-verified
```

Run this even when Phase 1 found nothing staged — the hash of an empty diff is itself a valid,
stable marker, so the gate won't invoke this skill again for a commit with no Flow changes.

## Phase 4 — Retry the original commit

Re-run the exact `git commit` command originally attempted. The gate will recompute the staged
Flow diff hash, find it matches the marker just written, and allow it through.
