---
paths:
  - "force-app/**"
---

# Local Static Analysis

Apply when verifying a change to anything under `force-app/`, after the test suite passes.

## Ordering

Run the tests first, then the analyzer. Jest completes in seconds and catches logic errors; the analyzer takes a minute or more and catches style and rule violations. A failing suite makes the analyzer run worthless, so there is nothing to gain by running it first.

## Command

Write a configuration file of your own, then run the analyzer scoped to the paths the change touched.

```yaml
# code-analyzer.local.yml
engines:
  eslint:
    eslint_config_file: /absolute/path/to/eslint.config.js
    disable_javascript_base_config: true    # see "Which ruleset you are measuring"
    disable_lwc_base_config: true           # same
```

```bash
sf code-analyzer run -w . -t '<the paths you changed>' -r eslint \
    -s 3 -v detail -c code-analyzer.local.yml
```

**Two different things get switched off in this tool, for two unrelated reasons. Do not conflate
them.** The `eslint` engine runs on Node and never touches a JDK; `pmd`, `cpd` and `sfge` do.

| Setting | Applies to | Condition | Reason |
|---|---|---|---|
| `disable_javascript_base_config`, `disable_lwc_base_config` | the `eslint` engine | the project's config carries its own standard | choosing which ruleset you measure against |
| `disable_engine` | `pmd`, `cpd`, `sfge` | no working JDK on this machine | those engines cannot start without one |

Java has no bearing on the first pair. The same file, same configuration, gives an identical result
with a real JDK and with a `java` stub. If you are here because a run failed for want of Java, the
setting you want is `disable_engine`, in "Engines that cannot start" below — leave the base configs
alone.

### Which ruleset you are measuring

The two `disable_*_base_config` flags remove the analyzer's own bundled `javascript` and `lwc` rule
layers. Those layers enforce rules a project typically does not — `no-magic-numbers`,
`capitalized-comments`, `one-var`, `sort-keys`, `func-style`, `id-length` and more — and on a mature
codebase they produce hundreds of findings that bury the handful that matter. With them off and the
project's config named, what remains is the project's own ruleset.

This is a choice about scope, not a fix for a broken environment, and it is right only where the
project's config stands on its own. Check that first — it is check 1 below.

## Before you trust a number

Two checks, in this order. Neither is optional, and the second cannot substitute for the first.

**1. Does the project's config stand on its own?** Count what it declares:

```bash
node --input-type=module -e "
const m = await import('/absolute/path/to/eslint.config.js');
const flat = Array.isArray(m.default) ? m.default : [m.default];
const rules = new Set();
for (const e of flat) for (const k of Object.keys(e?.rules ?? {})) rules.add(k);
console.log(flat.length + ' entries, ' + rules.size + ' distinct rules');
"
```

A config declaring a few hundred rules across several plugins carries the project's standard, and the
bundled layers only add noise on top of it — switch them off. A config declaring almost none is
leaning on those layers deliberately, and switching them off under-reports silently: the code then
looks cleaner than it is. Decide this before you disable anything.

**2. Do the project's rules actually reach the output?** Take a file that trips a rule the config
declares — `no-var`, `eqeqeq`, `no-debugger` are usually safe bets — run the command, and confirm that
rule is reported by name. Delete the file as soon as it has served.

Until you have watched one of the project's own rules fire, no number from this tool says anything
about the project's standards, and a zero says least of all: switching the base layers off while
naming a config that failed to load produces the same zero, and the two are indistinguishable.

**Identical results with and without the config named prove nothing either way.** They can be
identical because the code is clean against the project's rules while the bundled layers produce the
whole count. What they do tell you is that you have not yet seen the project's rules reach the output,
so run check 2 rather than drawing a conclusion.

**What a clean result answers, and what it does not.** It answers "what does our own ESLint config say
about this code". It does not answer "will this pass the pipeline". The pipeline generates its own
analyzer configuration at build time, which nobody can reproduce locally, and it may select different
rules or weight them differently. Report the first and never imply the second — an agent handed a
clean local result will assume it has a prediction of the gate, and it does not have one.

## When a number looks wrong

**`across 0 file(s)` is the phrase that matters.** A summary reading
`Found 3 violation(s) across 0 file(s): 3 Critical severity violation(s) found.` is not three defects
in the code. A real finding always has a file attached; a violation attached to no file is the tool
reporting its own failure — an engine that could not start, or a configuration file it could not
load. Read that phrase before reporting any Critical result.

**A sudden collapse in the count is a load failure, not clean code.** A broken configuration file, one
that throws, and a path that does not exist each drop the violation count to a single across-0-files
entry rather than raising an obvious error.

**A config that contributes nothing is not being skipped.** The file is read and executed — a `throw`
placed inside one reaches the command's output — so when naming it changes nothing, investigate its
content rather than its path.

**Check where a relative path resolved.** Every relative path in the configuration file resolves
against `config_root`, which the tool documents as "the parent folder of your Code Analyzer
configuration file if it exists, or the current working directory otherwise" — so `-w` has no bearing
on it. Give an absolute path, or set `config_root` explicitly. To confirm:

```bash
sf code-analyzer config -w . -c code-analyzer.local.yml
```

Read `config_root` and `eslint_config_file` together. The command sometimes prints the value already
resolved and sometimes exactly as you wrote it, so a relative value on screen is not itself a fault —
resolve it against the `config_root` above it and check the result is the file you meant.

