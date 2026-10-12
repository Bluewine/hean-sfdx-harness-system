# Open Items and Story Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eleven open items the user chose to implement on 2026-09-25, and make create-pr and update-pr remind the user what a story asked for and what its branch changed before asking for manual deployment steps.

**Architecture:** Every change is inside `plugins/hean-harness/`. Tasks 1–2 change the flow order reader (`scripts/lib/flow-trigger-order.mjs`, its CLI and its test). Tasks 3–4 change setup and doctor. Tasks 5–6 make the deployer agent and the two PR skills rebuild the per-story manifest with the branch-manifest script. Task 7 changes the Story reminder. Task 8 releases 0.1.26.

**Tech Stack:** Node.js ES modules with no dependencies, plain `check()` test scripts run with `node`, Markdown skill, agent and rule files.

**Spec:** The eleven decisions and the story reminder request recorded in this session; each task quotes the part it implements.

## Global Constraints

- Paths below are relative to `plugins/hean-harness/` unless they start with `docs/`.
- Commit subjects read `@HEAN-1: Capitalised imperative summary`, 10 words and 77 characters or fewer. No `Co-Authored-By` or other trailer.
- Commit each task by explicit path. Run `git status --short` first; never commit `assets/rules/user/zz-test-dropped-rule.md`.
- Never run `git checkout`, `git restore`, `git stash` or `git reset` on the working tree.
- Before committing any task, run every test file: `for t in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do node "$t" || echo "FAILED: $t"; done` from the repository root. Run one loop at a time; check `pgrep -fl test.mjs` first.
- Skill and agent text follows `~/.claude/rules/agent-writing-style.md` and `~/.claude/rules/skill-frontmatter-description-style.md`. Descriptions stay one sentence and 50 words or fewer.
- Do not push. The release task pushes.

## Review Focus

- A flow file that reads a lookup through the polymorphic form `$Record.Owner:User.Email` must count as a read of `OwnerId`, not `Owner` — Task 2 tests it.
- A before-save flow whose `$Record.X` assignments already count as writes must not count them twice when it also updates the whole `$Record` — Task 2 tests it.
- `--flow` followed by another option (`--flow --x`) must be treated as a missing name, not as a flow called `--x` — Task 1 tests it.
- Doctor must not hang or fail when `ego-browser` is on PATH but its `nodejs` command errors or times out — Task 4 treats any answer other than `undefined` as "not outdated".
- The PR skills must not commit a manifest when branch-manifest reports `unchanged` or `not written` — Task 6 states both cases.

---

### Task 1: Flow order report text and `--flow` argument

Implements items 1, 2, 3, 6 and 7.

**Files:**
- Modify: `scripts/lib/flow-trigger-order.mjs` (comment above `relatedFlows`, `finalWriterAt`, the end of `formatFlowPlacement`)
- Modify: `scripts/flow-trigger-order.mjs:20-25`
- Test: `scripts/__tests__/flow-trigger-order.test.mjs`

**Interfaces:**
- Produces: `finalWriterAt(groupFlowsList, target, order, field, positionLabel)` — `positionLabel` is the text inside the round brackets.

**Before and after, item 1.** Real field-service output today:

```
Allowed range: ..._COI_Check and ..._Before_Save depend on each other — ... triggerOrder cannot resolve this: ...
Suggested triggerOrder: ..._COI_Check and ..._Before_Save depend on each other — ... (current: 1501)   ← same text again
```

After:

```
Allowed range: ..._COI_Check and ..._Before_Save depend on each other — ... triggerOrder cannot resolve this: ...
Suggested triggerOrder: none — see Allowed range above (current: 1501)
```

**Before and after, item 2.** Two flows in a loop that both write `F1`:

```
  F1 is also written by Ex_B — Ex_C (at the suggested position) would set the final value     ← before
  F1 is also written by Ex_B — Ex_C (at its current triggerOrder 1600) would set the final value   ← after
```

**Before and after, item 6.**

```
$ node flow-trigger-order.mjs WorkOrder --flow
WorkOrder · RecordBeforeSave — 4 flows, in platform run order:     ← before: the group listing
--flow needs a flow API name. Usage: flow-trigger-order.mjs [ObjectApiName] [--flow FlowApiName]   ← after
```

- [ ] **Step 1: Write the failing tests**

In `scripts/__tests__/flow-trigger-order.test.mjs`, replace the case 3 check (the one labelled `'case 3: predecessor A, successor B, range 1501–1599, suggestion 1550'`) with:

```js
  const case3Pred = case3Out.split('Predecessors:')[1].split('Successors:')[0];
  const case3Succ = case3Out.split('Successors:')[1].split('Related flows:')[0];
  check('case 3: predecessor A, successor B, range 1501–1599, suggestion 1550',
        case3Pred.includes('DepCase3_A') && !case3Pred.includes('DepCase3_B') &&
        case3Succ.includes('DepCase3_B') && !case3Succ.includes('DepCase3_A') &&
        case3Out.includes('Allowed range: 1501–1599') && case3Out.includes('Suggested triggerOrder: 1550'),
        case3Out);
```

Directly after the case 4 check, add:

