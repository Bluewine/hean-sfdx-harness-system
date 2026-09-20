---
paths:
  - "**/*.cls"
---

# Apex Cognitive Complexity

Apply while writing or editing any method body in a `.cls` file — no exceptions.

## Threshold

Keep every method's Cognitive Complexity below **15**. This repo's CI Quality Check gate blocks at 15.

## What counts toward Cognitive Complexity

Each of these adds at least one point; nesting one inside another adds an extra point per level of nesting:

- `if` / `else if` / `else`, ternary (`?:`)
- `for` / `while` / `do-while`
- `catch`
- each `when` branch in a `switch`
- each `&&` / `||` in a boolean sequence
- recursion

## How to stay under the threshold while writing new code

- **One private helper method per logical step.** A method that gathers data, then processes it, then builds a result should be three named methods calling each other in sequence, not one method with three sections. A caller method that only calls other methods stays low-complexity regardless of how much work happens underneath it.
- **Guard clauses over nested branches.** Return early for the exceptional/simple case instead of wrapping the main logic in `if`. Each avoided nesting level removes both the branch's own point and the extra per-nesting-level point every structure inside it would have paid.
- **One level of abstraction per method.** A method either orchestrates (calls other methods, no business logic of its own) or implements one specific piece of logic — never both. If a method mixes "what steps happen" with "how each step works," extract the "how" into its own method.
- **Extract the inner block of a nested loop-inside-a-conditional-inside-a-loop.** That shape is the single most expensive pattern for this metric; pulling the innermost block into its own named method (passed the loop variable and whatever context it needs) collapses multiple nesting levels into one.

Document every extracted helper per `apex-docstring-comments.md` — a private method that exists only to keep a caller under this threshold still needs a docstring stating what it does and why it's separate.

## Checklist

- [ ] Does any method in this diff reach 15 Cognitive Complexity? If unsure, count `if`/`for`/`while`/`catch`/`when`/`&&`/`||`/ternary occurrences plus one extra per nesting level.
- [ ] Is there a method mixing orchestration with implementation? Split it.
- [ ] Is there a nested loop-inside-conditional-inside-loop? Extract the innermost block.
- [ ] Does every newly extracted helper have a docstring per `apex-docstring-comments.md`?
