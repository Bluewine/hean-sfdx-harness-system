---
name: lwc-foreach-key-convention
description: Put for:each and for:item on the template tag and bind key on the rendered element inside it; decorate a primitive array into keyed objects rather than binding a raw index
type: reference
---

LWC accepts two keying forms. Pick one and use it throughout a codebase rather than mixing them.

The form to prefer: put `for:each` and `for:item` on the `<template>` tag, and bind
`key={item.field}` on the element rendered inside it. Do not use `for:key="..."` on the
`<template>` tag itself, even though LWC supports it.

When the data is a plain array of primitives — a list of file names, say — with no natural
identifier, decorate it in a getter into an array of `{ key, name }` objects rather than
iterating the primitives directly with an inline index. Use `${prefix}-${index}` for the key only
when the source array is append-only. An array that is spliced or reordered needs a key derived
from the item itself, or rows lose their identity between renders.

**Why:** one keying idiom per codebase. A second one introduced alongside the first makes every
later reader check which applies here.

**How to apply:** before adding a `for:each` to a component, look at the existing `for:each`
blocks in that component and its parent, and copy their key-binding style. When the array holds
primitives, add the getter rather than iterating them directly.
