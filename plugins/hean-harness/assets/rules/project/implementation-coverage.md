# Implementation Coverage

Apply when an implementation creates or changes an Apex class or a Lightning web component under
`force-app/`: while briefing subagents for it, and before running
`/hean-harness:finish-implementation`.

## Target

- **Source of the target:** 100% is this project's threshold, set in `apex-test-conventions.md`
  and enforced in CI. The platform requires only 75% to deploy Apex to production (Salesforce Help
  article 000386327).
- **Apex:** 100% line coverage for every class the work creates or changes.
- **LWC:** 100% statements, branches, functions and lines for every component the work creates or
  changes.
- **Whole file:** The target covers every line of each touched file, including lines that existed
  before the work. Salesforce computes a class's coverage as its covered lines divided by all its
  covered and uncovered lines (Apex Developer Guide, "Testing and Code Coverage"), so a gap left in
  an untouched part of a touched class still keeps that class below 100%.

## Briefs

- State the target in every implementer and tester brief as "100% of every whole file in scope";
  never "changed lines", "new code" or "the diff". A subagent takes the brief's narrower scope over
  its own default and leaves the older gaps.
- Never forbid a behaviour-preserving production change made for testability in an implementer or
  tester brief. The pre-approval under "Testability refactors" applies to every brief.

## Testability refactors

- **Pre-approved:** A refactor of a class, component or method the work touches that keeps
  behaviour, output, the signatures callers depend on and performance characteristics the same,
  made to make the code testable or more loosely coupled. Examples: `protected virtual` seams a
  test subclass overrides, extracted methods, `@TestVisible`, dependency injection through the
  project's factory or a constructor overload, an LWC helper moved to its own module. An LWC's
  `@api` properties and methods are signatures callers depend on.
- **Never asked:** The agent makes the change and reports it. The agent does not ask the user or
  the caller first.
- **Scope:** Only classes and components the work already touches. Every other file stays under
  the `developer` agent's "No adjacent refactoring" constraint.
- **Ask only when:** A change would alter behaviour, output, the signatures callers depend on or
  performance characteristics.
- **Report every refactor:** The agent lists every such refactor under its own label,
  "Testability refactors", in its result, with the file, the change and why behaviour is
  unchanged. The final report to the user lists them under the same label.

## Coverage check before finishing

1. **Run the check.** After the last task and any final whole-branch review, run
   `/hean-harness:test-changed` before `/hean-harness:finish-implementation`. The check runs while
   the implementation run is still open, because it reads the run's commits to find every touched
   file. The check deploys to the saved deploy target before it measures Apex coverage, so the org
   write check in `org-roles.md` still applies.
   Steps 2 to 5 cover only the files the run touched, which test-changed lists in its coverage
   result. Every other file in that result is information only: never fix it and never ask the user
   to accept it.
2. **Close the gaps.** For each touched file below 100%, work out why each uncovered line is not
   reached. Where the cause is code no test can reach as written, make the testability refactor
   first. Then add the tests that reach it: Apex test classes go to the `developer` agent, LWC
   Jest tests go to the `lwc-tester` agent. Keep going while each attempt raises coverage.
3. **Recognise a limit.** A line is untestable when no test can run it even after a
   behaviour-preserving testability refactor. Decide this for each line from what the code does and
   the context it runs in; the cases are not limited to a list. Two examples: the single line
   inside a seam that calls an API which does not run in a test context, and a
   `Test.isRunningTest()` check that no injected flag or overridable method can replace without
   changing behaviour. Stop on such a line, and stop on any line where an attempt did not raise
   coverage. Never repeat an attempt that already failed.
4. **Report every remaining gap.** For each touched file still below 100%, list the uncovered lines,
   why each cannot be covered, and why no behaviour-preserving refactor reaches it. A line a
   behaviour-preserving refactor can reach is not a gap: close it in step 2. A
   touched file whose coverage was not measured is an open gap with its reason. Link documentation
   when the reason is a platform limit and a page states it.
5. **Ask the user.** When any gap remains, ask the user in one question whether to accept each
   gap or keep working. List the testability refactors made in step 2 beside the question, under
   their own label.
   - **All gaps accepted:** run `/hean-harness:finish-implementation`.
   - **Any gap kept open:** keep working on it, then return to step 1. Never run
     `/hean-harness:finish-implementation` while a gap the user did not accept remains.

## Prohibitions

- Never lower the target, below 100% or to changed lines, without the user's answer.
- Never add `/* istanbul ignore */` or any other coverage suppression.
- Never report the work done while a file is below 100% and the user has not answered.
- Never ask the user whether to make a behaviour-preserving testability refactor.
