# Configurable Apex and LWC naming prefix and suffix

Date: 2026-10-11. Approach B + C chosen in chat on 2026-10-11.

## Purpose

Two shipped rules govern names: `assets/rules/project/apex-naming-conventions.md` (Apex classes)
and `assets/rules/project/lwc-naming-conventions.md` (Lightning Web Components). Both are
path-scoped guidance; no hook checks a name.

Each rule decides its prefix in one section, "Find the project's prefix first", by telling the agent
to run a shell scan of existing names and take the most common token. Checked in a client repository
on 2026-10-11:

- Under zsh the scan finds `REWSFS_` (57 classes) and `rewsfs` (37 components).
- Under bash the same command prints nothing: without `globstar`, `**` matches one folder level, and
  SFDX classes sit in `force-app/main/default/classes/`. The rule then reads "no common prefix
  appears, the project does not use one", so an agent on bash names a class without the prefix,
  silently.
- The scan is advice the agent may skip, two sessions can read different tokens, and neither rule
  knows a suffix.

This change saves a per-repository answer (use or not, prefix, suffix, per type), asked once and
suggested from the code. The rules point to it (B), and a hook refuses a new Apex class or LWC whose
name does not match it (C).

## Decisions (user, 2026-10-11)

- Apex and LWC each have their own answer: use yes/no, prefix, suffix. Prefix only, suffix only and
  both are allowed.
- "No" turns off only the prefix/suffix guidance; the rest of each rule (length, casing, `Test`,
  abbreviations, checklist) stays.
- Both setup and `/hean-harness:start-implementation` ask when no answer is saved; each suggests the
  answer found in the repository's existing names.
- Suffix placement: the suffix ends the production name; `Test` is always last. Apex prefix `ABC_`,
  suffix `_UK`: `ABC_AccountService_UK`, test `ABC_AccountService_UKTest`. LWC prefix `abc`, suffix
  `Uk`: `abcAccountPickerUk`, test `abcAccountPickerUkTest`.
- No rule generation. Each shipped rule changes in one section only: the scan is replaced by an
  instruction to use the saved answer. Rule files are copied as today.
- Enforcement is a hook on name creation (C), because guidance alone (today, and B) can be skipped.

## Saved answer

Key `naming` in the main checkout's `.claude/hean-harness.json` (read and written through
`scripts/lib/settings.mjs`, so every linked worktree shares it):

```json
"naming": {
  "apex": { "use": true,  "prefix": "ABC_", "suffix": "_UK" },
  "lwc":  { "use": false }
}
```

- A type with `use: true` has at least one of `prefix` and `suffix` non-empty.
- A missing `naming` key, or a missing type, means not asked yet.

Validation, refused with the reason:

| Type | Prefix | Suffix |
|---|---|---|
| Apex | starts with a letter; letters, digits and `_`; no `__` | letters, digits and `_`; no `__`; does not end with `_` |
| LWC | starts with a lowercase letter; lowercase letters and digits only | starts with an uppercase letter or a digit; letters and digits only |

- Apex: prefix plus suffix longer than 20 characters is refused, to keep names well under the
  platform's 40-character class name limit ([deploy error "Type name too long, maximum length is 40"](https://github.com/afawcett/declarative-lookup-rollup-summaries/issues/25)).
