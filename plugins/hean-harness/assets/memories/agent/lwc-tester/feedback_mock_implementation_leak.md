---
name: mock-implementation-leak-past-clearAllMocks
description: jest.clearAllMocks() in afterEach does not remove a custom .mockImplementation() — later tests inherit it unless they set their own
metadata:
  type: feedback
---

`jest.clearAllMocks()` resets `mock.calls`, `mock.instances` and `mock.results`, but does **not**
drop a function body set with `.mockImplementation()`. Only `mockReset()` or `resetAllMocks()`
does that.

So when a test sets an implementation to hold a promise open — the pattern for asserting on a
mid-flight state — that implementation survives into every later test in the file whose
`afterEach` calls only `clearAllMocks()`.

**Why it goes unnoticed:** later tests usually set their own resolution first, with
`mockResolvedValue` or `mockRejectedValue`, so the leaked implementation is overwritten before it
is ever called. The suite passes, and the risk stays latent until a test is added that does not.

**How to apply:**

- Treat it as order-dependence risk rather than a live defect. Do not rewrite test files over it
  unless the request is scoped to fixing wrong assertions and one is demonstrably wrong.
- When auditing a file that uses `mockImplementation` for a pending-promise pattern, check every
  later call site of the same mocked function. If any of them does not establish its own
  resolution before invoking, that one is a real latent bug worth flagging.
- Prefer `.mockImplementationOnce()` for a pending-then-resolve pattern whenever the file's
  `afterEach` uses `clearAllMocks()` rather than `resetAllMocks()`. It self-clears after one call
  and removes the whole class of risk.