```js
  const occurrences = (text, phrase) => text.split(phrase).length - 1;
  check('case 4: the loop explanation is printed once, and the suggestion line points to it',
        occurrences(case4Out, 'depend on each other') === 1 &&
        case4Out.includes('Suggested triggerOrder: none — see Allowed range above (current: none)'),
        case4Out);
```

Directly after the case 5 check, add:

```js
  check('case 5: the renumbering explanation is printed once',
        occurrences(case5Out, 'existing flows need renumbering') === 1 &&
        case5Out.includes('Suggested triggerOrder: none — see Allowed range above'),
        case5Out);
```

After the two case 12 checks, add a case 13 and one more case 12 check:

```js
  check('with a suggested number, the final-value line says "at the suggested position"',
        case12Out.includes('DepCase12_A (at the suggested position) would set the final value'),
        case12Out);

  // Case 13: B and C depend on each other and both write F1 -> no number is
  // suggested, so the final-value line must name C's current triggerOrder,
  // never "the suggested position".
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_B',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F1'], formulaReadFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_C',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: 1600, updateRecordFields: ['F2', 'F1'], formulaReadFields: ['F1'] }));
  const case13Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase13_C'], { cwd: root, encoding: 'utf8' });
  check('case 13: with no suggested number, the final-value line names the current triggerOrder',
        case13Out.includes('F1 is also written by DepCase13_B — DepCase13_C (at its current triggerOrder 1600) would set the final value') &&
        !case13Out.includes('at the suggested position'),
        case13Out);
```

In the `--flow error cases` block, after the two existing checks, add:

```js
  const usage = '--flow needs a flow API name. Usage: flow-trigger-order.mjs [ObjectApiName] [--flow FlowApiName]';
  const noNameOut = execFileSync('node', [SCRIPT, '--flow'], { cwd: root, encoding: 'utf8' }).trim();
  check('--flow with no name after it reports the usage instead of the group listing', noNameOut === usage, noNameOut);
  const objectNoNameOut = execFileSync('node', [SCRIPT, 'Case', '--flow'], { cwd: root, encoding: 'utf8' }).trim();
  check('an object followed by --flow with no name reports the usage', objectNoNameOut === usage, objectNoNameOut);
  const optionAsNameOut = execFileSync('node', [SCRIPT, '--flow', '--x'], { cwd: root, encoding: 'utf8' }).trim();
  check('--flow followed by another option is treated as a missing name', optionAsNameOut === usage, optionAsNameOut);
```

- [ ] **Step 2: Run the test and confirm the new checks fail**

Run: `node plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs`
Expected: FAIL on the case 4 loop, case 5, case 12 position, case 13 and the three `--flow` checks. Case 3 passes (the names are already right; the check was missing).

- [ ] **Step 3: Implement item 1**

In `formatFlowPlacement`, replace:

```js
  lines.push(`Allowed range: ${rangeText}`);
  lines.push(`Suggested triggerOrder: ${suggestionText} (current: ${target.order ?? 'none'})`);
```

with:

```js
  lines.push(`Allowed range: ${rangeText}`);
  // A loop, an empty range and a neighbour with no triggerOrder come back as
  // one explanation for both lines; print it once.
  const suggestionShown = suggestionText === rangeText ? 'none — see Allowed range above' : suggestionText;
  lines.push(`Suggested triggerOrder: ${suggestionShown} (current: ${target.order ?? 'none'})`);
```

- [ ] **Step 4: Implement item 2**

Replace `finalWriterAt`:

```js
/** Which flow's write of `field` would win if `target` ran at `order`; `positionLabel` says which order that is. */
function finalWriterAt(groupFlowsList, target, order, field, positionLabel) {
  const contenders = [...writersOf(groupFlowsList, field, target), { ...target, order }];
  const last = runOrder(contenders)[contenders.length - 1];
  return last.path === target.path ? `${target.name} (${positionLabel})` : last.name;
}
```

In the double-write block of `formatFlowPlacement`, replace:

```js
    const orderForCheck = suggestionValue !== null && suggestionValue !== undefined ? suggestionValue : target.order;
```

with:

```js
    const suggested = suggestionValue !== null && suggestionValue !== undefined;
    const orderForCheck = suggested ? suggestionValue : target.order;
    const positionLabel = suggested ? 'at the suggested position'
      : target.order === null ? 'with no triggerOrder' : `at its current triggerOrder ${target.order}`;
```

and pass `positionLabel` as the fifth argument of the `finalWriterAt(...)` call in the same block.

- [ ] **Step 5: Implement item 3**

Replace the comment above `function relatedFlows` with:

```js
/**
 * Every other flow in `groupFlowsList` reachable from `target` through a
 * field link — one flow writes a field another reads, or both write the same
 * field (see `linkedFlows`) — directly or through other flows in the group:
 * a connected component over those links. `target` itself is not included
 * in the result.
 */
```

- [ ] **Step 6: Implement item 6**

In `scripts/flow-trigger-order.mjs`, replace the argument loop:

```js
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--flow') flowOption = args[++i] ?? null;
  else if (objectFilter === null) objectFilter = args[i];
}
```

with:

```js
const USAGE = 'Usage: flow-trigger-order.mjs [ObjectApiName] [--flow FlowApiName]';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--flow') {
    flowOption = args[++i] ?? null;
    // Without a name, falling back to the group listing answers a question
    // nobody asked; say what is missing instead.
    if (!flowOption || flowOption.startsWith('--')) {
      console.log(`--flow needs a flow API name. ${USAGE}`);
      process.exit(0);
    }
  }
  else if (objectFilter === null) objectFilter = args[i];
}
```

Exit code 0 matches the script's other one-line answers (`No flow named …`, `… is not a record-triggered flow.`).

- [ ] **Step 7: Run the test and confirm it passes**

Run: `node plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs`
Expected: `all checks passed`.

- [ ] **Step 8: Run every test file, then commit**

```bash
git add plugins/hean-harness/scripts/lib/flow-trigger-order.mjs plugins/hean-harness/scripts/flow-trigger-order.mjs plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs
git commit -m "@HEAN-1: Fix flow order report repeats and missing --flow name"
```

### Task 2: Flow order reader — lookup reads and whole-record updates

Implements items 4 and 5.

**Files:**
- Modify: `scripts/lib/flow-trigger-order.mjs` (`parseFlowDependencies` and its comment)
- Test: `scripts/__tests__/flow-trigger-order.test.mjs` (fixture helper and new checks)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `recordTriggeredFlow({ ..., updateWholeRecord = false })` in the test file.

**Salesforce facts this relies on** (checked by web search on 2026-09-25):
- A lookup's relationship name is the field name without `Id` for standard fields (`AccountId` → `Account`) and with `__r` in place of `__c` for custom fields ([SOQL relationship names](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_relationships_and_custom_objects.htm)).
- In an after-save flow an Assignment to `$Record` does not save; an Update Records element must save it. "Use the IDs and all field values from a record or record collection" saves the variable's field values ([Update Records element](https://help.salesforce.com/s/articleView?language=en_US&id=platform.flow_ref_elements_data_update.htm&type=5)). In metadata that is a `<recordUpdates>` with `<inputReference>$Record</inputReference>` and no `<inputAssignments>`.

**Before and after, item 4.** Real field-service output for `Field_Service_Work_Order_Before_Save`:

```
    reads: ..., OwnerId, WorkType, WorkTypeId, LocationforWorkOrders__r, ...     ← before
    reads: ..., OwnerId, WorkTypeId, LocationforWorkOrders__c, ...               ← after (deduplicated)
```

**Before and after, item 5.** An after-save `Case` flow that sets `$Record.Priority` and then saves the whole `$Record`:

```
Case · RecordAfterSave: Ex_After — order 1500  (...)                    ← before: no writes
Case · RecordAfterSave: Ex_After — order 1500  (...)
    writes: Priority                                                      ← after
```

- [ ] **Step 1: Extend the fixture helper**

In `recordTriggeredFlow`, add `updateWholeRecord = false` to the parameter list, document it in the comment above the function as `updateWholeRecord: a <recordUpdates> with inputReference $Record and no field assignments — saves the whole record.`, and add:

```js
  const updateWhole = updateWholeRecord ? `
    <recordUpdates>
        <name>Save_Whole_Record</name>
        <label>Save Whole Record</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <inputReference>$Record</inputReference>
    </recordUpdates>` : '';
```

Insert `${updateWhole}` after `${updateById}` in the returned XML.

- [ ] **Step 2: Write the failing tests**

Add a new block before the `--flow error cases` block:

```js
  // ---- lookup reads and whole-record saves ---------------------------------
  writeFlow(root, 'force-app/main/default/flows', 'Lookup_Reader',
    recordTriggeredFlow({ object: 'Lookup__c', triggerType: 'RecordAfterSave', order: 1600,
      formulaReadFields: ['WorkType.Name', 'Location__r.Name', 'Owner:User.Email', 'Status'] }));
  writeFlow(root, 'force-app/main/default/flows', 'Lookup_Writer',
    recordTriggeredFlow({ object: 'Lookup__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['WorkTypeId'] }));
  const lookupReport = formatReport(loadFlows(root), 'Lookup__c');
  const lookupReads = lookupReport.split('\n').find(l => l.startsWith('    reads:') && l.includes('Status')) ?? '';
  check('a read through a lookup counts as a read of the lookup field',
        lookupReads.includes('WorkTypeId') && lookupReads.includes('Location__c') && lookupReads.includes('OwnerId') &&
        !/\bWorkType\b(?!Id)/.test(lookupReads) && !lookupReads.includes('Location__r') && !/\bOwner\b(?!Id)/.test(lookupReads),
        lookupReads);
  const lookupOut = execFileSync('node', [SCRIPT, '--flow', 'Lookup_Reader'], { cwd: root, encoding: 'utf8' });
  check('a writer of WorkTypeId is a predecessor of a reader of $Record.WorkType.Name',
        lookupOut.split('Predecessors:')[1].split('Successors:')[0].includes('Lookup_Writer (order 1500, WorkTypeId)'),
        lookupOut);

  writeFlow(root, 'force-app/main/default/flows', 'Whole_Saver',
    recordTriggeredFlow({ object: 'Whole__c', triggerType: 'RecordAfterSave', order: 1500,
      assignToRecordFields: ['Priority'], updateWholeRecord: true }));
  writeFlow(root, 'force-app/main/default/flows', 'Assign_Only',
    recordTriggeredFlow({ object: 'Whole__c', triggerType: 'RecordAfterSave', order: 1600, assignToRecordFields: ['Tier'] }));
  writeFlow(root, 'force-app/main/default/flows', 'Before_Whole',
    recordTriggeredFlow({ object: 'Whole__c', triggerType: 'RecordBeforeSave', order: 1500,
      assignToRecordFields: ['Level'], updateWholeRecord: true }));
  const wholeLines = formatReport(loadFlows(root), 'Whole__c').split('\n');
  const writesAfter = name => {
    const i = wholeLines.findIndex(l => l.includes(`  ${name}  (`) || l.includes(`: ${name} —`));
    return wholeLines.slice(i + 1, i + 4).find(l => l.trim().startsWith('writes:')) ?? '';
  };
  check('an after-save $Record assignment saved by a whole-record update is a write',
        writesAfter('Whole_Saver').includes('Priority'), writesAfter('Whole_Saver'));
  check('an after-save $Record assignment with no update is still not a write',
        !writesAfter('Assign_Only').includes('Tier'), writesAfter('Assign_Only'));
  check('a before-save assignment is listed once even when the flow also saves the whole record',
        writesAfter('Before_Whole').trim() === 'writes: Level', writesAfter('Before_Whole'));
```

- [ ] **Step 3: Run the test and confirm the new checks fail**

Run: `node plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs`
Expected: FAIL on the lookup checks and the whole-record check; the two "still not" and "listed once" checks already pass.

- [ ] **Step 4: Implement item 4**

Above `parseFlowDependencies`, add:

```js
/**
 * The field that holds a lookup's value, from the relationship name a flow
 * uses to reach the related record: `WorkType` -> `WorkTypeId`,
 * `Location__r` -> `Location__c`. A write changes the lookup field, so a read
 * through the relationship has to be recorded under that field to match it.
 */
const lookupField = relationship =>
  relationship.endsWith('__r') ? `${relationship.slice(0, -3)}__c` : `${relationship}Id`;
```

In `parseFlowDependencies`, replace:

```js
  for (const m of withoutWriteAssigns.matchAll(/\$Record(?:__Prior)?\.([A-Za-z0-9_]+)/g)) {
    reads.push(m[1]);
  }
```

with:

```js
  // `$Record.WorkType.Name` and the polymorphic `$Record.Owner:User.Email`
  // reach a related record; record the lookup field they go through.
  for (const m of withoutWriteAssigns.matchAll(/\$Record(?:__Prior)?\.([A-Za-z0-9_]+)([.:][A-Za-z])?/g)) {
    reads.push(m[2] ? lookupField(m[1]) : m[1]);
  }
```

- [ ] **Step 5: Implement item 5**

In `parseFlowDependencies`, replace:

```js
  const writes = [];
  if (triggerType === 'RecordBeforeSave') {
    for (const m of xmlText.matchAll(/<assignToReference>\$Record\.([A-Za-z0-9_]+)/g)) writes.push(m[1]);
  }
```

with:

```js
  const writes = [];
  // An after-save flow's $Record assignments are saved only by an Update
  // Records element that saves the whole record: inputReference $Record
  // with no field assignments of its own.
  const savesWholeRecord = [...xmlText.matchAll(/<recordUpdates>([\s\S]*?)<\/recordUpdates>/g)]
    .some(m => /<inputReference>\$Record<\/inputReference>/.test(m[1]) && !/<inputAssignments>/.test(m[1]));
  if (triggerType === 'RecordBeforeSave' || savesWholeRecord) {
    for (const m of xmlText.matchAll(/<assignToReference>\$Record\.([A-Za-z0-9_]+)/g)) writes.push(m[1]);
  }
```

Update the `Writes:` paragraph of the comment above `parseFlowDependencies` to:

```
 * Writes: a `$Record.<Field>` assignment target in a before-save flow, or in
 * an after-save flow that saves the whole record (a <recordUpdates> with
 * inputReference $Record and no inputAssignments) — an after-save assignment
 * is otherwise never saved — or an `inputAssignments/field` on a
 * <recordUpdates> that updates `$Record` directly or updates the same object
 * filtered by Id = $Record.Id (either trigger timing).
```

and add to the `Reads:` paragraph: ``A read through a relationship (`$Record.WorkType.Name`) is recorded as the lookup field (`WorkTypeId`).``

Confirm the writes list is deduplicated before it is returned (the existing `dedupeFields` call); if it is not, apply `dedupeFields(writes)` so the "listed once" check holds.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `node plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs`
Expected: `all checks passed`.

- [ ] **Step 7: Check the real field-service flows**

Run from `~/git-repos/REWS-Workplace-Services/rews-field-service` (read-only): `node <plugin>/scripts/flow-trigger-order.mjs WorkOrder`
Expected: `Field_Service_Work_Order_Before_Save` reads show `WorkTypeId` and `LocationforWorkOrders__c`, and no `WorkType` or `LocationforWorkOrders__r`. Put the output in the task report.

- [ ] **Step 8: Run every test file, then commit**

```bash
git add plugins/hean-harness/scripts/lib/flow-trigger-order.mjs plugins/hean-harness/scripts/__tests__/flow-trigger-order.test.mjs
git commit -m "@HEAN-1: Match lookup reads and whole-record saves in flow order"
```

### Task 3: Setup description and task tools restore test

Implements items 8 and 9.

**Files:**
- Modify: `skills/setup/SKILL.md` (frontmatter `description`)
- Test: `scripts/__tests__/setup-twice.test.mjs`

**Before and after, item 8.**

```yaml
description: Install the hean-harness environment on this machine — copies rules, memories, agents and the status line into place, adds the claude alias, and records every change so uninstall can reverse it
description: Install the hean-harness environment on this machine — copies rules, memories, agents and the status line into place, adds the claude alias, turns on Claude Code's task tools in settings.json, and records every change so uninstall can reverse it
```

- [ ] **Step 1: Write the test (item 9)**

In `scripts/__tests__/setup-twice.test.mjs`, directly after the `home4` check (`'a settings.json with no env block has no env block after uninstall'`), add:

```js
  // A user who already set the task tools key to their own value gets that
  // value back on uninstall, not a deleted key.
  const home5 = join(root, 'home5');
  mkdirSync(join(home5, '.claude'), { recursive: true });
  const settings5 = join(home5, '.claude', 'settings.json');
  writeFileSync(settings5, JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' } }, null, 2) + '\n');
  const env5 = { ...process.env, HOME: home5 };
  execFileSync('node', [join(SCRIPTS, 'install-task-tools.mjs')], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterSetup5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('setup replaces the user\'s own task tools value with 1',
        afterSetup5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', JSON.stringify(afterSetup5));
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: env5, encoding: 'utf8', stdio: 'pipe' });
  const afterUninstall5 = JSON.parse(readFileSync(settings5, 'utf8'));
  check('uninstall puts back the user\'s own task tools value',
        afterUninstall5.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '0', JSON.stringify(afterUninstall5));
```

- [ ] **Step 2: Run the test**

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: both new checks pass (the restore code exists; the test was missing). If `'uninstall puts back…'` fails, report it as a defect found and stop the task; do not change `install.mjs` inside this task.

- [ ] **Step 3: Change the description (item 8)**

Replace the `description:` line in `skills/setup/SKILL.md` with the "after" line above.

- [ ] **Step 4: Run every test file, then commit**

```bash
git add plugins/hean-harness/skills/setup/SKILL.md plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs
git commit -m "@HEAN-1: Name the task tools setting and test its restore"
```

### Task 4: Doctor reports an ego lite app older than the ego-browser skill

Implements item 10.

**Files:**
- Modify: `scripts/lib/environment.mjs` (`checkEgoLite`, the `ego lite` row in `allChecks`)
- Test: `scripts/__tests__/setup-twice.test.mjs`

**The problem, from this machine on 2026-09-25:**

```
$ ego-browser --version
ego-browser 0.4.7.4
$ ego-browser nodejs -e 'console.log(typeof taskSpace)'
undefined                                  ← every ego-browser skill example starts with taskSpace(...)
```

**After, in doctor and in setup's list of things to run yourself:**

```
  MISSING  ego lite       0.4.7.4 is older than the ego-browser skill, which needs taskSpace
           fix: ego-browser upgrade
```

- [ ] **Step 1: Write the failing tests**

In `scripts/__tests__/setup-twice.test.mjs`, add `chmodSync` to the `node:fs` import, and directly after the check `'doctor does not flag setup as out of date after a run'` add:

```js
  // An ego lite app without taskSpace cannot run the ego-browser skill.
  // A stand-in ego-browser on PATH answers the same probe doctor sends.
  if (process.platform === 'darwin') {
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeEgo = typeofTaskSpace => {
      const file = join(fakeBin, 'ego-browser');
      writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ego-browser 0.4.7.4"; else echo "${typeofTaskSpace}"; fi\n`);
      chmodSync(file, 0o755);
    };
    const doctorWithEgo = () => {
      try {
        return execFileSync('node', [join(SCRIPTS, 'doctor.mjs')],
          { env: { ...env, PATH: `${fakeBin}:${process.env.PATH}` }, encoding: 'utf8', stdio: 'pipe' });
      } catch (e) { return String(e.stdout ?? ''); }
    };
    fakeEgo('undefined');
    const oldEgo = doctorWithEgo();
    check('doctor flags an ego lite app that has no taskSpace',
          oldEgo.includes('0.4.7.4 is older than the ego-browser skill') && oldEgo.includes('fix: ego-browser upgrade'), oldEgo);
    fakeEgo('function');
    check('doctor does not flag an ego lite app that has taskSpace',
          !doctorWithEgo().includes('older than the ego-browser skill'));
    fakeEgo('');
    check('doctor does not flag an ego lite app whose probe prints nothing',
          !doctorWithEgo().includes('older than the ego-browser skill'));
  }
