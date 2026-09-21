---
name: code-analyzer-working-recipe
description: gulp codeAnalyzer fails for a reason that is not Java — it supplies its own JDK — so do not spend time on the JDK when that task aborts
metadata:
  type: reference
---

> Applies to internal Salesforce projects that build through the shared CI/CD gulp library.

**When `npx gulp codeAnalyzer` aborts, Java is not the reason.** That run supplies its own JDK out of
`node_modules` and says so in its output. Reaching for `JAVA_HOME`, installing a JDK, or blaming a
`java` stub will not move it, and each attempt costs a full run to find out.

The cause is a version conflict inside the build library. It requires the first-generation analyzer
wrapper, which installs version 3 of the scanner. That version reads only the legacy `.eslintrc` JSON
format, so a flat JavaScript `eslint.config.js` reaches a JSON parser and the parse fails. **Do not
match on the error text or the character position it names** — both depend on how the config file
happens to open, and a repository whose config opens differently produces a different message for the
same cause. ESLint runs first and nothing runs after it fails, which is why the output reads as a
whole-toolchain collapse rather than one engine's problem.

Two repairs look obvious and neither works:

- Removing the old scanner does not help. The wrapper reinstalls it at the start of every run — this
  is visible in the run log, not inferred.
- Routing the task at the current wrapper is not a project setting. The requirement is hardcoded in
  the shared library. Confirm it by reading that library's entry file and seeing which wrapper it
  requires, rather than taking it on faith: the library is pinned to `latest` with nothing narrowing
  it, so the version you have and what it requires can both change under you.

Run the analyzer through the `sf` plugin instead. The static-analysis rule at
`.claude/rules/local-static-analysis.md` owns the invocation, its flags, the settings that can turn a
run into a false pass, and the discipline of changing one variable per run — read it rather than
assembling a command. For the ESLint side, including why running eslint directly fails for more than
one reason, see [[eslint-unavailable-locally]].

Related: [[feedback_confirm_precise_cause_before_fix]].
