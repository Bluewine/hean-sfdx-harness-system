---
paths:
  - "force-app/**/*.cls"
---

# Apex Class Naming Conventions

Apply every time an Apex class or Apex test class is created, edited, extended, fixed or renamed.

## The project's prefix and suffix

The project saves its Apex naming answer in `.claude/hean-harness.json` under `naming.apex`, in the
repository's main checkout. Read it before naming a class. Never scan existing class names for a
prefix.

- `use: true`: `{PREFIX}` is the saved `prefix` and `{SUFFIX}` the saved `suffix`; either may be
  empty. A production class is `{PREFIX}<PascalCaseName>{SUFFIX}`, for example `ABC_AccountService_UK`
  for prefix `ABC_` and suffix `_UK`. A test class is the production class name plus `Test`, always
  last: `ABC_AccountService_UKTest`.
- Every formula and rule below that names `{PREFIX}` also ends the production name with `{SUFFIX}`.
  `{SUFFIX}` is exempt from "no underscores inside the name part".
- `use: false`, or no `naming.apex` saved: the project uses no prefix or suffix. Drop `{PREFIX}` from
  every formula below and read the examples' `ABC_` as absent.
- A new class whose name does not match the saved answer is refused when the file is created. Rename
  it to the expected form the refusal gives.

## Character limit

Salesforce rejects an Apex class name longer than **40 characters**. That is the platform's limit,
not a preference.

Work well inside it: aim for 30 characters, and treat 33 as the point where a name has to be
shortened rather than accepted.

## Standard classes

| # | Rule |
|---|------|
| 1 | The name starts with `{PREFIX}` |
| 2 | `{PREFIX}` already ends with its separator — never add another |
| 3 | The descriptive part follows immediately, in PascalCase |
| 4 | `Test` appears nowhere in the name |
| 5 | Total length 33 or fewer, preferably 30 |

**Formula:** `{PREFIX}<PascalCaseName>`

```
✅  ABC_WorkOrderCtrl              (17 chars)
✅  ABC_ServiceTerritoryCtrl       (24 chars)

❌  ABC_accountPicker              the name part must be PascalCase
❌  ABC_Account_Picker             no underscores inside the name part
❌  ABC_TestAccountPicker          Test is a suffix, never a prefix
```

## Test classes

**A test class is the production class name plus `Test`.** Nothing else changes — no prefix
manipulation, no abbreviation introduced, no word dropped.

| Production class | Test class |
|---|---|
| `ABC_VendorPortalCtrl` | `ABC_VendorPortalCtrlTest` |
| `ABC_UserService` | `ABC_UserServiceTest` |
| `ABC_ServiceAppointmentSvc` | `ABC_ServiceAppointmentSvcTest` |

| # | Rule |
|---|------|
| 1 | The name equals the production class name plus exactly `Test` |
| 2 | `Test`, never `Tests`, never `_Test` |
| 3 | `Test` only at the end |
| 4 | No other change to the production name |
| 5 | Total length 33 or fewer, preferably 30 |

```
❌  UserServiceTest                missing the project prefix
❌  ServiceAppointmentServiceTest  the production class abbreviated Service to Svc; match it
❌  ABC_UserServiceTests           the suffix is exactly Test
```

## Abbreviations

Use these when the full name would exceed 30 characters. Shorten the last word first.

| Full word | Short |
|---|---|
| Controller | Ctrl |
| Manager | Mgr |
| Service | Svc |
| Selector | Sel |
| Utility | Util |
| Handler | Hndlr |
| Repository | Repo |
| Processor | Proc |
| Scheduler | Sched |
| Dispatcher | Disp |

Check what the project already uses before inventing a short form. A codebase that writes `Svc`
everywhere should not gain a single `Service`.

## Before saving a class name

```
□ 1. Starts with the saved prefix and ends with the saved suffix (Test after it), per naming.apex in .claude/hean-harness.json?
□ 2. The part after the prefix starts with an uppercase letter?
□ 3. No underscores inside that part?
□ 4. Test classes: the production name plus exactly "Test"?
□ 5. Test classes: "Test" only at the end?
□ 6. Other classes: no "Test" anywhere?
□ 7. 33 characters or fewer, preferably 30?
□ 8. If over 30, have the common words been abbreviated?
```

Every applicable line must pass. If one fails, rename and check again.
