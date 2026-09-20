---
paths:
  - "force-app/**"
---

# Local Static Analysis

Apply when verifying a change to anything under `force-app/`, after the test suite passes.

## Ordering

Run the tests first, then the analyzer. Jest completes in seconds and catches logic errors; the analyzer takes a minute or more and catches style and rule violations. A failing suite makes the analyzer run worthless, so there is nothing to gain by running it first.

## Command

Run `npx gulp codeAnalyzer`.

**Never run `gulp check` for this.** Its prettier task is invoked with `--write`, not `--check`, so it rewrites every file matching its globs across the whole repository, not only the ones the change touched. `codeAnalyzer` runs the same engines and rewrites nothing.

Do not hand-edit `code-analyzer.yml`. It is generated at build time by the CI/CD analyzer package and regenerated on every gulp run, so edits do not survive.

## Prerequisite check

Run `/hean-harness:doctor` before trusting an analyzer result, and read its Java and code analyzer lines. It owns detection: it tells a real JDK from a `java` stub that prints an installation message and exits 0, compares the analyzer plugin against the version the pipeline pins, and prints the fix beside each `MISSING` line. Read those lines rather than the command's exit status.

The `pmd`, `cpd` and `sfge` engines require Java 11 or later. Without it each fails to instantiate with `UninstantiableEngineError`, and that failure aborts the entire run — ESLint included — so the command reports nothing useful about the code.

## Formatting

Check before writing:

```bash
npx prettier --check <the paths you modified>
```

**If a file already conforms, keep it conforming** — run `--write` on it after editing.

**If a file does not conform, leave it alone.** Much of this tree predates the current prettier config, and `--write` reformats the *entire* file rather than the lines you changed: a ten-line fix arrives as a few thousand lines of indentation churn, and the actual change becomes unreviewable. Bringing a file into conformance is its own change, made deliberately and on its own, never a side effect of an unrelated edit.

Never format the repository wholesale.

## Reporting

- **Exit code is the gate.** The pipeline gates at severity 3, so Low findings do not block. A zero exit means nothing at or above the gate.
- **Report only findings in files the change modified.** The repository carries thousands of pre-existing findings; listing them buries the ones that belong to the change.
- **Name the engines that did not run.** When Java was unavailable, state that PMD and SFGE did not run. Never describe the analyzer as clean when engines failed to instantiate — a clean claim covering engines that never started is worse than no analysis at all.
- **Name a version mismatch.** When the environment report marks the code analyzer plugin `MISSING` because its version differs from the pin, state that local findings can differ from the pipeline's.
- **PMD analyses Apex only.** It has nothing to say about an LWC change. Say so rather than implying it validated HTML, JavaScript or CSS.
