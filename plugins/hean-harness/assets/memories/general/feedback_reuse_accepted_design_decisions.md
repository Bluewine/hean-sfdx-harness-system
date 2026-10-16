---
name: reuse-accepted-design-decisions
description: When a design decision is already made and accepted and the new scenario is provably the same, reuse that decision instead of inventing a second approach
metadata:
  type: feedback
---

When a pattern has already been agreed and shipped, and a new piece of work is provably the same
scenario, reuse the existing pattern rather than designing a fresh one. Confirm the scenarios match,
then copy the shape.

**Why:** A second approach for the same problem has to be reviewed, debugged and maintained on its
own, and anything it adds beyond the accepted pattern is untested by definition. A new element
introduced "for safety" can be the thing that breaks the feature, while the accepted pattern was
already proven in use. The cost lands on the user, who has to rediscover a problem they had already
solved.

**How to apply:** Before building an interaction that resembles an existing one, open the accepted
implementation and mirror its structure — the same handler shape, the same staging behaviour, the
same response type. Add nothing that the accepted pattern does not have unless asked. If the new
scenario genuinely differs, say which difference forces the divergence before diverging.