```

- [ ] **Step 2: Run the test and confirm the first new check fails**

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: FAIL on `'doctor flags an ego lite app that has no taskSpace'`.

- [ ] **Step 3: Implement**

In `scripts/lib/environment.mjs`, above `checkEgoLite`, add:

```js
/**
 * Does the installed ego lite app provide `taskSpace`? The ego-browser skill
 * starts every browser task with it, and the skill names no app version to
 * compare against, so ask the app. Returns false only for a definite
 * `undefined`; an error, a timeout or any other answer is not a finding.
 */
function egoLiteHasTaskSpace() {
  const r = spawnSync('ego-browser', ['nodejs', '-e', 'console.log(typeof taskSpace)'],
                      { encoding: 'utf8', timeout: 20000 });
  return (r.stdout || '').trim() !== 'undefined';
}
```

In `checkEgoLite`, replace:

```js
  if (apps.some(a => existsSync(a)) || present('ego-browser')) return { ok: true, detail: 'installed' };
```

with:

```js
  if (apps.some(a => existsSync(a)) || present('ego-browser')) {
    if (present('ego-browser') && !egoLiteHasTaskSpace()) {
      const version = run('ego-browser', ['--version']).match(/ego-browser (\S+)/)?.[1] ?? 'The installed app';
      return { ok: false, detail: `${version} is older than the ego-browser skill, which needs taskSpace` };
    }
    return { ok: true, detail: 'installed' };
  }
