---
name: communication-style-explicit-labels-no-pronouns
description: "Reuse established terms exactly, restate subjects instead of pronouns, and label every statement's type (question, finding, status, decision, advice, bug) so it parses in one pass"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6a1aba48-8c00-4ad9-9bf0-83425f5afcf9
  modified: 2026-09-05T02:16:15.185Z
---

Three rules for every message to this user, not just one session.

**Rule 0 — once a term or acronym is established anywhere in the conversation, keep using
that exact term.** Never rephrase it or substitute a synonym, even a more precise-sounding
one. This applies to whatever name was used first, or whatever name the user used — that
is the name to keep using for the rest of that conversation. Do not introduce a new phrase
for something already named and then explain it with a parenthetical translation back to
the agreed term — the parenthetical is evidence the rule was broken, not a fix for it.
Before sending a sentence, check whether it names the established thing by its established
name, not whether a reader could eventually decode a new name from context.

**Rule 1 — never use a pronoun or connector word to refer back to something said earlier.**
Restate the actual subject by name, every time.

Wrong: "So this fix is correctly targeted at a real but likely uncommon situation..."
Right: "The fix applies the safety rule to both categories of object, not just one. This
specific fix is correct and complete. Just letting you know."

Words like "this," "that," "it," "so," used to point at something mentioned several
sentences or paragraphs earlier, force the reader to scroll back and re-find what they
refer to. Restating the subject costs a few extra words and removes that burden entirely.
Apply this within a single message too — a callback three sentences later in the same reply
still needs the subject restated.

**Rule 2 — make the type of every statement unmistakable, ideally from an explicit label.**
The reader needs to instantly categorize each thing said as one of: a question needing
their decision, a finding (something discovered), a status report (neutral, no action
needed), a decision already made and finished (not open for debate, just informing them),
advice or a suggestion, or a bug alert (something urgent and broken). Use explicit opening
or closing phrases that name the category — "Just letting you know" (status, no action),
"This needs your decision:" (question), "I already fixed this, no action needed:"
(resolved). Do not make the reader infer the category from tone alone.

**Why these matter together:** the user is a multilingual reader and has said explicitly
that implicit, referential, or idiomatic English constructions that a native speaker parses
automatically do not land the same way for them. A message requiring the reader to infer
both "what does 'this' refer to" and "is this a warning or just information" at the same
time is costly to parse. The user wants a level of synchronization comparable to circus
performers who match small details to stay in sync during a show — every reply should be
understood correctly in one single pass, so the user can respond immediately with full
confidence they understood the same thing being described, without a clarifying
round-trip.

**Consequence of getting this wrong:** the user confirmed these three rules were the root
cause of every complaint raised in one entire session, not isolated slips. The recurring
pattern behind each complaint: a deliberate, correct decision got described in language
that sounded tentative, alarming, or unfinished — a completed move phrased as "deferred,"
a load-bearing design choice phrased as a lazy compatibility shortcut, a finished decision
introduced with a bare pronoun instead of its subject, or the same established concept
renamed mid-conversation and then re-explained with a parenthetical back to its real name.
See [[avoid-deferred-wording-for-completed-moves]] for the sequencing-language case
specifically. Separately, the user said this reads to them as "an alarm that things were
bad" even when the underlying content was neutral or good news — sounding alarm-shaped by
default is itself a problem, distinct from the pronoun and terminology issues. Reserve
urgent or warning framing only for things that actually need urgent attention.

**Confirmation the style works, once applied:** after switching to this style mid-session,
the user independently spotted a real design flaw in a proposed fix purely from reading one
clearly-written finding, before reading the section describing the actual fix. The user
called this out explicitly as evidence the clearer phrasing let them reach the right
conclusion faster, on their own. When a user gives this kind of confirmation, acknowledge
it explicitly and specifically — in this case the user had to point it out a second time,
because a first reply addressed only the technical question and missed the meta-point
about the style itself.

**How to apply, before sending any message with findings, decisions, or reports** (not
simple direct answers to a direct question): reread it and check (1) does every sentence
name its established terms exactly as already used in this conversation, with no synonym
and no parenthetical translation, (2) does every sentence stand on its own without
requiring the reader to hold something from an earlier sentence in memory, (3) is the
category of each statement (question/finding/status/decision/advice/bug) obvious without
inferring from tone.
