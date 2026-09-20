---
name: feedback_verify_fix_in_playwright_before_spec
description: "For browser/CSS bugs, prove the candidate fix live in Playwright before writing any spec or plan — not just the repro"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5a1d7fe4-0038-4238-acfd-3f76191879ad
---

For visual/CSS/layout bugs, reproduce AND empirically prove the candidate fix in the live browser (Playwright) before writing a spec, plan, or implementing. Inject the real fix (actual class name + styling) into the live DOM and re-measure/screenshot both the failing case and the no-regression case.

**Why:** The user explicitly asked for this ("before implementing or writing any spec/plan, try in the playwright the approach and see if it really fixes it"). Reasoning about CSS from source is unreliable — the ABC-77 footer fix depended on a live-only fact (header is 70px desktop / 60px mobile) that killed the magic-number option and validated `100vh`.

**How to apply:** After root-causing, DOM-inject the exact proposed change (via [[feedback_playwright_for_browser_testing]] tools) at multiple viewports, confirm the fix and no regression, THEN write the spec citing that evidence. The injection faithfully mirrors what the deployed `:host`/wrapper CSS will do.
