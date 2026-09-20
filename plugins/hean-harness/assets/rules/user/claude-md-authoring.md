# CLAUDE.md Authoring Rules

Apply whenever creating or updating any CLAUDE.md file, regardless of project type or technology stack.

## The Corollary

A CLAUDE.md is not a code mirror, not a README, and not a status report. It is a list of surprises — the things a capable agent would get wrong on first contact, even after reading all the source.

## Rule 1 — Keep every CLAUDE.md file under 200 lines

Files beyond 200 lines consume disproportionate context window space and reduce instruction adherence. This is the hard output constraint — every rule that follows is a strategy for staying within it. If a file grows beyond 200 lines, split content using `@path` imports or move it to `.claude/rules/` files.

## Rule 2 — Remove anything derivable from reading the artifact

If a future reader could obtain the information by opening the relevant file, the documentation is a liability — it duplicates the source of truth and will drift. This applies to any property lists, method signatures, configuration values, directory layouts, or structural descriptions already encoded in the code, config, or metadata.

## Rule 3 — Keep anything that would surprise a capable reader of the artifact

Documentation earns its place only when it encodes something the artifact cannot express about itself:

- **Architectural intent** — why a design decision was made, not what the result looks like
- **Prohibition constraints** — things that must not be done, and why (the code shows the current state, not the rejected alternatives)
- **Non-obvious behavioral contracts** — edge cases, return value semantics, or side effects a reader would not predict from the signature alone
- **Test infrastructure hooks** — bypass mechanisms, mock entry points, or reset requirements scattered across the codebase
- **Cross-cutting invariants** — conventions that apply across many files but aren't enforced in any single one
- **External state requirements** — preconditions that must hold outside the module's own files for it to function correctly (env vars, provisioned infrastructure, sibling services, deployed assets)
- **Context-dependent behavior** — how the module behaves differently depending on execution context (runtime environment, feature flags, deployment target, host platform)

## Rule 4 — For decisions, document the why — not the what

When the code already shows what was decided, only the reasoning needs to be recorded. If you find yourself describing a structure a reader could observe by opening the file, replace it with the motivation behind it. Without the why, future agents can see the outcome but can't judge whether it still applies, whether it's safe to change, or whether a new situation is analogous.

## Rule 5 — Don't document state that decays faster than the file will be maintained

A CLAUDE.md is a durable reference, not a status update. Current task lists, recent changes, known bugs, and team assignments become misleading the moment they're written. If the information has a natural owner elsewhere (ticket tracker, git history, PR description), leave it there. Document only things that remain true across the lifetime of the module.

## Rule 6 — Make every instruction verifiable

Vague instructions ("write clean code", "handle errors properly") cannot be checked and are routinely ignored. Every instruction should be concrete enough that a reviewer could determine whether it was followed.

- Prefer "use 2-space indentation" over "format code properly"
- Prefer "run `npm test` before committing" over "test your changes"
- Prefer "API handlers live in `src/api/handlers/`" over "keep files organized"

## Rule 7 — No two instructions should contradict — ambiguity doesn't split the difference, it produces arbitrary behavior

Conflicting rules don't average out; the agent picks one unpredictably. Review the full set of instructions (including nested CLAUDE.md files and rule files loaded together) to ensure no two entries give opposing guidance for the same situation. When instructions conflict, the more specific one should win — or one should be removed.

## Rule 8 — Route each instruction to the narrowest scope that covers its use

The root CLAUDE.md loads every session for every file, consuming context window space unconditionally.

- Instructions only relevant to a subset of files → path-scoped rules (`.claude/rules/` with `paths:` frontmatter)
- Instructions only relevant to a specific workflow → skills
- Instructions personal to one developer → `CLAUDE.local.md`

Putting everything in the root file taxes every session with context that is usually irrelevant.

## Rule 9 — Ground the why in mechanism, not in identifiers that can be rewritten away

A commit hash, a PR number, a ticket ID, or a specific filename is not durable evidence — git history gets rewritten, tickets get renumbered, files get renamed or moved. State the general failure mechanism and its consequence class instead of naming the specific event that first revealed it. A rule grounded in mechanism stays true after every identifier it could have cited has gone stale.

- Prefer "a broad metadata retrieve can pull in unrelated live configuration" over "commit abc1234 pulled in unrelated configuration"
- Prefer "the referenced component no longer has a source file" over "PR #238 broke this reference"
- A concrete example still belongs in the why — describe what happened in general terms (what kind of action, what kind of drift, what kind of failure), never by the identifier of the commit, PR, or ticket that carried it