```

In `allChecks`, change the `ego lite` row's `fix: null` to `fix: 'ego-browser upgrade'`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: `all checks passed`.

- [ ] **Step 5: Check this machine**

Run: `node plugins/hean-harness/scripts/doctor.mjs | grep -A1 'ego lite'`
Expected: the `MISSING … 0.4.7.4 is older than the ego-browser skill` line and `fix: ego-browser upgrade`. Put the output in the task report.

- [ ] **Step 6: Run every test file, then commit**

```bash
git add plugins/hean-harness/scripts/lib/environment.mjs plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs
git commit -m "@HEAN-1: Report an ego lite app older than its skill"
```

### Task 5: Deployer rebuilds the per-story manifest before every deploy

Implements item 11, "Check at deploy". The user chose "Rewrite from branch": the manifest is rewritten from the branch changes, as branch-manifest does today, and the dropped entries are shown.

**Files:**
- Modify: `agents/sfdx-deployer.md` (the `<Agent_Prompt>` block only; the memory section below it stays)
- Modify: `assets/memories/project/feedback_manifest_location.md`

**The problem.** `agents/sfdx-deployer.md:41`:

```
1. **Per-story manifest check** — ... If `.claude/manifest/<WORK-ID>.xml` exists, use it directly as
   the deploy manifest and skip to step 6 ...          ← a file written on day 1 misses day-3 components
```

**Decision this reverses.** The shipped memory says the deployer "should deploy directly from an existing `.claude/manifest/{WORK-ID}.xml` when one exists rather than re-deriving scope via diff each run". The user's choice replaces that sentence (Step 5 below).

- [ ] **Step 1: Confirm a subagent can run a plugin skill**

The deployer will call the `hean-harness:branch-manifest` skill through the Skill tool. Confirm that before relying on it: in a scratch git repository with a `force-app/` file on a `work-ABC-1` branch, run a headless session that spawns `hean-harness:sfdx-deployer`-style subagent work, or read the Claude Code documentation on subagent tool access. Record the evidence (doc URL or probe output) in the task report. If a subagent cannot use the Skill tool, stop and report; do not continue this task.

- [ ] **Step 2: Rewrite the agent prompt**

Apply these changes inside `<Agent_Prompt>`, keeping the section order in `~/.claude/rules/agent-writing-style.md`:

`<Role>` responsibilities line:

```
You are responsible for: per-story manifest refresh through the branch-manifest skill, sf CLI deployment execution, and the deployment report.
```

`<Why_This_Matters>` — append: `A per-story manifest written early in a story does not list components added later; deploying it as found leaves those components out of the org while the deploy reports success.`

`<Success_Criteria>` — replace the first two bullets and the temp-manifest bullet with:

```
- The deploy manifest is the `.claude/manifest/` file that the `hean-harness:branch-manifest` skill created, updated or left unchanged in this run.
- The report lists every component that run added to the manifest and every entry it dropped.
- A file under `.claude/manifest/` is never deleted.
```

`<Constraints>` — remove **No uncommitted deploys** and **Temp manifest cleanup**; add:

```
- **Manifest from branch-manifest only**: Build the deploy manifest only by running the `hean-harness:branch-manifest` skill. Never write a package.xml by hand and never delete a file under `.claude/manifest/`.
```

`<Investigation_Protocol>` — replace all steps with:

```
1. **Refresh the per-story manifest** — Run the `hean-harness:branch-manifest` skill with no arguments through the Skill tool. Read the first line of its output:
   - `Manifest: <path> created`, `updated` or `unchanged` → use `<path>` as the deploy manifest. Keep the "Added since the previous version of the file" and "Dropped since the previous version of the file" sections for the report.
   - `Manifest: <path> not written; no Salesforce metadata was added or modified` → stop and report `Aborted — no changes`.
   - `Error: …` → stop and report the output word for word.
2. **Conflict strategy** — Always deploy with `--ignore-conflicts`. Local changes take precedence over the org. Do not retrieve before deploying.
3. **Resolve target org** — Read `.claude/rules/org-roles.md` and follow its "Before any write" section. Read the CLI default alias from `sf config get target-org --json` (`result[0].value`) and state it in the report. When no roles are saved, or the alias is not the saved deploy target, stop and report that to the caller without deploying.
4. **Deploy execution** — Run, with the alias from step 3 written out as text:
   `sf project deploy start --manifest <manifest-path> -o <alias> --wait 30 --ignore-conflicts`
   When the org write gate refuses the command, report its message to the caller word for word and stop.
