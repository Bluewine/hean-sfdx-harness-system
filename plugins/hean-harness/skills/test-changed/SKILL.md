---
name: test-changed
description: Post-dev test orchestration — resolves Apex + LWC test scope transitively from working tree changes, then spawns apex-tester and/or lwc-tester in parallel with pre-computed scope
---

You are executing the `/test-changed` skill. Work through the seven phases below in order. Do not spawn any agent until Phase 7.

## Phase 1 — Collect modified files

Run all three commands and combine results:
- `git diff --name-only` (unstaged changes)
- `git diff --cached --name-only` (staged changes)
- `git ls-files --others --exclude-standard force-app/` (untracked files)

Deduplicate. Keep only paths under `force-app/`. If the combined set is empty, report "No changes detected in force-app/ — nothing to test." and stop.

## Phase 2 — Classify files

Assign each file to exactly one bucket:

| Bucket | Pattern |
|---|---|
| `apex_classes` | `*.cls` where the filename does NOT end in `Test.cls` |
| `apex_test_classes` | `*Test.cls` |
| `lwc_components` | `force-app/**/lwc/<name>/<name>.js` (non-test JS entry file) — record the component directory `force-app/**/lwc/<name>/` |
| `lwc_test_files` | `force-app/**/lwc/<name>/__tests__/*.test.js` — record the component directory |
| `flows` | `*.flow-meta.xml` |
| `ignored` | everything else — no action |

## Phase 3 — Build LWC scope (transitive)

Initialize `lwc_scope` with all component directories from `lwc_components` and `lwc_test_files`.
Initialize `flow_api_contracts` as an empty map.
Initialize `lwc_apex_map` as an empty map.

**Flow → LWC (unconditional — flow change is the trigger, not LWC change):**
For each file in `flows`:
- Read the flow XML file
- Extract every `<extensionName>c:<componentName></extensionName>` occurrence
- For each `componentName`:
  - Locate `force-app/**/lwc/<componentName>/` — add to `lwc_scope` regardless of whether it appears in the diff
  - In the same flow screen element: extract all `<inputParameters><name>` values and all `<outputParameters><name>` values — also note the flow variable type being passed (from `<value><elementReference>` or literal type) if visible in the XML
  - Record in `flow_api_contracts[componentName]` = list of `{paramName, direction: input|output, flowVariableRef}`

**LWC → Apex mapping:**
For each component directory in `lwc_scope`:
- Read the component's main `.js` file
- Extract every occurrence of `import \w+ from '@salesforce/apex/(\w+)\.(\w+)'` — capture `ClassName` and `methodName`
- Cross-reference `@wire(<importedName>` patterns to confirm wire vs. imperative usage
- Record in `lwc_apex_map[componentName]` = list of `{apexClass: ClassName, method: methodName, usage: wire|imperative}`

## Phase 4 — Build Apex scope (transitive call stack)

Initialize `apex_scope` with all filenames (without `.cls`) from `apex_classes`.

**Upward call stack resolution — up to 5 levels:**
For each class in `apex_classes`:
1. Read the class file. List every method name defined (including private helpers).
2. For each method name: grep `force-app/` for `ClassName\.methodName\s*(` and `\.methodName\s*(` (for same-class calls via `this` or direct invocation).
3. For each caller class found:
   - Read the caller class. Check whether it contains `@AuraEnabled` anywhere.
   - If yes: add the caller class and all intermediate classes in the chain to `apex_scope`. Then grep `force-app/**/lwc/` for `@salesforce/apex/CallerClassName\.` — add any matching LWC component directories to `lwc_scope`.
   - If no: treat the caller as a new candidate and repeat from step 2 (up to 5 total levels).
4. If no `@AuraEnabled` endpoint is found after 5 levels: the Apex change has no evident LWC surface — keep those classes in `apex_scope` but do not expand `lwc_scope` on their behalf.

**Apex → LWC via `lwc_apex_map`:**
For each `(componentName, [{apexClass}])` in `lwc_apex_map`:
- If `apexClass` is in `apex_scope`: ensure `componentName` directory is in `lwc_scope`.

## Phase 5 — Determine run strategy

```
runApex = apex_scope is non-empty  OR  apex_test_classes is non-empty
runLwc  = lwc_scope  is non-empty  OR  lwc_test_files    is non-empty
```

If both false: report "No testable changes detected — no Apex classes, LWC components, flows, or test files found in working tree." and stop.

## Phase 6 — Print scope summary and build agent prompts

Print before spawning:

```
## Test scope resolved

**Apex** (N classes): ClassName1, ClassName2, ...
**LWC** (N components): path/to/lwc/component1/, path/to/lwc/component2/, ...

**Why LWC scope includes non-diff components:**
- <ComponentName>: referenced by changed flow <FlowName.flow-meta.xml>
- <ComponentName>: imports Apex class <ClassName> which is in the call stack of changed method <MethodName>

**Flow @api contracts to validate:**
- <ComponentName>: <paramName> (input from flow variable <VarRef>), <paramName> (output to flow variable <VarRef>)

Spawning: [apex-tester] [lwc-tester in parallel]
```

Omit any section that has no entries.

**apex-tester prompt to use:**
Tell the agent the scope was pre-resolved. Pass the explicit list of Apex class names from `apex_scope` union `apex_test_classes`. Instruct it to test those classes directly without re-running its own working-tree scope detection.

**lwc-tester prompt to use:**
Tell the agent the scope was pre-resolved. Pass the explicit list of LWC component directory paths from `lwc_scope`. For each component present in `flow_api_contracts`, include the contract details — parameter names, directions, and flow variable references — and instruct the agent to validate that the component's `@api` properties match the expected names and that existing tests cover the protocol (single string, comma-separated list, semicolon-separated list, or other format inferred from the flow variable type or existing test patterns).

## Phase 7 — Spawn agents

Use a single message with multiple Agent tool calls so they run in parallel:

- `runApex AND runLwc` → spawn `apex-tester` AND `lwc-tester` in one message
- `runApex only` → spawn `apex-tester`
- `runLwc only` → spawn `lwc-tester`

Use `subagent_type: "hean-harness:apex-tester"` and `subagent_type: "hean-harness:lwc-tester"` respectively. Follow the agent briefing style rule: pass the goal and pre-resolved scope only — no shell commands, no CLI flags.
