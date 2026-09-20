---
name: feedback_tests_adapt_to_code_never_reverse
description: "When a verified implementation and a test disagree, change the test — never bend working code to satisfy a stale assertion"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 95008e38-e35b-4d72-b871-451fad49e4a7
  modified: 2026-09-18T05:05:17.635Z
---

When a test fails against an implementation that has been verified correct, rewrite the test.
Never adjust the implementation to make an existing assertion pass.

**Why:** A spec encodes what the code did when the spec was written, not what it should do. After
a deliberate change the old assertion is evidence of the previous behaviour, nothing more.
Treating it as the requirement quietly reverts the work — and it is persuasive, because a
failing test reads like a defect report. The danger is sharpest where the old value looks
plausible: a spec asserting a 310px offset will happily pull a corrected 293px back to the
wrong number, and the suite then goes green on the bug.

**How to apply:**
- Establish correctness live first — measured behaviour, not a passing suite.
- Then read each failure and ask which side is stale. If the implementation was verified,
  the test is the thing that is wrong.
- Update assertions to the new measured values, and say in the test why the value is what it
  is so the next reader does not "restore" it.
- Never touch a verified value, token or offset because a spec disagrees with it.
- Sequence matters: land and commit the verified implementation, then refactor the specs
  against it. Doing both at once invites splitting the difference.

Related: [[feedback_no_retrocompatibility_fully_adapt]], [[feedback_agent_routing_test_fixes]].