- LWC: the platform requires a folder name to begin lowercase, use only letters, digits or `_`, not
  end with `_`, not contain `__` or a hyphen ([LWC Component Folder](https://developer.salesforce.com/docs/platform/lwc/guide/create-components-folder.html));
  the shipped LWC rule also bans underscores, so the LWC prefix and suffix use letters and digits only.
- The Apex identifier characters are taken from the existing Apex rule; confirm them against the Apex
  Developer Guide while planning and cite the page in the plan.

## Script `scripts/naming.mjs`

| Command | Does |
|---|---|
| `status` | Prints the saved answer per type. Exit 0 when both types are answered, 2 when either is not. |
| `suggest` | Scans the repository in Node (no shell globbing, so the same on zsh and bash): Apex `*.cls` names and LWC folder names under every package folder in `sfdx-project.json`. Prints per type the most common prefix and suffix with counts and the share of names that carry them, or "none found". Read-only. |
| `set apex\|lwc --use yes\|no [--prefix X] [--suffix Y]` | Validates and saves the answer for that type. |
| `expect apex\|lwc <name>` | Prints whether a name matches the saved answer and, when not, the expected form. Used by the hook and by tests. |

Suggestion rule: a prefix is the leading token shared by at least 60% of names (Apex: up to and
including the first `_`; LWC: the leading lowercase run before the first uppercase letter); a suffix
is the trailing token shared by at least 60% of names after removing a trailing `Test`. Below 60%,
the suggestion is "none".

## B: the rules point to the saved answer

In each shipped rule, replace the section "Find the project's prefix first" (and only it) with a
section that tells the agent:

- The project's naming answer is saved in `.claude/hean-harness.json` under `naming.apex` (or
  `naming.lwc`); read it before naming a class (component). Never scan existing names for a prefix.
- `use: true`: `{PREFIX}` is the saved `prefix` and `{SUFFIX}` the saved `suffix` (either may be
  empty). A production name is `{PREFIX}<PascalCaseName>{SUFFIX}`; a test name is the production name
  plus `Test`, always last; every formula below that names `{PREFIX}` also ends the production name
  with `{SUFFIX}`; the Apex `{SUFFIX}` is exempt from "no underscores inside the name part".
- `use: false`, or no `naming` answer: the project uses no prefix or suffix; drop `{PREFIX}` from
  every formula and read the examples' `ABC_` / `abc` as absent.
- A name that does not match the saved answer is refused when the file is created (C).

The rest of each file is unchanged. Rule files are installed by `install-rules.mjs` exactly as today.

## C: the name check hook

New hook `hooks/naming-check.mjs`, registered as `PreToolUse` for `Write` and for `Bash`.

- Applies only in an SFDX project whose settings hold a `naming` answer with `use: true` for the type.
  Otherwise it allows silently.
- Creating a name, checked:
  - `Write` of a file that does not exist yet, at `<package folder>/**/classes/<Name>.cls` or
    `<Name>.cls-meta.xml` (Apex), or inside `<package folder>/**/lwc/<name>/` when that folder does
    not exist yet (LWC). Package folders come from `sfdx-project.json`.
  - `Bash` running `sf apex generate class --name <Name>` or `sf lightning generate component --name
    <name> --type lwc` (and their `sfdx force:…` aliases), parsed with the existing command parser.
- Not checked: edits to existing files, renames with `mv`/`git mv`, Apex triggers, Aura components.
  Existing names are never refused.
- Match: the name, after removing one trailing `Test`, starts with the saved prefix and ends with the
  saved suffix (exact case).
- Refusal: `permissionDecision: deny` naming the saved answer, the expected form and an example built
  from the attempted name, for example: "`AccountService_UK` does not start with this project's Apex
  prefix `ABC_`. Expected `{PREFIX}<Name>{SUFFIX}` = `ABC_AccountService_UK` (test: add `Test` at the
  end). Saved in `.claude/hean-harness.json` `naming.apex`; change it with `naming.mjs set`."
- Any error or unreadable input allows the call (fail open) and prints nothing.

Verified 2026-10-11 on Claude Code 2.1.296 with a headless probe: a `PreToolUse` hook on `Write` fires
when a subagent writes a file, and its input carries `agent_id` and `agent_type`. So the check covers
the `developer` subagent.

## Who asks

1. **Setup.** The setup preview prints `!! ASK — NAMING NOT CHOSEN` with the suggestion for each
   unanswered type. The setup skill asks one `AskUserQuestion` (per type: the suggestion as the first
   option, "No prefix or suffix", or a typed answer) and passes `--naming-apex use=yes,prefix=ABC_,suffix=_UK`
   / `--naming-lwc use=no`, which setup saves through `naming.mjs set`. A saved answer is reused without
   asking.
2. **`/hean-harness:start-implementation`.** After the dev-mode step, the skill runs
   `naming.mjs status`. Exit 2: run `naming.mjs suggest`, ask the same question, save each answer with
   `naming.mjs set`, and report it. Exit 0: say nothing. Not in an SFDX project: skip the step.
3. **Changing the answer later.** `naming.mjs set`, run by either skill on the user's request.

## Agents

- `agents/developer.md`:
  - Investigation_Protocol step 1 adds `lwc-naming-conventions.md` for LWC work; it is missing from the
    list today.
  - One line: the saved naming answer decides over a naming pattern found in the code; a name the
    check refuses is renamed to the expected form, never worked around.
- `agents/lwc-tester.md` already reads the LWC naming rule when it exists; no change.

## Doctor and uninstall

- `/hean-harness:doctor` prints the saved naming answer, or that none is saved.
- Uninstall leaves the saved answer with the rest of `.claude/hean-harness.json`'s handling; the hook
  is part of the plugin and goes with it.

## Out of scope

- Generating rule files.
- Renaming existing classes or components; checking renames.
- Apex triggers and Aura components.

## Tests

Existing conventions: plain `node` test files under `scripts/__tests__/` and `hooks/__tests__/`.

- Validation: each refused case in the table; the 20-character limit.
- `suggest`: a fixture repository with 9 of 10 classes `ABC_…`, a mixed one below 60% ("none"),
  suffix detection with `Test` names, nested package folders (the bash `**` case), LWC folders.
- `status` exit codes; `set` saves; `expect` for prefix only, suffix only, both, `Test` names, case.
- Hook: refuses a new `.cls` and a new LWC folder with a wrong name; allows a matching name, a `Test`
  name, an existing file, a file outside package folders, `use: false`, no answer, outside an SFDX
  project; refuses `sf apex generate class --name` and `sf lightning generate component --name` with a
  wrong name; fails open on bad input.
- Rules: both shipped files no longer contain the shell scan and point to `naming.apex` / `naming.lwc`.
- Setup: `!! ASK — NAMING NOT CHOSEN` when unanswered; the flags save; a rerun reuses the answer.
- Every test file passes and no test leaves a process running.
