---
paths:
  - "force-app/**/lwc/**"
---

# LWC Component Naming Conventions

Apply every time a Lightning Web Component is created, renamed, extended or fixed.

**Lightning Web Components only.** Do not apply any of this to Apex classes, Aura components, Flows
or triggers.

## The project's prefix and suffix

The project saves its LWC naming answer in `.claude/hean-harness.json` under `naming.lwc`, in the
repository's main checkout. Read it before naming a component. Never scan existing component names
for a prefix.

- `use: true`: `{prefix}` is the saved `prefix` (lowercase) and `{Suffix}` the saved `suffix`; either
  may be empty. A component is `{prefix}<PascalCaseDescriptor>{Suffix}`, for example
  `abcAccountPickerUk` for prefix `abc` and suffix `Uk`. A test component is the component name plus
  `Test`, always last: `abcAccountPickerUkTest`.
- Every formula and rule below that names `{prefix}` also ends the component name with `{Suffix}`.
- With no prefix, the name is camelCase and starts lowercase, because an LWC folder name must begin
  with a lowercase letter: `accountPickerUk` for suffix `Uk`. This overrides checklist items 2 and 4
  and the capital first letter of `<PascalCaseDescriptor>` in the formula above.
- `use: false`, or no `naming.lwc` saved: the project uses no prefix or suffix. Drop `{prefix}` from
  every formula below and read the examples' `abc` as absent.
- A new component whose name does not match the saved answer is refused when its folder is created.
  Rename it to the expected form the refusal gives.

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
□ 1. Starts with the saved prefix and ends with the saved suffix (Test after it), per naming.lwc in .claude/hean-harness.json?
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
