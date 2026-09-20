---
name: sdd-brief-scope-vs-compile-safety
description: When an SDD task brief's file list would delete or change a method other
  code still depends on, trace every consumer first and surface the full picture to the
  controller — never pick an outcome (including a compatibility shim) on your own
metadata:
  type: feedback
---

When a Subagent-Driven-Development task brief instructs deleting or changing a method,
trace its full consumption chain before touching it — every already-deployed class that
calls or overrides it, and every non-Apex artifact that can reach it too: a Flow invocable
action, an LWC or Aura component calling it as `@AuraEnabled`, a scheduled or batch job
reference, or any other declarative automation. Salesforce recompiles all Apex on any
deploy, so a stale Apex caller alone — even in a file outside this task's stated scope —
turns "delete the method" into an org-wide compile failure that blocks the very test-run
step the brief's own verification step requires; a missed Flow or LWC reference fails
silently at runtime instead, which is worse because nothing stops the deploy to catch it.

**Why:** A brief scoped to one class said an old method was superseded by a new one, but a
separately-deployed controller class still called the old method, and a test double still
overrode it — neither was visible from the brief's own file list. In one such case, the
implementer resolved this on its own, kept a thin compatibility shim, and only reported the
deviation afterward, once the choice was already made. The controller later agreed the shim
was the right outcome — but only after independently re-deriving the same reasoning from
scratch. The deviation was never actually surfaced as an open decision; it was only reported
as a completed fact. A silent decision that happens to match what the controller would have
chosen is still a silent decision, not a deliberate one made with the controller's input.
Listing "keep a shim" as one plain bullet among several options carries the same risk one
step removed: it reads as a routine, equally-weighted fallback instead of the deliberately
flagged exception it has to be — see [[feedback_no_retrocompatibility_fully_adapt]].

**How to apply:**

1. Before touching a public or virtual method named in a brief, find every stakeholder:
   grep the whole codebase for callers and overrides of the exact method name, and check
   for non-Apex consumers — Flow actions, Aura/LWC callers of an `@AuraEnabled` method,
   scheduled/batch jobs, or other declarative automation that can reach it.
2. For each stakeholder found outside the brief's scope, look only as deep as needed to
   explain plainly why it depends on the method and what it would need if the method
   changed. Investigate the surrounding design enough to state the coupling clearly — going
   deeper than that serves curiosity, not the decision at hand.
3. Do not decide the outcome yourself. Stop, and report back to the controller with: the
   exact method name, every stakeholder found (file or artifact, and why it depends on the
   method), why the brief's instruction as written would break one or more of them, and the
   real options.
4. State each option's consequences loud and explicit, never as a flat list of equal
   choices. Adapting every stakeholder to the new shape is the default recommendation — see
   [[feedback_no_retrocompatibility_fully_adapt]]. A compatibility shim is a distinct
   option, not a lesser version of the default: name it separately, state plainly that it
   introduces a hidden artifact (working code with no real caller for its old shape,
   invisible to anyone who didn't read this exact report), and say what it costs later
   (future confusion about whether it's load-bearing, extra surface to maintain, a second
   code path that can silently drift from the new one).
5. Wait for the controller's explicit decision before proceeding. Never keep a shim, or any
   other outcome, on your own judgment and mention it only after the fact.
