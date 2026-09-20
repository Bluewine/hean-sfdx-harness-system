---
name: aria-boolean-binding-renders-string
description: LWC template bindings on aria-* attributes stringify a bound boolean to the literal "true"/"false" rather than dropping the attribute on false
type: reference
---

Binding a plain JS boolean getter directly to an `aria-*` attribute in an LWC template
(e.g. `aria-disabled={isPoolExhausted}`, `aria-expanded={isOpen}`) renders as the literal
attribute value `"true"` or `"false"` on the DOM node — it does not follow the HTML
boolean-attribute convention (presence/absence) the way `disabled` or `hidden` do, and it
does not get dropped when the value is `false`.

The analyzer raises no finding against this binding form, so nothing flags it for you.

**Why:** ARIA states like `aria-disabled="false"` are themselves meaningful (explicitly
not-disabled), unlike an absent attribute, so the naive fix of writing a getter that manually
returns the string `'true'`/`'false'` looks safer but is an unnecessary abstraction — LWC
already does the correct stringification for you.

**How to apply:** When a control needs `aria-disabled`, `aria-expanded`, `aria-hidden`, etc.
driven by component state, bind the boolean getter directly (`aria-foo={someBooleanGetter}`).
Do not add a separate getter that converts the boolean to a string first, and do not assume
the attribute needs `disabled`-style removal semantics — verify with `sf code-analyzer run`
scoped to the component if in doubt, not with `gulp check` (its prettier task runs with
`--write` and can reformat unrelated files across the whole repo).
