---
name: Always use npx jest for all LWC test commands in CLAUDE.md files
description: All test commands in root and module CLAUDE.md files must use npx jest, never npm run test:unit
type: feedback
originSessionId: 444a6990-cfc3-48a7-990d-8521cac41a81
---
Always use `npx jest` for all LWC test commands — run all, watch, coverage, and path-scoped. Never use `npm run test:unit`, `npm run test:unit:watch`, or `npm run test:unit:coverage` in CLAUDE.md files.

- All tests: `npx jest`
- Watch mode: `npx jest --watch`
- Coverage: `npx jest --coverage` (or `npx jest "<path>" --coverage` for scoped)
- Scoped: `npx jest "<feature-path>"`

**Why:** CLAUDE.md files should always document npx jest commands uniformly, not npm scripts.

**How to apply:** When writing or editing CLAUDE.md test command sections (root or any module), use npx jest in all cases.