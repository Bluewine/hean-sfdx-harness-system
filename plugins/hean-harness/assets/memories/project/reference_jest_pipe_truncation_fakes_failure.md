---
name: reference_jest_pipe_truncation_fakes_failure
description: "Piping a Jest run into head or tail can close stdout early and kill a worker, reporting a suite-level failure that does not exist"
metadata:
  type: reference
---

Never judge pass or fail from a Jest run whose stdout is piped into `head`, or into a
pipeline that ends in one. Those close the pipe as soon as they have enough lines; Jest's
reporter then takes an EPIPE, a worker dies, and the summary reports a suite-level failure
with that suite's tests silently missing from the total.

Redirect to a file and read the file, or pass `--silent` to cut the console volume that
provokes it:
`npx jest <abs path> > run.log 2>&1` then grep the log.

**How it presents, and why it is convincing:** the count drops by exactly one suite's worth
of tests — 580 became 575 — which reads like a genuine crash in a specific suite rather
than an artifact. It is also intermittent, because it depends on how quickly the downstream
command exits, so re-running "fixes" it and invites the conclusion that the suite is flaky.

**Before concluding a suite is flaky, remove the pipe and re-run.** A failure that survives
that is real; one that vanishes was the measurement.

Related: [[reference_jest_scans_nested_worktrees]] for scoping a run to the current branch.
