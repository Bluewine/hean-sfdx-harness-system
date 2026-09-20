---
name: confirm-precise-cause-before-fix
description: "When diagnosing an org/schema-drift-shaped test failure, run the specific comparison check before proposing any fix, not after the user asks a targeted follow-up"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 30b632c1-34ab-4e91-98ab-f20c7770a662
  modified: 2026-09-04T02:06:23.977Z
---

Before proposing a code or test fix for a failure that looks like it could be org/schema/config drift (e.g. a describe-based Apex method behaving differently across sandboxes), run the precise, targeted comparison first — don't propose a fix from a general hypothesis about the failure mechanism.

**Why:** In one investigation, the general mechanism (Schema.describe-based, not data-based) and the execution location (a specific CI stage deploying to a specific sandbox) were both confirmed, but a production-code fix was then proposed from a hypothesis about *why* it might fail, without first running the cheap, available read-only check (comparing `sf sobject describe` output for the relevant object between the two orgs). The proposed fix was wrong — it didn't touch the actual defect. Only the user's own targeted follow-up ("does object X exist in org Y?") prompted the comparison that revealed the real cause (one specific child relationship absent in one org) and the correct, narrow fix (guard the test's assertion on that object's presence, not add defensive error handling to the production method, which was already behaving correctly).

**Root cause of the delay, found on review:** the failing line number and the test file's actual content were both already in hand from the very first turn — the model had read the exact file and could see line 20 was the `ServiceTerritoryWorkType` assertion, but miscounted and misattributed the failure to a different line (`WorkOrder`, two lines off) in its own summary passed to a subagent. Every subsequent step reasoned forward from that wrong premise instead of re-verifying the line-to-code mapping against the source. This was not a missing-information problem — it was an unverified transcription of data already on screen. Always re-derive "which exact line/statement failed" by directly indexing into the already-read file content, never by counting/recalling it, especially before handing that fact to a subagent as ground truth.

**Mechanical cause, traced further:** the file lookup used a Bash `sed -n '1,30p' <file>` command instead of the `Read` tool. `sed` prints raw lines with no line-number prefix; `Read` always numbers every line (`cat -n` format) specifically so a "line N" reference from an error/log can be matched directly. Stripping the line numbers forced eyeball-counting through a block with several blank lines — exactly the setup that produces an off-by-two miscount. When a task is "find what's at line N" (from a stack trace, lint output, CI log, etc.), always use `Read` (or `sed -n 'Np'` / `awk 'NR==N'` for that exact single line) — never a numberless dump that has to be recounted by eye.

**How to apply:** When a failure is diagnosed as environment/config-shaped rather than a pure logic bug, and a specific, cheap comparison (describe diff, config diff, permission diff) can confirm or refute the exact cause, run that comparison before proposing any change — even a "safe" defensive one. Don't let the user have to name the specific object/field/setting before doing the check that was already available.