5. **Report** — Emit the deployment report and stop.
```

`<Tool_Usage>` — replace with:

```
- Use Skill to run `hean-harness:branch-manifest` with no arguments (step 1).
- Use Bash to run `sf config get target-org --json` and `sf project deploy start`.
```

`<Execution_Policy>` stop line: `Stop when: the deployment exits with a terminal state (Succeeded or Failed), or step 1 stops the run.`

Remove the `<Metadata_Type_Mapping>` section (branch-manifest maps types through the sf CLI).

`<Output_Format>` — add after the header fields:

```
## Manifest
**File:** [.claude/manifest/<name>.xml]
**Status:** [created | updated | unchanged]
- Added: [MetadataType: APIName, or none]
- Dropped: [MetadataType: APIName, or none]
```

`<Failure_Modes_To_Avoid>` — replace "Redundant manifest rediscovery", "Silent ad hoc scoping", "No diff check" and "Manifest leak" with:

```
- Stale manifest deploy: Deploying `.claude/manifest/<WORK-ID>.xml` as found, without running branch-manifest first, leaves out components added after the file was written. Run branch-manifest before every deploy.
- Hand-built manifest: Writing a package.xml from `git diff HEAD` misses the branch's committed changes and its untracked files. Use branch-manifest only.
```

`<Examples>` and `<Final_Checklist>` — rewrite every line that mentions `git diff`, a temp manifest, `/tmp`, or asking whether to create the manifest, so they match the new steps. The checklist gets: `- Did I run branch-manifest before deploying and deploy the file it named?` and `- Did I list the components branch-manifest added and dropped?`.

- [ ] **Step 3: Update the shipped memory**

In `assets/memories/project/feedback_manifest_location.md`, replace:

```
`sfdx-deployer` should deploy directly from an existing `.claude/manifest/{WORK-ID}.xml` when one exists rather than re-deriving scope via diff each run.
```

with:

```
`hean-harness:sfdx-deployer` rebuilds `.claude/manifest/{WORK-ID}.xml` with branch-manifest before every deploy, so components added after the file was first written are deployed too.
```

- [ ] **Step 4: Check the agent file**

Run: `grep -n 'git diff\|/tmp\|temp manifest\|AskUserQuestion\|Metadata_Type_Mapping' plugins/hean-harness/agents/sfdx-deployer.md`
Expected: no line inside `<Agent_Prompt>`. Also confirm no `---` line after the frontmatter and exactly one trailing newline in both files.

- [ ] **Step 5: Run every test file, then commit**

```bash
git add plugins/hean-harness/agents/sfdx-deployer.md plugins/hean-harness/assets/memories/project/feedback_manifest_location.md
git commit -m "@HEAN-1: Rebuild the story manifest before every deploy"
```

### Task 6: create-pr and update-pr rebuild, commit and push the per-story manifest

Implements item 11, "Check at PR". The user chose "Commit and push it".

**Files:**
- Modify: `skills/create-pr/SKILL.md` (Phase 9)
- Modify: `skills/update-pr/SKILL.md` (Phase 2)

**Interfaces:**
- Consumes: the branch-manifest script at `${CLAUDE_SKILL_DIR}/../branch-manifest/scripts/branch-manifest.mjs` and its first output line `Manifest: <path> <status>`.

create-pr, update-pr and branch-manifest are designed to work together from this task on; state that once in each PR skill's new step.

**After, create-pr Phase 9.** Insert a new Step 1 and renumber the existing Step 1 and Step 2 to Step 2 and Step 3 (update any text that refers to them by number):

````markdown
**Step 1 — Rebuild the per-story manifest.**

create-pr, update-pr and branch-manifest work together: the PR carries the story's manifest as the branch now stands. Run:
```bash
node "${CLAUDE_SKILL_DIR}/../branch-manifest/scripts/branch-manifest.mjs"
```

Read the first line:

- `Manifest: <path> created` or `updated` → commit only that file, then continue; Step 2 pushes it:
  ```bash
  git add <path>
  git commit -m "@{BRANCH_WORK_ID}: Add the per-story manifest"      # when created
  git commit -m "@{BRANCH_WORK_ID}: Update the per-story manifest"   # when updated
  ```
  Show the output's "Added since…" and "Dropped since…" sections to the user. When the commit is refused, show the refusal word for word, list the manifest as uncommitted, and stop.
- `Manifest: <path> unchanged` or `… not written; no Salesforce metadata was added or modified` → commit nothing and continue.
- `Error: …` → show the output word for word and stop.
````

**After, update-pr Phase 2.** Insert the same block as the first thing in Phase 2, before `Derive {owner}/{repo}`, with `/update-pr` in place of `/create-pr` where the text names the skill.

- [ ] **Step 1: Confirm `${CLAUDE_SKILL_DIR}` is replaced in skill body text**

branch-manifest's own SKILL.md already relies on `${CLAUDE_SKILL_DIR}` in body text (its reply table). Confirm in the Claude Code skills documentation that the variable is substituted in the skill body, and record the URL in the task report. If it is not, stop and report.

- [ ] **Step 2: Edit create-pr Phase 9 and update-pr Phase 2** as shown above.

- [ ] **Step 3: Check both skill files**

Run: `grep -n 'branch-manifest' plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md`
Expected: the new step in each file. Read each whole file once for step numbers that no longer match. Confirm each description stays unchanged and 50 words or fewer.

- [ ] **Step 4: Run every test file, then commit**

```bash
git add plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md
git commit -m "@HEAN-1: Commit the refreshed story manifest before a PR"
```

### Task 7: Story reminder the manual-steps question cannot skip

Implements the user's request of 2026-09-25: when create-pr or update-pr asks for pre and post deployment steps, brief the user on what the story asked for and what the branch changed, so a user switching between parallel stories does not have to reread the story or the git graph.

**Files:**
- Modify: `assets/rules/project/runbook-deployment-steps.md` (Story reminder)
- Modify: `skills/create-pr/SKILL.md` (Phase 5 Step 2)
- Modify: `skills/update-pr/SKILL.md` (Phase 7 Step 2)

**The problem.** The field-service session (create-pr 0.1.25, DEXRWO-322) had the Story reminder rule in its context and sent no reply text before the manual-steps question; the one line above the question in the screenshot is the session's visible thinking. The question itself names only the ID:

```
Which manual deployment steps apply to DEXRWO-322?          ← no story, no branch summary
```

The rule loads by `paths:` (`runbooks/**`, `deletePackage/**`), and the skills point to it in one sentence, so the reminder depends on the model choosing to print a block before a tool call.

**After.** Two changes:

1. The reminder moves into the skills as an explicit step with its own template, sent as reply text in the same message as the question and before it.
2. The question text carries a one-line version, so the dialog shows it even when the reply text is skipped:

```
DEXRWO-322 — Parent WO Subject does not auto-populate to the SA Subject
Asked for: the Service Appointment's Subject should copy the parent Work Order's Subject when the SA is created.
Done on this branch (1 commit, 3 files):
  - SA Subject is filled from the parent WO, keeping a Subject already set
Found automatically:
  - Pre or post runbook script:   none
  - Delete package entries:       none
  - Experience Cloud site files:  none
Same story in other repositories: none — checked rews-base, rews-corrigo-integration, ...

Which manual deployment steps apply to DEXRWO-322 (SA Subject copies the parent WO Subject)?
```

- [ ] **Step 1: Change the rule's template**

In `assets/rules/project/runbook-deployment-steps.md`, Story reminder template, replace:

```
Story:   {first sentence of the Linear description}
```

with:

```
Asked for: {what the story asks for, in one or two sentences of your own from the Linear description}
```

In **Line sources**, replace "the title and first sentence come from the Linear story lookup" with "the title and the Asked for line come from the Linear story lookup". Add one bullet:

```
- **Never shortened**: Send the block in this exact shape as reply text, in the same message as the question and before it. A one-sentence summary does not replace it.
```

- [ ] **Step 2: Put the reminder into create-pr Phase 5 Step 2**

Replace the sentence `Print the Story reminder that rule defines immediately before the call.` with:

```
Before the call, send the Story reminder from `.claude/rules/runbook-deployment-steps.md` as reply text, one block per story, in the rule's exact shape; read that file first when it is not already in context. Put the story's purpose in the question itself too: `Which manual deployment steps apply to {ID} ({what the story asks for, 12 words or fewer})?`
```

- [ ] **Step 3: Put the reminder into update-pr Phase 7 Step 2**

Replace `Print the Story reminder defined in `.claude/rules/runbook-deployment-steps.md` immediately before this question.` with the same text as Step 2, and change the question line to:

```
Add or update manual deployment steps for Story {N} ({WORK-ID}: {what the story asks for, 12 words or fewer})? (yes/no)
```

- [ ] **Step 4: Check the three files**

Run: `grep -n 'Asked for\|Story reminder\|first sentence' plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md`
Expected: no `first sentence` left; `Asked for` in the rule; the new sentence in both skills.

- [ ] **Step 5: Run every test file, then commit**

```bash
git add plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md
git commit -m "@HEAN-1: Show the story reminder in the manual steps question"
```

### Task 8: Release 0.1.26

Run by the main session after the final whole-change review.

- [ ] **Step 1:** Run every test file once more; all pass.
- [ ] **Step 2:** Change `version` in `plugins/hean-harness/.claude-plugin/plugin.json` to `0.1.26`; commit it alone as `@HEAN-1: Set version to 0.1.26`.
- [ ] **Step 3:** Check `git log --format='%(trailers:only)' origin/main..HEAD` is empty; reword any commit that has a trailer.
- [ ] **Step 4:** Push with the SSH swap from the handoff, then confirm `cmp` and both `ssh -T` answers.
- [ ] **Step 5:** `claude plugin marketplace update hean-sfdx-harness-system && claude plugin update hean-harness@hean-sfdx-harness-system`.
- [ ] **Step 6:** Tell peer `rews-field-service-0f` that 0.1.26 changes the Story reminder and the deployer, and that `/reload-plugins` loads it.
