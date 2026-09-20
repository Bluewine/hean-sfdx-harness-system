---
name: feedback_keep_ootb_when_unconfigurable
description: "When a standard platform component offers no documented attribute or styling hook for a requested change, keep the out-of-the-box behaviour and report it instead of working around it"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4597dbbe-9e02-4af1-9e23-ab2ffc5fe932
  modified: 2026-09-15T12:57:47.338Z
---

When a design asks for a change to a standard Salesforce component's behaviour or layout, and that component exposes no documented attribute, variant, or styling hook for it, keep the out-of-the-box behaviour and report the finding. Do not reach into the component's shadow DOM, and do not invent a workaround before reporting.

**Why:** overriding a base component's internals binds the code to markup Salesforce can change in any release, and the breakage surfaces as a silent visual regression nobody traces back. The user would rather accept the platform default than carry that risk, and wants the decision surfaced rather than made silently.

**How to apply:** verify against the official component documentation *and* the live rendered markup before reporting — name which documented settings exist, which parts the component exposes for external styling, and what measurement shows. Then state that the out-of-the-box behaviour is being kept. Naming a supported alternative in one sentence is welcome; implementing it without a green light is not.

Related: [[feedback_confirm_precise_cause_before_fix]], [[reference_lds2_icon_button_zero_width]].
