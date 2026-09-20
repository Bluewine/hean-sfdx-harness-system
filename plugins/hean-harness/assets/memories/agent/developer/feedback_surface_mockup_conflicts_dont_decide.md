---
name: surface-mockup-conflicts-dont-decide
description: When a binding instruction conflicts with the approved mockup's source, implement the instruction and flag the conflict in the report — do not silently pick either side
metadata:
  type: feedback
---

When an instruction stated as binding conflicts with what the approved design mockup actually
specifies, implement the instruction as given, then flag the conflict prominently in the report with
both concrete values and the exact one-line change that would switch to the other option. Do not
silently decide it in either direction.

**Why:** The instruction said
to colour the icon with the card's heading colour; the mockup source coloured it a different blue
(`text-brand` `#0176D3` vs the heading's `text-navy` `#032D60`). I built the instructed colour and
reported the discrepancy with the one-token alternative. The coordinator replied "You were right to
flag the discrepancy and right not to decide it alone," then ruled for the mockup and superseded the
original instruction — they had written it before seeing the mockup's source. Either silent choice
would have been wrong: implementing the mockup would have ignored a binding instruction, and staying
quiet would have shipped a colour nobody had actually chosen.

**How to apply:** read the mockup's source when one exists in the repo rather than trusting a prose
description of it — prose descriptions of visual details are frequently mis-remembered, and small
icons in particular get their colour mis-read. Put the conflict under an explicit "what the
requirements did not settle" heading with the measured values, not buried in prose. Give the
switch-cost in one line so the decision is cheap. This pairs with the standing preference for
reaching alignment before committing to an interpretation.
