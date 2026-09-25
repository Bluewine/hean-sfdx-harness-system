---
name: memory-review
description: Reviews new and changed entries in .claude/memory and .claude/agent-memory/*/ against a commit-worthiness test, summarizes each with a verdict, and resolves accept/reject decisions — including surgical MEMORY.md index-line removal — without ever running git commit. 
---

# Memory Review

## Overview

This skill covers two distinct memory scopes, with different mechanics but the identical
commit-worthiness test:

- **Main memory** — the assistant's memory lives in two places: a global, per-project store at
  `~/.claude/projects/<project-key>/memory/` (the source of truth, written to continuously as the
  agent works) and a mirror at `.claude/memory/` inside this repo (what the team actually shares).
  This scope needs a copy step (Phase 1) and dual-location resolution (Phase 5), since a rejected
  memory must be removed from both places.
- **Agent memory** — each subagent (`developer`, `sfdx-deployer`, `lwc-tester`, and any future
  agent) keeps its own memory directly under `.claude/agent-memory/<agent-name>/`, with its own
  `MEMORY.md` index. There is no global source and no sync step — these files are written directly
  into the repo's working tree by the subagent as it works. This scope skips the copy step
  entirely and resolves in a single location (Phase 5).

Every memory captured in either scope is not automatically fit to share — some are team-wide facts
that prevent real recurrences of a mistake, and some are personal, environment-tied, or already
obvious the moment a deploy/build/test fails. This skill is the judgment layer that decides which
is which, on every new or changed memory file in both scopes, before anything is staged for commit.

This skill never runs `git commit`. It stages files (`git add`) or removes them, and reports —
the user commits manually, always.

## Task list

Before Phase 1, create a task list holding one task per phase below. Mark a task `in_progress`
when its phase begins and `completed` when it ends — this is what shows the review progressing
on screen in real time, not just a description after the fact.

1. Copy main memory's global source → repo mirror
2. Detect new / changed / deleted files in both main memory and every agent-memory directory
3. Evaluate each against the commit-worthiness test
4. Present summary, collect accept/reject decisions
5. Resolve — stage accepted files, roll back rejected ones (file + index-line surgery)
6. Report final state

## Phase 1 — Copy main memory's global source into the repo mirror

This phase covers main memory only — agent memory has no global source to copy from and is
handled entirely in Phase 2.

Resolve the repo root and project key exactly as the existing sync scripts do:

```bash
ROOT=$(git rev-parse --show-toplevel)
PROJECT_KEY=$(echo "$ROOT" | tr '/.' '-')
MEMORY_SRC="$HOME/.claude/projects/$PROJECT_KEY/memory"
```

Run `bash "$ROOT/.claude/sync-memories-to-repo.sh"`. This mirrors `$MEMORY_SRC` into
`$ROOT/.claude/memory/` and stages nothing. If it reports "no memories found," that only means
main memory is empty — do not stop the skill on this alone, proceed to Phase 2, which may still
find agent-memory changes to review.

## Phase 2 — Detect new / changed / deleted files in both scopes

**Main memory:** run `git -C "$ROOT" status --porcelain -- .claude/memory/`. Parse the output:

- `??` — new, untracked file.
- ` M` — modified relative to the last commit.
- ` D` — deleted relative to the last commit (the memory was removed from the global source since
  the last commit; this is not a commit-worthiness decision, just a fact to carry into the
  summary as "removed").

For every `??` or ` M` entry that is a memory content file (not `MEMORY.md` itself, which is the
index, not a memory), read the full file. For every ` D` entry, note the filename for Phase 5.

**Agent memory:** run `git -C "$ROOT" status --porcelain -- .claude/agent-memory/`. This needs no
prior copy step — these files already live directly in the repo. Parse the output the same way
(`??`/` M`/` D`), but group each entry by which agent's subdirectory it falls under (e.g. a hit
under `.claude/agent-memory/developer/` belongs to the `developer` agent's own `MEMORY.md`). Treat
each agent's directory independently — a `developer` memory's index line only ever lives in
`.claude/agent-memory/developer/MEMORY.md`, never in another agent's index or in main memory's
`MEMORY.md`.

If both commands produce empty output, stop — tell the user there is nothing to review in either
scope and end the skill. (In the hook-triggered case this should not happen, since the hook only
invokes the skill when at least one of the two paths is already known non-empty — but the skill
must reach the same conclusion independently when run manually.) If only one scope has changes,
proceed with that scope alone and say so in the Phase 6 report.

## Phase 3 — Evaluate against the commit-worthiness test

Apply this single test to every new or changed memory file. It is not an independent multi-axis
grid — any one NO-Commit condition below disqualifies a memory regardless of how "generalizable"
it otherwise sounds.

**The deciding question:** *If this memory didn't exist, would the agent likely repeat the mistake
or waste a retry-cycle rediscovering the fix — or would it just re-arrive at the right
understanding naturally from the tool's own output?*

**NO Commit** — any of these disqualifies the memory:

1. Abnormal, but the agent would naturally catch and understand it again on its own just by going
   through its normal steps — no special prior knowledge is needed to interpret what happened.
2. The mistake surfaces as an immediate, unambiguous failure (deploy/test/build fails outright,
   with output that plainly explains the problem) — nothing is silently wrong, so there's no risk
   of proceeding on a false belief of success.
3. Tied to a personal dev environment specific (e.g. a target org alias) — a literal
   environment-configuration fact that doesn't generalize across the team, not merely a stylistic
   preference.

**Commit** — facts, conventions, or requirements that need a standing written reminder to prevent
a real recurrence: cases where, without the memory, an agent would likely repeat the mistake or
waste effort rediscovering the fix. This explicitly includes concrete command/flag conventions
(e.g. "retrieves in this repo always need `--ignore-conflicts`") even when the immediate symptom
of skipping the flag is visible, because the *correct fix* is not derivable from the error message
alone.

For each file, write down: what it says in plain language (define any jargon inline, no
acronym-stacking), which NO-Commit condition applies (quote the exact condition number) or why it
passes the Commit test, and the resulting verdict.

**Mid-review new memories:** if Phase 1's copy or Phase 2's diff (in either scope) turns up a
memory file that was not anticipated (e.g. it appeared between the hook's trigger and this phase
running, or a subagent wrote a new agent-memory file during the same session), evaluate it with
this same test before finalizing the Phase 4 summary. This is not a required step to hunt for —
only handle it if such a file is actually present in Phase 2's diff for that scope.

## Phase 4 — Present summary, collect decisions

Present one entry per new/changed file, grouped by scope (main memory, then each agent's
directory in turn): filename, what it says, the verdict and its reasoning from Phase 3. Present
deleted files (from either scope's ` D` entries) as informational — they will be mirrored as
deletions in Phase 5 regardless of verdict, since they reflect an intentional removal already made
at the source (the global source for main memory; the agent-memory file itself, since there is no
separate source for that scope).

Ask the user (a single `AskUserQuestion` call, or plain conversational confirmation if the batch
is small and unambiguous) whether to accept the recommended verdicts as-is, or override specific
files. The user may also ask for a file to be excluded even if this skill recommended committing
it, or the reverse — the final call is always the user's.

## Phase 5 — Resolve

Shell variables do not persist across separate Bash tool calls — re-derive them here rather than
assuming Phase 1's `$ROOT`/`$MEMORY_SRC` are still set:

```bash
ROOT=$(git rev-parse --show-toplevel)
PROJECT_KEY=$(echo "$ROOT" | tr '/.' '-')
MEMORY_SRC="$HOME/.claude/projects/$PROJECT_KEY/memory"
```

**Main memory** — for every file with a final "commit" decision:

```bash
git -C "$ROOT" add ".claude/memory/<filename>.md"
```

Its `MEMORY.md` index line is already present in the repo mirror from Phase 1's copy — leave it as
part of the same `git add` when staging `MEMORY.md` itself (stage `.claude/memory/MEMORY.md` once,
after all accept/reject edits to it in this phase are complete, not once per file).

For every main-memory file with a final "reject" decision, or every ` D` entry from Phase 2:

1. Delete the file from the repo mirror: `rm "$ROOT/.claude/memory/<filename>.md"` (skip if it's a
   `D` entry that's already gone from the mirror after Phase 1's copy).
2. Delete the file from the global source: `rm "$MEMORY_SRC/<filename>.md"` (skip if already
   absent — a ` D` entry means it's already gone from the source).
3. Remove its corresponding line from `MEMORY.md` in **both** `$ROOT/.claude/memory/MEMORY.md` and
   `$MEMORY_SRC/MEMORY.md`. Locate the line by matching the markdown link target
   `(<filename>.md)` — this is unambiguous because every index line links to exactly one memory
   file. Use the `Edit` tool to remove only that one line; do not rewrite or reformat any other
   line in the file.

**Agent memory** — single location, no global source to reconcile. For every file with a final
"commit" decision, under agent `<agent-name>`:

```bash
git -C "$ROOT" add ".claude/agent-memory/<agent-name>/<filename>.md"
```

Its `MEMORY.md` index line lives directly in `.claude/agent-memory/<agent-name>/MEMORY.md` — stage
that file once after all edits to it in this phase are complete, same as main memory's index.

For every agent-memory file with a final "reject" decision, or every ` D` entry from Phase 2 under
that agent's directory:

1. Delete the file: `rm "$ROOT/.claude/agent-memory/<agent-name>/<filename>.md"` (skip if it's a
   `D` entry that's already gone).
2. Remove its corresponding line from `.claude/agent-memory/<agent-name>/MEMORY.md` only — never
   touch another agent's index or main memory's `MEMORY.md` for an agent-memory rejection.

**If the link target cannot be found unambiguously** in any `MEMORY.md` file involved — main
memory's repo mirror, main memory's global source, or an agent's own index (e.g. the line's
wording was hand-edited since, or the file appears under a different link text than expected) —
stop and ask the user which line to remove — do not guess, and do not leave a stale index line or
delete the wrong one. Show the user what you found (the full set of lines containing anything
resembling the filename) and let them point to the correct one, or confirm none exists.

Never run `git commit` in this phase or any other.

## Phase 6 — Report

State plainly, grouped by scope (main memory, then each agent touched): which files are now staged
and ready for the user's own `git commit`, which files were excluded (with a one-line reason each,
referencing the Phase 3 verdict), and which were mirrored as deletions. If nothing ended up staged
in a scope that had changes (every file in it was rejected), say so explicitly for that scope
rather than implying a no-op. If one scope had no changes at all (e.g. only agent memory changed,
main memory didn't), say so as well rather than silently omitting it.