## Engines that cannot start

`pmd`, `cpd` and `sfge` need Java 11 or later. Against a `java` stub each fails to instantiate, and
the tool records every failure as a violation at Critical severity. Selecting only the `eslint` rules
does not avoid it: rule selection filters rules, not engine construction, so the other engines are
still created and still fail.

Those Critical entries move the exit code, which is why this is not cosmetic. The same file at the
same threshold exits 1 with the engines enabled against a stub, and 2 with them disabled — and 2 is
also what a real JDK gives. Leaving them enabled without a JDK turns every run into an apparent
Critical failure.

So add `disable_engine: true` for the three of them when there is no working JDK, and leave them
enabled when there is: with a real JDK they are the Apex analysis.

```yaml
# add to code-analyzer.local.yml, only when there is no working JDK
engines:
  pmd:  { disable_engine: true }
  cpd:  { disable_engine: true }
  sfge: { disable_engine: true }
```

This has nothing to do with the two `disable_*_base_config` flags in `## Command`. Those choose which
ESLint ruleset you measure against and behave identically whether or not a JDK is present.

## Its silence is not agreement

This tool does not warn you when a configuration file fails to apply, when an engine dies before it
runs, or when a rule layer has been switched off. In all three cases you still get a count, formatted
exactly like a real result. Treat every number it prints as unattributed until you have established
what produced it.

## Change one thing per run

Every way this tool can mislead you presents as a number of violations. A configuration path that
resolved somewhere unintended, a rule layer switched off, an engine that never started, and genuinely
clean code all produce a count, and three of those four produce a count that looks plausible. The
output cannot tell you which one you are looking at.

So change exactly one variable between runs, and keep the previous run's output to compare against.
Two changes in one run and the result belongs to neither — that is how a false all-clear gets
reported, by crediting the fix rather than the setting that silenced the ruleset.

## Commands not to use

**`npx gulp codeAnalyzer`**, even where a project's gulpfile offers the task. The centrally-maintained
build library requires the first-generation analyzer wrapper, which installs version 3 of the scanner.
That version reads only the legacy `.eslintrc` JSON format, so a flat JavaScript `eslint.config.js`
reaches a JSON parser and the parse fails. The error text and the character position it names depend
on how the config file happens to open, so do not match on either — the mechanism is the
JavaScript-to-JSON mismatch. ESLint runs first and nothing runs after it fails, so the output looks
like a whole-toolchain collapse rather than one engine's problem.

Two repairs look obvious and neither works. Removing the old scanner does not help, because the
wrapper reinstalls it on every invocation. Routing the task at the current wrapper is not a project
setting: the requirement is hardcoded in the shared library. Confirm that by reading the entry file of
the installed library and seeing which wrapper it requires, rather than taking it on faith — the
library is pinned to `latest` with nothing narrowing it, so which version you have, and what it
requires, can both change under you.

**`gulp check`**, because its prettier task is invoked with `--write` rather than `--check` and
rewrites every file matching its globs across the whole repository, not only the ones the change
touched.

Do not hand-edit the analyzer configuration the pipeline uses. It is generated at build time by the
CI/CD analyzer package, so edits do not survive. The file in `## Command` is your own, separate from it.

## Prerequisite check

Run `/hean-harness:doctor` before trusting an analyzer result, and read its Java and code analyzer lines. It owns detection: it tells a real JDK from a `java` stub that prints an installation message and exits 0, compares the analyzer plugin against the version the pipeline pins, and prints the fix beside each `MISSING` line. Read those lines rather than the command's exit status.

The project's `eslint.config.js` may extend a configuration published only to an internal registry. When ESLint cannot resolve that module, install it without touching the manifest — `npm install --no-save <package>@latest` — because `node_modules` is ignored by git and the analyzer cannot load the real ruleset until the module is present.

## Formatting

Check before writing:

```bash
npx prettier --check <the paths you modified>
```

**If a file already conforms, keep it conforming** — run `--write` on it after editing.

**If a file does not conform, leave it alone.** Much of this tree predates the current prettier config, and `--write` reformats the *entire* file rather than the lines you changed: a ten-line fix arrives as a few thousand lines of indentation churn, and the actual change becomes unreviewable. Bringing a file into conformance is its own change, made deliberately and on its own, never a side effect of an unrelated edit.

Never format the repository wholesale.

## Reporting

- **Read the exit code as a severity, not as a verdict.** `-s <n>` sets the threshold, and exit 0 means nothing at or above it. A non-zero exit is the number of the worst severity found at or above the threshold — 1 for Critical, 2 for High, 3 for Moderate — so a run exiting 2 is reporting that its worst finding is High, not that two things went wrong.
- **Report only findings in files the change modified.** The repository carries thousands of pre-existing findings; listing them buries the ones that belong to the change.
- **Name the engines that did not run**, and say whether each was disabled deliberately or failed to start. Never describe the analyzer as clean when an engine never ran — a clean claim covering engines that never started is worse than no analysis at all.
- **Name a version mismatch.** When the environment report marks the code analyzer plugin `MISSING` because its version differs from the pin, state that local findings can differ from the pipeline's.
- **PMD analyses Apex only.** It has nothing to say about an LWC change. Say so rather than implying it validated HTML, JavaScript or CSS.
- **Do not quote a total as a verdict.** The pipeline generates its own configuration and remaps severities, so a local count is not what it will report. Compare one rule and one location before and after a fix instead.
