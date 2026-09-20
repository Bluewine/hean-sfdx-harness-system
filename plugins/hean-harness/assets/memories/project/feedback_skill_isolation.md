---
name: Skills must be atomic and isolated unless used in tandem
description: Never cross-reference another skill from within a SKILL.md unless the two skills are explicitly designed to be invoked together
type: feedback
originSessionId: 562f26e6-cc87-4112-a49b-08b0959a4916
---
Skills must be self-contained. Never reference another skill inside a SKILL.md unless the two are explicitly designed to work in tandem (e.g., superpowers skills that call each other by design).

**Why:** If a skill references another skill's phase numbers, variable names, or logic, deprecating or modifying the referenced skill silently breaks the dependent one. The new skill then has no standalone value.

**How to apply:** When building a new skill that recycles logic from an existing skill, copy and own that logic fully inside the new skill. Cross-references to the source skill are acceptable in design docs (specs) and plans as provenance, but must never appear inside the SKILL.md itself. If the two skills are designed to be invoked together (one calls the other), cross-references are appropriate.