---
name: Dead branch patterns in LWC
description: Two recurring unreachable branch patterns in this codebase that Istanbul flags but cannot be covered
type: feedback
---

Branch shapes that are genuinely unreachable — do not attempt to cover them with fake assertions:

1. `if (!Array.isArray(parsed)) return []` after `if (!trimmed.startsWith('['))` guard — any JSON starting with `[` is always an array; the false arm is unreachable by JSON spec. Do not mock `JSON.parse` to produce a non-array for coverage.

2. Guard branches on `@track` internal state that is never populated by the component — e.g. `if (this.draftValues && this.draftValues.length > 0)` where the property defaults to `[]` and has no `@api` setter and no handler that would ever populate it. This is a component defect (defensive code for unreachable state), not a test gap.

**Why:** Istanbul counts both arms of every `if`. When the false arm is provably unreachable by the JSON grammar or by component architecture, the branch remains at <100% regardless of test effort.

**How to apply:** In the final report, classify these as "unreachable dead branches" and document the structural reason. Never add `/* istanbul ignore */` comments or meaningless mocked assertions to paper over them.