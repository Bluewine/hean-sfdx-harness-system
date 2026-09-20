---
paths:
  - "force-app/**/*.cls"
---

# Apex Docstring Comments

Apply whenever writing or editing a comment in a `.cls` file that documents a class, method, or field's purpose, rationale, or behavior — not a comment marking a TODO or disabling a line.

## Rule

Use a Javadoc-style block comment, never a run of single-line `//` comments.

```apex
// ✅ Correct
/**
 * REPOINT chunk size. One update-only DML row per input row, so it can safely
 * reach the 10,000-row governor limit.
 */
@TestVisible private static final Integer UNIFY_CHUNK_REPOINT = 10000;

// ❌ Wrong — stacked single-line comments
// REPOINT issues 1 DML row per input row (update only), so its chunk can safely reach the
// 10,000-row governor limit.
@TestVisible private static final Integer UNIFY_CHUNK_REPOINT = 10000;
```

## Why

ApexDoc-style tooling parses `/** ... */` blocks into generated reference documentation. A stack of `//` lines is invisible to that tooling, so the rationale it carries never reaches auto-generated docs and has to be rediscovered by reading source.

## Scope

- Applies only to a comment immediately preceding a class, method, constant, or field declaration — the position ApexDoc tooling parses.
- A single-line aside in that position (one line, no continuation) may stay a `//` comment.
- A comment spanning two or more lines in that position must use `/** ... */`.
- A comment inside a method body (explaining a local step, a test's setup rationale, a mock's behavior) stays `//` regardless of length — ApexDoc never parses those, so converting them serves no documentation purpose.

## Format — short description first, then tags

```apex
/**
 * One to three sentences: what this member does and why it exists.
 *
 * @param recordId The WorkType Id to resolve; must already exist.
 * @return The elected survivor's Id, or null when no duplicate group contains recordId.
 */
```

- Open with the description as plain text — no `@description` tag. Leave one blank comment line (a bare ` *`) between the description and the first `@param`/`@return` tag. Never restate the same fact in prose outside a tag.
- Omit `@param`/`@return` when the parameter or return value's meaning is already obvious from its name and type; a tag that repeats the signature adds nothing.

## Length — cap and edit protocol

- The description is at most 6 lines. If the rationale needs more, it belongs in a project rule (`.claude/rules/`) or design doc, not the docstring — link to that file instead of restating its content.
- Before adding a sentence to an existing docstring, read the whole existing block together with the new fact. Rewrite the whole block as one coherent, still-short version — never append a new sentence or paragraph onto the end.
- Delete any sentence the rewrite makes redundant or supersedes as part of the same edit. A docstring is not a change log.
