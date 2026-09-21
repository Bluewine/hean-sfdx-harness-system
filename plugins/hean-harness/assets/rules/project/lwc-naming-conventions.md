---
paths:
  - "force-app/**/lwc/**"
---

# LWC Component Naming Conventions

Apply every time a Lightning Web Component is created, renamed, extended or fixed.

**Lightning Web Components only.** Do not apply any of this to Apex classes, Aura components, Flows
or triggers.

## Find the project's prefix first

Most Salesforce projects prefix every component with a short lowercase token. Read it from the
components that already exist rather than assuming one:

```bash
ls -d force-app/**/lwc/*/ 2>/dev/null | xargs -n1 basename \
  | sed -E 's/^([a-z]+)[A-Z].*/\1/' | sort | uniq -c | sort -rn | head -5
```

The lowercase token nearly every component shares is the prefix. Call it `{prefix}` below.

When no common token appears, the project does not use one. Drop `{prefix}` from the formulas and
keep the rest.

## Length

A component name has no hard platform limit worth relying on, but a long one is unreadable in an
import, a template tag and a file path at once.

Aim for 20 to 24 characters. Treat 30 as the point where a name should be shortened, and 33 as the
point where it must be.

## Core rules

| # | Rule |
|---|------|
| 1 | The name starts with `{prefix}`, all lowercase |
| 2 | The descriptor follows immediately — no underscore, hyphen or space |
| 3 | The descriptor is PascalCase |
| 4 | The whole name is therefore camelCase: `{prefix}` then `PascalCaseDescriptor` |
| 5 | No underscores anywhere |
| 6 | The prefix is always lowercase — never capitalised, never shouted |
| 7 | 20 to 24 characters ideally, 30 preferred maximum, 33 hard maximum |

**Formula:** `{prefix}<PascalCaseDescriptor>` · test variant `{prefix}<PascalCaseDescriptor>Test`

```
✅  abcAccountPicker               (16 chars)
✅  abcServiceTerritoryCtrl        (23 chars)
✅  abcAccountPickerTest           (20 chars)

❌  ABCAccountPicker               the prefix is lowercase
❌  abc_AccountPicker              no underscores
❌  abcaccountPicker               the descriptor starts uppercase
❌  abcTestAccountPicker           Test is a suffix, never a prefix
```

## Abbreviations

Use these when the full name would exceed the ideal range. Shorten the last word first.

| Full word | Short |
|---|---|
| Controller | Ctrl |
| Manager | Mgr |
| Service | Svc |
| Utility | Util |
| Handler | Hndlr |
| Repository | Repo |
| Processor | Proc |
| Selector | Sel |
| Configuration | Config |
| Navigation | Nav |

Check what the project already uses before inventing a short form.

## Before saving a component name

```
□ 0. Is this a Lightning Web Component? If not, stop — none of this applies.
□ 1. Starts with the project's prefix, spelled exactly as existing components spell it?
□ 2. The character straight after the prefix is uppercase?
□ 3. No underscore, hyphen or space anywhere?
□ 4. The descriptor is PascalCase?
□ 5. Test components end with exactly "Test"?
□ 6. Test components: "Test" only at the end?
□ 7. Other components: no "Test" at the start or in the middle?
□ 8. 33 characters or fewer, preferably 30, ideally 24?
□ 9. If over 24, have the common words been abbreviated?
```

Every applicable line must pass. If one fails, rename and check again.
