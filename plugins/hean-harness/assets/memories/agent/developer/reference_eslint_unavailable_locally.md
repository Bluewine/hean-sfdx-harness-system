---
name: eslint-unavailable-locally
description: npx eslint fails locally; use sf code-analyzer run scoped to a path, not npx gulp check, which reformats unrelated files
metadata:
  type: reference
---

> Applies to internal Salesforce projects, where this is the standard way of working.
> The names below are examples of that shape, not of one project.

`npx eslint <file>.js` fails in this environment with `Cannot find module
'@store-sfdcbt-net/CICD_gulp-code-analyzer-v2/config/sfdx/eslint.config.js'` --
the repo's `eslint.config.js` requires an internal package published only to
the org's private npm registry, which the raw `eslint` CLI cannot resolve in
this sandbox.

**Do not use `npx gulp check` as the fallback.** Its prettier task runs with
`--write` and reformats every file it touches, not just the one under review. That is a
real, destructive rewrite across every file matching its globs, not a harmless no-op.

**How to apply:** verify ESLint / the SLDS linter with `sf code-analyzer run`
scoped to the component's own directory, with a working JDK exported first
(Code Analyzer's `pmd`, `cpd` and `sfge` engines need Java on `PATH` or the
whole run, including `eslint`, aborts):

```
export JAVA_HOME=<path-to-a-jdk-21-install>
export PATH="$JAVA_HOME/bin:$PATH"
sf code-analyzer run --workspace <path/to/lwc/or/apex/dir> --view detail
```

This reports findings without writing anything back to disk. For an
LWC-only change, expect the `eslint`, `cpd`, `retire-js` and `regex` engines to
run; `pmd` only analyzes Apex and will report nothing for LWC-only workspaces
-- don't imply PMD validated an LWC change when reporting results. See the LWC
conventions rule at `.claude/rules/lwc-conventions.md`, and
[[aria-boolean-binding-renders-string]].
