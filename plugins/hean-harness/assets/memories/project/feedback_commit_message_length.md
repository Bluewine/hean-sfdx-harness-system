---
name: Commit message style
description: Subject lines ≤10 words and ≤77 characters total, first word after work ID capitalized
type: feedback
originSessionId: f339aaa0-370a-4921-9eb7-6d76449cd17f
---
Keep commit message subject lines ≤10 words and ≤77 characters total. Capitalize the first word after the work ID tag.

**Why:** User preference — excessively long messages are useless noise; a 10-word / 77-char joint ceiling keeps subjects descriptive without becoming verbose.

**How to apply:** Format is `@W-XXXXXXX: Capitalized noun phrase`. Count words after the colon — cap at 10. Verify the full subject (prefix + body) is ≤77 characters. Both limits apply. Applies to all direct commits.