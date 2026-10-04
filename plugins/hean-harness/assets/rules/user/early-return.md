---
paths:
  - "**/*.{cls,trigger,apex,js,mjs,cjs,ts,tsx,jsx,py,java,kt,go,rb,cs,php,swift,rs,c,cpp,h,sh}"
---

# Early Return

Apply while writing or editing code in any of the languages the `paths` list covers.

## Rule

- When a guard condition decides whether the main work runs, handle the guard case first and leave
  the function: `return` (`exit` at the top level of a shell script), or return the guard case's
  value when the function returns one. The main path stays at the outer indentation level.
- Never put more than 3 statements inside an `else`. Handle the guard case first and return instead.
- A single-statement `if` with no `else` stays as it is.

## Example

Before:

```apex
if (template == null || String.isBlank(template.id)) {
    System.debug(LoggingLevel.WARN, 'Template not found. No Work Orders were changed.');
} else {
    // ~50 lines of query, update loop and logging
}
```

After:

```apex
if (template == null || String.isBlank(template.id)) {
    System.debug(LoggingLevel.WARN, 'Template not found. No Work Orders were changed.');
    return;
}
// the same ~50 lines, one indentation level less
```

## Checklist

- [ ] No `else` holds more than 3 statements.
- [ ] Every guard that decides whether the main work runs leaves the function before the main path.
