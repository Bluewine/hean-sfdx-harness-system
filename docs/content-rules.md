# Content rules

Applies to every file shipped in the plugin: memories, rules, skills, agents.

The plugin goes to teams who cannot see this repository. Anything they cannot check, reproduce or
apply is dead weight, and dead weight that looks authoritative is worse than none.

## 1. Only facts that hold across projects

Write what is true of Salesforce, of the tooling, or of internal Salesforce projects generally.
Do not write what is true of one repository.

- **Keep:** platform behaviour, framework behaviour, tooling behaviour, conventions that every
  internal Salesforce project follows.
- **Remove:** anything whose truth depends on this repository's code, org, sandboxes, teams,
  pipeline or feature set.

`SFCORE_*` is the exception that proves the rule. It is a managed package anyone can install, so
those class and method names must survive verbatim everywhere — never rename, never generalise.

## 2. No dated justification

A date in prose is a signal that a specific file, class, org or test run is about to be named.
Both go.

> Confirmed via `sf apex run test` in `SomeTest` (2026-09-04): three methods failed to match.

Nobody else can run that. Write the mechanism instead:

> A method taking a `List<X>` parameter fails to match, and the failure is silent.

This covers every form: "confirmed live on", "measured on", "verified against", "observed in",
"reproduced with", "captured", "this session", "an earlier version of this note".

## 3. General example, or no example

Try to write the example generally first. When the example is irreducibly tied to this
repository — a class only here, a component only here, a folder only here — omit the phrase.

**Then re-read the whole file.** If the phrase could not be generalised, the topic may not be
general either. Ask whether what remains is a fact another team can use, or only a note about
this codebase wearing a fact's clothes.

When the topic itself turns out to be repo-specific: decommission the file, exclude it from the
plugin, and **say so explicitly in the report.** A silent deletion looks like an oversight.

## What this rules out, concretely

| Do not write | Because |
|---|---|
| A sandbox or org alias | Nobody else has that org. Say "the connected and selected org". |
| A class, method or component that exists only here | Renaming it makes a phantom reference, which is worse. |
| A repository path used to scope advice | The rule is about a platform context, not a folder. |
| A work-item prefix as anything but an illustration | Prefixes belong to teams. |
| A date attached to a claim | See rule 2. |
| A count from one run — "157 files", "22 consecutive runs" | Unreproducible, and it dates the entry. |
| The history of the note itself | "An earlier version of this note said..." helps nobody. |

## Commit and PR subjects

Whenever a file we ship shows a git commit message or a PR title in the form `@{ID}: {Description}`,
**the description starts with a capital letter.** That holds for a literal phrase, for a
placeholder standing in for one, and for an exact string some other step matches on.

A phrase that another step greps for is written once and matched once, so its capitalisation is
part of the contract: change it in one place only and the match silently stops finding it.

## What a naming convention is instead

A convention about names — Apex classes, components, branches, commit subjects — is a project
choice, not a fact. It belongs in the local settings file, asked for during setup, enforced only
when the team recorded one. Never write one into a rule as though it were universal.
