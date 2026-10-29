---
name: eslint-unavailable-locally
description: npx eslint is never used, because the repository's own ESLint can fail on the project's config; sf code-analyzer run needs no Java for the eslint engine, and a project-accurate result needs the bundled rule layers off plus a positive control before any zero is believed
metadata:
  type: reference
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

**Do not use `npx eslint` at all.** It runs the repository's own ESLint, which can be version 8, and
ESLint 8 cannot load an ESLint 9 flat config that registers a plugin twice. `sf code-analyzer run`
bundles ESLint 9 and loads the same config. The rule at `.claude/rules/local-static-analysis.md` lists
`npx eslint` under "Commands not to use" and owns the command to run instead.

`sf code-analyzer run` still loads the project's `eslint.config.js`. When that config extends a
configuration published only to an internal registry and the module is absent, the run reports the
module it cannot find. Install it without touching the manifest:

```
npm install --no-save @store-sfdcbt-net/CICD_gulp-code-analyzer-v2@latest
```

`--no-save` leaves `package.json` and the lockfile untouched, and `node_modules` is ignored by git, so
this is safe to run and safe to leave in place. It may already be present, in which case this is not
your problem — check before installing.

**Do not use `npx gulp check` as the fallback.** Its prettier task runs with `--write` and reformats
every file matching its globs, not only the one under review. That is a destructive rewrite of
unrelated files, not a no-op.

**`sf code-analyzer run` does not need Java for the `eslint` engine.** `pmd`, `cpd` and `sfge` still
fail to instantiate against a `java` stub, but in version 5 of the plugin that failure is not fatal:
it records one violation per engine and carries on, so `eslint` results still arrive in the same run.
The abort that takes ESLint down with it belongs to the legacy `gulp codeAnalyzer` wrapper, which
shells out to the older `sf scanner:run`. Do not carry that behaviour over to `sf code-analyzer run`.

The static-analysis rule at `.claude/rules/local-static-analysis.md` owns the invocation, where a
relative configuration path actually resolves, which engines to disable, and how to tell an engine
failure from a code finding. Take all of that from there rather than from here, so the two cannot
drift apart.

**A large count of pure-style findings tells you which ruleset you measured, not that anything
regressed.** The analyzer ships its own `javascript` and `lwc` rule layers, and they enforce rules a
project typically does not — `no-magic-numbers`, `capitalized-comments`, `one-var`, `sort-keys`,
`func-style`, `id-length`. On a mature codebase those layers alone produce hundreds of findings, which
is why a file that already shipped green through the pipeline still lights up locally.

In the JavaScript run, switching all five bundled layers off (`javascript`, `lwc`, `slds`, `typescript`
and `react`) while naming the project's config is what reports the project's own rules and nothing
else. They do load and fire: a file tripping `no-var`, `eqeqeq` and `no-debugger` reports
exactly those rules when the config is named and nothing when it is not. So the tool is not discarding
the project's contribution — with the bundled layers on, that contribution is simply buried.

Two limits on that. It is only right where the project's config carries the project's standard on its
own; a thin config that leans on the analyzer's layers for the bulk of its rules is under-reported by
the same instruction, silently. And what it produces answers "what does our config say about this
code", never "will this pass the pipeline" — the pipeline builds its own analyzer configuration and may
select or weight rules differently. The rule at `.claude/rules/local-static-analysis.md` carries the
check for the first and the wording for the second.

**A zero only means clean after a positive control.** Switching the layers off and naming a config that
failed to load also produces zero, and the two are indistinguishable. Trip a rule you know the project
declares, confirm it is reported, then believe the zero. Identical results with and without the config
named prove nothing either way — the code may simply be clean against the project's rules while the
bundled layers do all the talking.

**Local violation totals will not match the pipeline.** The version of the internal package an install
fetches is whatever `latest` resolves to, and nothing narrows it. A finding is trustworthy when the
same rule at the same location is reproduced on the unfixed file and then confirmed absent after the
fix; compare the two lists by rule name and location. An unscoped total is not a proxy for what the
pipeline will report.

A run reports findings without writing anything back to disk. For an LWC-only change, expect the
`eslint`, `cpd`, `retire-js` and `regex` engines to run; `pmd` analyses Apex only and will report
nothing for an LWC-only workspace — do not imply PMD validated an LWC change when reporting results.
See the LWC conventions rule at `.claude/rules/lwc-conventions.md`, and
[[aria-boolean-binding-renders-string]].
