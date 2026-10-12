# Flow Version Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/hean-harness:flow-version-cleanup`, which deletes the oldest non-Active versions of every flow at the 50-version limit with Salesforce CLI Tooling API requests only, and make the org write gate treat data-changing `sf api request` commands as org writes.

**Architecture:** A pure library (`scripts/lib/flow-version-cleanup.mjs`) selects versions, builds 25-subrequest batches, parses batch responses and renders text. A command-line script (`scripts/flow-version-cleanup.mjs`) has two subcommands: `plan` (read-only query, prints the plan and the role commands) and `apply` (refuses unless the org is a saved deploy target, sends the batches one at a time, retries lock errors once, re-queries). The skill (`skills/flow-version-cleanup/SKILL.md`) runs the conversation: org, one confirmation, temporary write permission, reset. The gate change is in `hooks/org-write-gate.mjs`.

**Tech Stack:** Node.js ESM (`.mjs`), no dependencies; Salesforce CLI (`sf data query --use-tooling-api`, `sf org display`, `sf api request rest`); tests are plain `node` scripts with a fake `sf` on `PATH`.

**Spec:** `docs/superpowers/specs/2026-10-09-flow-version-cleanup.md`

## Global Constraints

- Never use Apex, a metadata deploy, a Remote Site Setting, a Named Credential or a Connected App. Apex reaches the Tooling API only through an HTTP callout, which needs one of those.
- Only flows with `>= 50` versions (`VERSION_LIMIT = 50`, the platform limit per flow, Salesforce Help "General Flow Limits").
- `--count` is optional, defaults to `5`, must match `^[1-9]\d*$`.
- Candidates: every version whose `Status` is not `Active`, lowest `VersionNumber` first. The Active version is never deleted. A flow at the limit with no Active version is skipped and listed.
- Batches hold at most 25 subrequests (Composite Batch limit) and are sent one at a time. `UNABLE_TO_LOCK_ROW` failures are retried once, alone; no other failure is retried. `FlowInterview` records are never deleted.
- `argument-hint: "[org alias or username] [--count <N, default 5>]"`.
- Commit subjects: `@HEAN-1: Capitalised imperative summary`, at most 10 words and 77 characters. No attribution trailers of any kind.
- Commit by explicit path only (`git add <paths>`; never `git add -A` or `.`).
- Shipped text and tests name no client project (no REWS, field-service, sharedqa).
- Tests never call a real org.
- Scratch folders in shell steps: `T=$(mktemp -d) || exit 1; [ -n "$T" ] && [ -d "$T" ] || exit 1`; quote `"$T"`; remove only under `/var/folders` or `/tmp`.

## Review Focus

1. **The CLI prints a warning before the JSON** (for example "update available"). Expected: the script parses JSON from the first `{` on stdout and never mixes stderr into stdout. Pinned in Task 2 (`parseBatchResponse` with a leading warning line) and Task 3 (fake `sf` prints a warning line before its JSON).
2. **A request whose response is lost but which the org completed.** Expected: the final query decides; a version that is gone counts as deleted, with a note. Pinned in Task 2 (`reconcile`) and Task 3 (fake batch answer is empty, after-query no longer has the Ids).
3. **A version becomes Active between plan and apply.** Expected: it is not sent and is listed as "now Active". Pinned in Task 2 (`stillDeletable`) and Task 3.
4. **The role is not restored after a failed apply.** Expected: SKILL.md runs the RESTORE command after every apply exit code, including 1 and 3, and on a restore failure prints the command with `!!`. Pinned in Task 4 by the step text; `roleCommands` output pinned in Task 2.
5. **`apply` run against a locked org** (someone skips the skill's permission step). Expected: refused before any request, nothing deleted. Pinned in Task 3.

---

### Task 1: Org write gate treats data-changing `sf api request` as a write

**Files:**
- Modify: `plugins/hean-harness/hooks/org-write-gate.mjs` (the `WRITES` comment block near line 36, `orgWrite` near line 78, `check` near line 100)
- Test: `plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs`

**Interfaces:**
- Consumes: `flagValue(args, names)`, `ORG_FLAGS`, `commandsIn` (already in the file).
- Produces: `orgWrite(words, dir = process.cwd())` — same return shape as today (`{ org }` or `null`); `dir` resolves a GraphQL body file path.

- [ ] **Step 1: Write the failing tests**

In `org-write-gate.test.mjs`, after the line `const NOT_SFDX = join(sandbox, 'plain');` and `mkdirSync(NOT_SFDX);`, add the GraphQL body files:

```js
writeFileSync(join(READY, 'query.graphql'), '{ uiapi { query { Account { edges { node { Id } } } } } }');
writeFileSync(join(READY, 'mutation.graphql'), 'mutation { uiapi { AccountCreate(input: {}) { Record { Id } } } }');
```

Add to the `Allowed` block, after `allow('not an sf command', ...)`:

```js
allow('api request with no method',         'sf api request rest /services/data/v64.0/limits -o qa');
allow('api request GET',                    'sf api request rest /services/data/v64.0/limits -X GET -o qa');
allow('api request HEAD',                   'sf api request rest /services/data/v64.0/limits --method HEAD -o qa');
allow('graphql query body file',            'sf api request graphql --body query.graphql -o qa');
```

Add to the `Refused` block, after `deny('pre/post deploy script', ...)`:

```js
deny('api request POST',                    'sf api request rest /services/data/v64.0/tooling/composite/batch -X POST --body @b.json -o qa', READY, 'saved as pipeline');
deny('api request lower-case method',       'sf api request rest /services/data/v64.0/sobjects/Account -X post -o qa', READY, 'saved as pipeline');
deny('api request --method=DELETE',         'sf api request rest /services/data/v64.0/sobjects/Account/001 --method=DELETE -o qa', READY, 'saved as pipeline');
deny('api request PATCH, flags after URL',  'sf api request rest /services/data/v64.0/sobjects/Account/001 -X PATCH --body @a.json --target-org qa', READY, 'saved as pipeline');
deny('api request PUT, method before URL',  'sf api request rest -X PUT /services/data/v64.0/x -o qa', READY, 'saved as pipeline');
deny('api request from a request file',     'sf api request rest --file request.json -o qa', READY, 'saved as pipeline');
deny('graphql mutation body file',          'sf api request graphql --body mutation.graphql -o qa', READY, 'saved as pipeline');
deny('graphql unreadable body file',        'sf api request graphql --body @missing.graphql -o qa', READY, 'saved as pipeline');
deny('graphql body from stdin',             'sf api request graphql --body - -o qa', READY, 'saved as pipeline');
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `node plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs`
Expected: FAIL lines for every new `deny(...)` case (they are allowed today); the new `allow(...)` cases pass; exit 1.

- [ ] **Step 3: Implement**

In `org-write-gate.mjs`, add `readFileSync` and `existsSync` to the `node:fs` import (add the import if the file has none) and `resolve` to the `node:path` import. Below the `WRITES` set add:

```js
/** sf api request commands: writes only when they can change data, decided by apiRequestWrites. */
const API_REQUESTS = new Set(['api request rest', 'api request graphql']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether an `sf api request` command can change data. rest: a POST, PUT, PATCH
 * or DELETE method, or a --file request file (it can carry any method; the CLI
 * sends GET when no method is given). graphql: a body containing `mutation`, or
 * a body the gate cannot read.
 */
function apiRequestWrites(kind, args, dir) {
  if (kind === 'api request rest') {
    if (flagValue(args, ['-f', '--file']) !== undefined) return true;
    const method = flagValue(args, ['-X', '--method']);
    return method !== undefined && WRITE_METHODS.has(String(method).toUpperCase());
  }
  const body = flagValue(args, ['--body']);
  if (!body || body === '-') return true;
  let text = body;
  const path = resolve(dir, body.startsWith('@') ? body.slice(1) : body);
  if (body.startsWith('@') || existsSync(path)) {
    try { text = readFileSync(path, 'utf8'); } catch { return true; }
  }
  return /\bmutation\b/.test(text);
}
```

Change `orgWrite`'s signature and the topic check:

```js
export function orgWrite(words, dir = process.cwd()) {
```

Replace

```js
  if (!WRITES.has(topic.join(' '))) return null;
  const args = w.slice(i);
```

with

```js
  const head = topic.slice(0, 3).join(' ');
  const args = w.slice(i);
  if (API_REQUESTS.has(head)) {
    // The URL is a positional argument, so it can sit in topic or after the flags.
    if (!apiRequestWrites(head, args, dir)) return null;
    return { org: flagValue(args, ORG_FLAGS) };
  }
  if (!WRITES.has(topic.join(' '))) return null;
```

In `check`, pass the command's folder:

```js
    const write = orgWrite(words, dir ?? sessionCwd);
```

Update the file header comment's "Checked:" sentence to add: "and `sf api request rest` / `graphql` when they can change data".

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs`
Expected: `N passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/hooks/org-write-gate.mjs plugins/hean-harness/hooks/__tests__/org-write-gate.test.mjs
git commit -m "@HEAN-1: Gate data-changing sf api request commands as org writes"
```

---

### Task 2: Selection, batching and report library

**Files:**
- Create: `plugins/hean-harness/scripts/lib/flow-version-cleanup.mjs`
- Test: `plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs` (library part; Task 3 appends the command-line part)

**Interfaces:**
- Consumes: `formatRanges(numbers)` from `scripts/lib/apex-coverage.mjs` (`[1,2,3,7] -> "1-3, 7"`).
- Produces (all named exports):
  - `VERSION_LIMIT = 50`, `BATCH_SIZE = 25`, `DEFAULT_COUNT = 5`, `EXIT = { OK: 0, ERROR: 1, NOTHING: 2, FAILED: 3 }`
  - `FLOW_QUERY` — `'SELECT Id, DefinitionId, Definition.DeveloperName, VersionNumber, Status FROM Flow'`
  - `parseCount(value: string|undefined): number` — throws `Error` on a bad value
  - `matchOrg(name: string, orgs: {username, aliases: string[], isSandbox}[]): org[]`
  - `checkComplete(result: {done, totalSize, records}): void` — throws on a partial list
  - `selectVersions(records, count): { flows: Flow[], skipped: {definitionId, name, present}[] }` where `Flow = { definitionId, name, present, activeVersion, delete: {id, version, status}[] }`
  - `stillDeletable(planned: {id, version, name, definitionId}[], records): { keep, dropped: (planned & {reason})[] }`
  - `buildBatches(versions, apiVersion: string): { versions, body: { batchRequests: {method, url}[] } }[]`
  - `parseBatchResponse(versions, stdout: string, stderr?: string): (version & { ok: boolean, error?: string })[]`
  - `isLockError(error: string|undefined): boolean`
  - `reconcile(results, records): results` — a failed version absent from `records` becomes `ok: true` with `note`
  - `roleCommands(previous: savedRole|null, name: string, rolesScript: string): { locked: boolean, allow: string|null, restore: string|null }`
  - `renderPlan({ count, flows, skipped }): string`
  - `renderReport({ name, results, dropped, skipped, before, after }): string`

- [ ] **Step 1: Write the failing tests**

Create `plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`:

```js
#!/usr/bin/env node
/**
 * What flow-version-cleanup selects, sends and reports.
 *
 * No org is called. The library is tested directly; the command-line part
 * puts a fake `sf` first on PATH that logs its arguments and answers from
 * canned JSON, and a throwaway HOME holding the CLI logins and aliases.
 *
 * Run: node scripts/__tests__/flow-version-cleanup.test.mjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const lib = await import(join(SCRIPTS, 'lib', 'flow-version-cleanup.mjs'));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${!ok && detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** n versions of one flow; active: the Active version number or null; status(v) overrides the rest. */
function flow(name, n, active, status = () => 'Obsolete') {
  return Array.from({ length: n }, (_, i) => ({
    Id: `301${name}${String(i + 1).padStart(3, '0')}`, DefinitionId: `300${name}`,
    Definition: { DeveloperName: name }, VersionNumber: i + 1,
    Status: i + 1 === active ? 'Active' : status(i + 1)
  }));
}

console.log('parseCount');
check('default is 5', lib.parseCount(undefined) === 5);
check('accepts 30', lib.parseCount('30') === 30);
for (const bad of ['0', '-2', 'abc', '1.5', '']) {
  let threw = false; try { lib.parseCount(bad); } catch (e) { threw = /whole number of 1 or more/.test(e.message); }
  check(`refuses "${bad}"`, threw);
}

console.log('matchOrg');
const orgs = [
  { username: 'me@example.com.qa', aliases: ['qaOrg'], isSandbox: true },
  { username: 'me@example.com.uat', aliases: ['uatOrg'], isSandbox: true },
  { username: 'other@example.com.qa', aliases: [], isSandbox: true },
  { username: 'me@example.com', aliases: ['prod'], isSandbox: false }
];
check('alias, any case', same(lib.matchOrg('QAORG', orgs).map(o => o.username), ['me@example.com.qa']));
check('username', same(lib.matchOrg('me@example.com.uat', orgs).map(o => o.username), ['me@example.com.uat']));
check('sandbox name matching one org', same(lib.matchOrg('uat', orgs).map(o => o.username), ['me@example.com.uat']));
check('sandbox name matching two orgs', lib.matchOrg('qa', orgs).length === 2);
check('no match', lib.matchOrg('nothing', orgs).length === 0);
check('production has no sandbox name', lib.matchOrg('com', orgs).length === 0);

console.log('checkComplete');
let partial = false; try { lib.checkComplete({ done: false, totalSize: 3, records: [{}] }); } catch (e) { partial = /partial/.test(e.message); }
check('done false is refused', partial);
let short = false; try { lib.checkComplete({ done: true, totalSize: 3, records: [{}] }); } catch (e) { short = /partial/.test(e.message); }
check('fewer records than totalSize is refused', short);
let whole = true; try { lib.checkComplete({ done: true, totalSize: 1, records: [{}] }); } catch { whole = false; }
check('a whole list passes', whole);

console.log('selectVersions');
{
  const records = [
    ...flow('Under', 49, 49),
    ...flow('Full', 50, 20, v => v > 40 ? 'Draft' : 'Obsolete'),
    ...flow('NoActive', 50, null),
    ...flow('Above', 52, 3, v => v === 1 ? 'InvalidDraft' : 'Obsolete')
  ];
  const { flows, skipped } = lib.selectVersions(records, 5);
  check('49 versions untouched', !flows.some(f => f.name === 'Under') && !skipped.some(s => s.name === 'Under'));
  check('no Active version is skipped', same(skipped, [{ definitionId: '300NoActive', name: 'NoActive', present: 50 }]));
  const full = flows.find(f => f.name === 'Full');
  check('50 versions selected, oldest 5', same(full.delete.map(v => v.version), [1, 2, 3, 4, 5]));
  check('active version recorded', full.activeVersion === 20);
  const above = flows.find(f => f.name === 'Above');
  check('Active never selected; InvalidDraft counts', same(above.delete.map(v => v.version), [1, 2, 4, 5, 6]));
  check('flows sorted by name', same(flows.map(f => f.name), ['Above', 'Full']));
  const big = lib.selectVersions(flow('Big', 50, 50), 100).flows[0];
  check('count larger than candidates takes every candidate', big.delete.length === 49);
  const drafts = lib.selectVersions(flow('Late', 50, 10, v => v > 10 ? 'Draft' : 'Obsolete'), 45).flows[0];
  check('Drafts above the Active version are candidates', drafts.delete.some(v => v.version === 46));
  const gaps = flow('Gap', 50, 50).map((r, i) => ({ ...r, VersionNumber: i < 10 ? i * 3 + 1 : r.VersionNumber + 30 }));
  check('gaps in numbering: lowest numbers first',
        same(lib.selectVersions(gaps, 3).flows[0].delete.map(v => v.version), [1, 4, 7]));
}

console.log('stillDeletable');
{
  const planned = [{ id: 'a', version: 1 }, { id: 'b', version: 2 }, { id: 'c', version: 3 }];
  const { keep, dropped } = lib.stillDeletable(planned, [{ Id: 'a', Status: 'Obsolete' }, { Id: 'b', Status: 'Active' }]);
  check('keeps an inactive version', same(keep.map(v => v.id), ['a']));
  check('drops a version now Active', dropped.some(d => d.id === 'b' && d.reason === 'now Active'));
  check('drops a version already deleted', dropped.some(d => d.id === 'c' && d.reason === 'already deleted'));
}

console.log('buildBatches');
{
  const vs = n => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, version: i + 1 }));
  check('0 versions, no batch', lib.buildBatches(vs(0), '64.0').length === 0);
  check('25 versions, one batch', same(lib.buildBatches(vs(25), '64.0').map(b => b.versions.length), [25]));
  check('26 versions, two batches', same(lib.buildBatches(vs(26), '64.0').map(b => b.versions.length), [25, 1]));
  check('51 versions, three batches', same(lib.buildBatches(vs(51), '64.0').map(b => b.versions.length), [25, 25, 1]));
  check('subrequest shape', same(lib.buildBatches(vs(1), '64.0')[0].body,
        { batchRequests: [{ method: 'DELETE', url: 'v64.0/tooling/sobjects/Flow/id0' }] }));
}

console.log('parseBatchResponse');
{
  const vs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const body = JSON.stringify({ hasErrors: true, results: [
    { statusCode: 204, result: null },
    { statusCode: 400, result: [{ errorCode: 'DEPENDENCY_EXISTS', message: 'This flow version is referenced in a flow interview.' }] },
    { statusCode: 400, result: [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'unable to obtain exclusive access' }] }
  ] });
  const r = lib.parseBatchResponse(vs, ` ›   Warning: update available\n${body}`);
  check('204 is deleted', r[0].ok === true);
  check('error code and message kept', r[1].ok === false && r[1].error === 'DEPENDENCY_EXISTS: This flow version is referenced in a flow interview.');
  check('lock error recognised', lib.isLockError(r[2].error) && !lib.isLockError(r[1].error));
  const lost = lib.parseBatchResponse(vs, '', 'socket hang up');
  check('whole-request failure marks every version', lost.length === 3 && lost.every(x => !x.ok && /whole request failed: socket hang up/.test(x.error)));
  const wrongLength = lib.parseBatchResponse(vs, JSON.stringify({ results: [{ statusCode: 204 }] }));
  check('result count mismatch is a whole-request failure', wrongLength.every(x => !x.ok));
}

console.log('reconcile');
{
  const r = lib.reconcile([{ id: 'a', ok: false, error: 'whole request failed: x' }, { id: 'b', ok: false, error: 'DEPENDENCY_EXISTS: y' }],
                          [{ Id: 'b' }]);
  check('gone after a failure counts as deleted', r[0].ok === true && /whole request failed/.test(r[0].note));
  check('still present stays failed', r[1].ok === false);
}

console.log('roleCommands');
{
  const S = '/p/org-roles.mjs';
  check('deploy target needs nothing', same(lib.roleCommands({ role: 'development', deploy: true }, 'dev', S), { locked: false, allow: null, restore: null }));
  check('locked with role and branch', same(lib.roleCommands({ role: 'pipeline', deploy: false, branch: 'integration' }, 'qa', S), {
    locked: true,
    allow: 'node "/p/org-roles.mjs" set qa --role pipeline --deploy yes --branch integration',
    restore: 'node "/p/org-roles.mjs" set qa --role pipeline --deploy no --branch integration' }));
  check('no saved role', same(lib.roleCommands(null, 'qa', S), {
    locked: true,
    allow: 'node "/p/org-roles.mjs" set qa --role research --deploy yes',
    restore: 'node "/p/org-roles.mjs" remove qa' }));
}

console.log('renderPlan and renderReport');
{
  const { flows, skipped } = lib.selectVersions([...flow('Full', 50, 50), ...flow('NoActive', 50, null)], 5);
  const text = lib.renderPlan({ count: 5, flows, skipped });
  check('plan names the count', text.includes('COUNT: 5 oldest non-Active versions per flow'));
  check('plan counts flows at the limit', text.includes('AT LIMIT: 2 flows with 50 or more versions'));
  check('plan row with ranges', text.includes('Full | 50 | v50 | 5 | 1-5'));
  check('plan total', text.includes('TOTAL: 5 versions from 1 flows'));
  check('plan lists skipped', text.includes('NoActive: 50 versions'));
  const before = flow('Full', 50, 50);
  const after = before.slice(4);
  const results = [1, 2, 3, 4].map(v => ({ id: `x${v}`, version: v, name: 'Full', definitionId: '300Full', ok: true }))
    .concat([{ id: 'x5', version: 5, name: 'Full', definitionId: '300Full', ok: false, error: 'DEPENDENCY_EXISTS: z' }]);
  const report = lib.renderReport({ name: 'qa', results, dropped: [], skipped, before, after });
  check('report result line', report.includes('RESULT: 4 deleted, 1 failed in qa'));
  check('report before and after', report.includes('Full | 50 | 46'));
  check('report failure', report.includes('Full v5: DEPENDENCY_EXISTS: z'));
}

// COMMAND-LINE TESTS (Task 3) GO HERE

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`
Expected: FAIL with `Cannot find module '.../lib/flow-version-cleanup.mjs'`.

- [ ] **Step 3: Implement the library**

Create `plugins/hean-harness/scripts/lib/flow-version-cleanup.mjs`:

```js
/**
 * Selection, batching and report text for flow-version-cleanup.mjs.
 *
 * A flow holds at most 50 versions (Salesforce Help, "General Flow Limits");
 * at the limit, saving or deploying the flow fails. Versions are deleted
 * through the Tooling API from the Salesforce CLI, never from Apex: Apex
 * reaches the Tooling API only through an HTTP callout, which needs a Remote
 * Site Setting or Named Credential deployed to the org.
 */

import { formatRanges } from './apex-coverage.mjs';

export const VERSION_LIMIT = 50;
export const BATCH_SIZE = 25;   // Composite Batch accepts at most 25 subrequests
export const DEFAULT_COUNT = 5;
export const EXIT = { OK: 0, ERROR: 1, NOTHING: 2, FAILED: 3 };
export const FLOW_QUERY = 'SELECT Id, DefinitionId, Definition.DeveloperName, VersionNumber, Status FROM Flow';

/** The --count value: 5 when absent; a whole number of 1 or more, or an Error. */
export function parseCount(value) {
  if (value === undefined) return DEFAULT_COUNT;
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error(`--count must be a whole number of 1 or more, got "${value}"`);
  return Number(value);
}

/**
 * The logged-in orgs a name matches, ignoring case: by alias or username first,
 * then by sandbox name (the part of a sandbox username after its last dot).
 */
export function matchOrg(name, orgs) {
  const n = String(name).toLowerCase();
  const exact = orgs.filter(o => o.username.toLowerCase() === n || o.aliases.some(a => a.toLowerCase() === n));
  if (exact.length) return exact;
  return orgs.filter(o => o.isSandbox && o.username.slice(o.username.lastIndexOf('.') + 1).toLowerCase() === n);
}

/** Throws unless the query result holds every version: a plan from a partial list could miss a flow at the limit. */
export function checkComplete(result) {
  if (!result || !Array.isArray(result.records)) throw new Error('the flow query returned no records list');
  if (result.done === false || result.records.length < result.totalSize) {
    throw new Error(`the flow query returned ${result.records.length} of ${result.totalSize} versions; ` +
                    'refusing to plan from a partial list');
  }
}

/** The flows at the limit and, for each with an Active version, its `count` lowest-numbered non-Active versions. */
export function selectVersions(records, count) {
  const byFlow = new Map();
  for (const r of records) {
    const f = byFlow.get(r.DefinitionId) ??
      { definitionId: r.DefinitionId, name: r.Definition?.DeveloperName ?? r.DefinitionId, versions: [] };
    f.versions.push({ id: r.Id, version: r.VersionNumber, status: r.Status });
    byFlow.set(r.DefinitionId, f);
  }
  const flows = [];
  const skipped = [];
  for (const f of [...byFlow.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (f.versions.length < VERSION_LIMIT) continue;
    const active = f.versions.find(v => v.status === 'Active');
    if (!active) {
      skipped.push({ definitionId: f.definitionId, name: f.name, present: f.versions.length });
      continue;
    }
    const candidates = f.versions.filter(v => v.status !== 'Active').sort((a, b) => a.version - b.version);
    flows.push({ definitionId: f.definitionId, name: f.name, present: f.versions.length,
                 activeVersion: active.version, delete: candidates.slice(0, count) });
  }
  return { flows, skipped };
}

/** Splits planned versions by their status now: a version now Active or already gone is not sent. */
export function stillDeletable(planned, records) {
  const now = new Map(records.map(r => [r.Id, r.Status]));
  const keep = [];
  const dropped = [];
  for (const v of planned) {
    const status = now.get(v.id);
    if (status === undefined) dropped.push({ ...v, reason: 'already deleted' });
    else if (status === 'Active') dropped.push({ ...v, reason: 'now Active' });
    else keep.push(v);
  }
  return { keep, dropped };
}

/** Composite Batch request bodies of at most 25 DELETE subrequests, in the given order. */
export function buildBatches(versions, apiVersion) {
  const batches = [];
  for (let i = 0; i < versions.length; i += BATCH_SIZE) {
    const chunk = versions.slice(i, i + BATCH_SIZE);
    batches.push({ versions: chunk, body: { batchRequests: chunk.map(v =>
      ({ method: 'DELETE', url: `v${apiVersion}/tooling/sobjects/Flow/${v.id}` })) } });
  }
  return batches;
}

/**
 * Each version with ok, or ok false and the error. The JSON is read from the
 * first `{`, because the CLI can print a warning before it. A response that
 * is missing, unreadable or holds a different number of results fails every
 * version in the batch.
 */
export function parseBatchResponse(versions, stdout, stderr = '') {
  const text = String(stdout ?? '');
  const start = text.indexOf('{');
  let json = null;
  if (start >= 0) { try { json = JSON.parse(text.slice(start)); } catch { /* whole-request failure below */ } }
  const results = json?.results;
  if (!Array.isArray(results) || results.length !== versions.length) {
    const why = (String(stderr).trim() || text.trim()).split('\n')[0] || 'no response';
    return versions.map(v => ({ ...v, ok: false, error: `whole request failed: ${why}` }));
  }
  return versions.map((v, i) => {
    const r = results[i];
    if (r.statusCode === 204) return { ...v, ok: true };
    const e = Array.isArray(r.result) ? r.result[0] : r.result;
    return { ...v, ok: false, error: e?.errorCode ? `${e.errorCode}: ${e.message}` : `status ${r.statusCode}` };
  });
}

export const isLockError = error => String(error ?? '').startsWith('UNABLE_TO_LOCK_ROW');

/** A failed version the org no longer holds was deleted anyway (a request stopped mid-way still completes). */
export function reconcile(results, records) {
  const present = new Set(records.map(r => r.Id));
  return results.map(r => !r.ok && !present.has(r.id)
    ? { ...r, ok: true, note: `deleted; the response said ${r.error}` } : r);
}

/**
 * The org-roles.mjs commands that open the org for this run and put the saved
 * state back. None when the org is already a deploy target. An org with no
 * saved role is opened as research and its entry removed afterwards.
 */
export function roleCommands(previous, name, rolesScript) {
  if (previous?.deploy === true) return { locked: false, allow: null, restore: null };
  const base = `node "${rolesScript}"`;
  const branch = previous?.branch ? ` --branch ${previous.branch}` : '';
  return {
    locked: true,
    allow: `${base} set ${name} --role ${previous?.role ?? 'research'} --deploy yes${branch}`,
    restore: previous ? `${base} set ${name} --role ${previous.role} --deploy no${branch}` : `${base} remove ${name}`
  };
}

const skippedLines = skipped => skipped.length
  ? ['', 'SKIPPED (no Active version)', ...skipped.map(s => `${s.name}: ${s.present} versions`)] : [];

export function renderPlan({ count, flows, skipped }) {
  const total = flows.reduce((n, f) => n + f.delete.length, 0);
  const lines = [`COUNT: ${count} oldest non-Active versions per flow`,
                 `AT LIMIT: ${flows.length + skipped.length} flows with ${VERSION_LIMIT} or more versions`];
  if (flows.length) {
    lines.push('', 'Flow | Versions | Active | To delete | Version numbers');
    for (const f of flows) {
      lines.push(`${f.name} | ${f.present} | v${f.activeVersion} | ${f.delete.length} | ${formatRanges(f.delete.map(v => v.version)) || '-'}`);
    }
    lines.push('', `TOTAL: ${total} versions from ${flows.filter(f => f.delete.length).length} flows`);
  }
  return [...lines, ...skippedLines(skipped)].join('\n');
}

export function renderReport({ name, results, dropped, skipped, before, after }) {
  const deleted = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const count = (records, id) => records.filter(r => r.DefinitionId === id).length;
  const lines = [`RESULT: ${deleted.length} deleted, ${failed.length} failed in ${name}`, '', 'Flow | Before | After'];
  for (const [id, flowName] of new Map(results.map(r => [r.definitionId, r.name]))) {
    lines.push(`${flowName} | ${count(before, id)} | ${count(after, id)}`);
  }
  if (failed.length) lines.push('', 'FAILED', ...failed.map(f => `${f.name} v${f.version}: ${f.error}`));
  const noted = deleted.filter(r => r.note);
  if (noted.length) lines.push('', 'DELETED DESPITE AN ERROR RESPONSE', ...noted.map(n => `${n.name} v${n.version}: ${n.note}`));
  if (dropped.length) lines.push('', 'NOT SENT', ...dropped.map(d => `${d.name} v${d.version}: ${d.reason}`));
  return [...lines, ...skippedLines(skipped)].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`
Expected: every line `pass`, then `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/lib/flow-version-cleanup.mjs plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs
git commit -m "@HEAN-1: Add the flow version cleanup selection library"
```

---

### Task 3: `flow-version-cleanup.mjs` plan and apply

**Files:**
- Create: `plugins/hean-harness/scripts/flow-version-cleanup.mjs`
- Modify: `plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs` (replace the line `// COMMAND-LINE TESTS (Task 3) GO HERE`)

**Interfaces:**
- Consumes: everything Task 2 exports; from `scripts/lib/org-roles.mjs`: `connectedOrgs()`, `defaultOrg(root)`, `orgOf(name)`, `projectRoot(dir)`, `readRoles(home)`, `recordHome(root)`, `refusal(root, { name, from: 'flag' })`.
- Produces, for SKILL.md (Task 4):
  - `node flow-version-cleanup.mjs plan [--org <name>] [--count <N>]` prints `ORG: <name> (<username>, org <id>)`, the plan text, then either `ROLE: <name> is a saved deploy target.` or a `!! <name> is locked for writes: …` line plus `ALLOW: <command>` and `RESTORE: <command>`, then `PLAN_FILE: <path>`. Exit 0 plan ready, 2 nothing to delete, 1 error (`ERROR: …`; an ambiguous or unmatched org name says `matches more than one org` / `no org logged in on this machine matches`).
  - `node flow-version-cleanup.mjs apply <plan file>` prints progress on stderr and the `renderReport` text on stdout. Exit 0 all deleted, 3 some failed, 1 error (nothing deleted when it fails before the first batch).

- [ ] **Step 1: Write the failing tests**

Replace `// COMMAND-LINE TESTS (Task 3) GO HERE` with:

```js
console.log('command line');
{
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const CLI = join(SCRIPTS, 'flow-version-cleanup.mjs');
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'flow-cleanup-')));
  const BIN = join(sandbox, 'bin');
  mkdirSync(BIN);
  // The fake sf logs each call and every @body file, then answers from answers.json:
  // { "<first two args>": [answer, …] } consumed in order, the last one repeating.
  // An answer is { stdout, code }; it prints a CLI warning line first.
  writeFileSync(join(BIN, 'sf'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_DIR, args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\\n');
for (const a of args) if (a.startsWith('@')) fs.appendFileSync(path.join(dir, 'bodies.log'), fs.readFileSync(a.slice(1), 'utf8') + '\\n');
const key = args.slice(0, 2).join(' ');
const list = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'))[key] || [];
const nFile = path.join(dir, key.replace(/ /g, '_') + '.n');
const n = fs.existsSync(nFile) ? Number(fs.readFileSync(nFile, 'utf8')) : 0;
fs.writeFileSync(nFile, String(n + 1));
const a = list[Math.min(n, list.length - 1)] || { stdout: '', code: 0 };
process.stdout.write(' ›   Warning: @salesforce/cli update available\\n');
process.stdout.write(typeof a.stdout === 'string' ? a.stdout : JSON.stringify(a.stdout));
process.exit(a.code || 0);
`);
  chmodSync(join(BIN, 'sf'), 0o755);

  const HOME = join(sandbox, 'home');
  const writeJson = (file, json) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(json)); };
  const ORG_ID = '00D000000000002AAA';
  writeJson(join(HOME, '.sfdx', 'me@example.com.qa.json'), { username: 'me@example.com.qa', orgId: ORG_ID, isSandbox: true });
  writeJson(join(HOME, '.sfdx', 'me@example.com.dev.json'), { username: 'me@example.com.dev', orgId: '00D000000000001AAA', isSandbox: true });
  writeJson(join(HOME, '.sfdx', 'alias.json'), { orgs: { qa: 'me@example.com.qa', dev: 'me@example.com.dev' } });

  const query = records => ({ stdout: { status: 0, result: { done: true, totalSize: records.length, records } } });
  const display = { stdout: { status: 0, result: { apiVersion: '64.0' } } };
  const batchOk = n => ({ stdout: { hasErrors: false, results: Array.from({ length: n }, () => ({ statusCode: 204, result: null })) } });

  let counter = 0;
  /** A project with roles, a canned-answer folder, and one run of the script. */
  function run(args, { roles, answers }) {
    const dir = join(sandbox, `s${++counter}`);
    const repo = join(dir, 'repo');
    const fake = join(dir, 'fake');
    mkdirSync(fake, { recursive: true });
    writeJson(join(repo, 'sfdx-project.json'), { packageDirectories: [{ path: 'force-app' }] });
    writeJson(join(repo, '.claude', 'hean-harness.json'), { orgs: roles });
    writeJson(join(fake, 'answers.json'), answers);
    const env = { ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}`, FAKE_DIR: fake };
    delete env.SF_TARGET_ORG;
    const r = spawnSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
    const read = f => existsSync(join(fake, f)) ? readFileSync(join(fake, f), 'utf8').trim().split('\n') : [];
    return { ...r, calls: read('calls.log'), bodies: read('bodies.log'), repo };
  }
  const LOCKED = { [ORG_ID]: { alias: 'qa', username: 'me@example.com.qa', role: 'pipeline', deploy: false, branch: 'integration' } };
  const OPEN = { [ORG_ID]: { alias: 'qa', username: 'me@example.com.qa', role: 'pipeline', deploy: true, branch: 'integration' } };
  const records = [...flow('Full', 50, 50), ...flow('Small', 10, 10)];

  // plan on a locked org
  const p = run(['plan', '--org', 'QA', '--count', '3'], { roles: LOCKED, answers: { 'data query': [query(records)] } });
  check('plan exits 0', p.status === 0, p.stdout + p.stderr);
  check('plan names the org before anything else', p.stdout.startsWith(`ORG: qa (me@example.com.qa, org ${ORG_ID})`));
  check('plan queries the Tooling API on the matched org',
        p.calls[0]?.startsWith('data query --use-tooling-api --json -o me@example.com.qa -q SELECT Id, DefinitionId'));
  check('plan sends nothing', p.calls.length === 1);
  check('plan row', p.stdout.includes('Full | 50 | v50 | 3 | 1-3'));
  check('locked org is announced', p.stdout.includes('!! qa is locked for writes: saved as pipeline, agents do not write.'));
  check('allow and restore commands', p.stdout.includes('set qa --role pipeline --deploy yes --branch integration') &&
                                      p.stdout.includes('set qa --role pipeline --deploy no --branch integration'));
  const planFile = p.stdout.match(/^PLAN_FILE: (.+)$/m)?.[1];
  check('plan file written', planFile && JSON.parse(readFileSync(planFile, 'utf8')).flows[0].delete.length === 3);

  // plan edge cases
  check('bad count refused before any query',
        (r => r.status === 1 && /whole number/.test(r.stdout) && r.calls.length === 0)(run(['plan', '--count', '0'], { roles: LOCKED, answers: {} })));
  check('unknown org refused', run(['plan', '--org', 'nowhere'], { roles: LOCKED, answers: {} }).stdout.includes('no org logged in on this machine matches'));
  check('nothing at the limit exits 2',
        run(['plan', '--org', 'qa'], { roles: OPEN, answers: { 'data query': [query(flow('Small', 10, 10))] } }).status === 2);
  check('partial query refused',
        (r => r.status === 1 && /partial/.test(r.stdout))(run(['plan', '--org', 'qa'],
          { roles: OPEN, answers: { 'data query': [{ stdout: { status: 0, result: { done: false, totalSize: 99, records } } }] } })));

  // apply against a locked org is refused before any request
  const refused = run(['apply', planFile], { roles: LOCKED, answers: {} });
  check('apply on a locked org exits 1 and sends nothing', refused.status === 1 && refused.calls.length === 0, refused.stdout);

  // apply on an open org: one version became Active, one response lost but deleted, one lock error retried
  const fresh = records.map(r => r.Id === '301Full002' ? { ...r, Status: 'Active' } : r);
  const afterIds = new Set(['301Full001', '301Full003']);
  const lockThenOk = [
    { stdout: { hasErrors: true, results: [{ statusCode: 204 }, { statusCode: 400, result: [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'busy' }] }] } },
    batchOk(1)
  ];
  const a = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(fresh), query(fresh.filter(r => !afterIds.has(r.Id)))],
    'api request': lockThenOk
  } });
  check('apply exits 0', a.status === 0, a.stdout + a.stderr);
  check('API version from org display', a.calls.some(c => c.startsWith('api request rest /services/data/v64.0/tooling/composite/batch --method POST --body @')));
  check('version now Active not sent', !a.bodies.join('\n').includes('301Full002') && a.stdout.includes('Full v2: now Active'));
  check('lock error retried alone', a.calls.filter(c => c.startsWith('api request')).length === 2 &&
                                    JSON.parse(a.bodies[1]).batchRequests.length === 1);
  check('report', a.stdout.includes('RESULT: 2 deleted, 0 failed in qa') && a.stdout.includes('Full | 50 | 48'));

  // a lost response: the after-query decides
  const lost = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(records), query(records.filter(r => !['301Full001', '301Full002', '301Full003'].includes(r.Id)))],
    'api request': [{ stdout: '', code: 1 }]
  } });
  check('lost response, versions gone: exit 0 with a note', lost.status === 0 && lost.stdout.includes('DELETED DESPITE AN ERROR RESPONSE'), lost.stdout);

  // a dependency error stays failed
  const dep = run(['apply', planFile], { roles: OPEN, answers: {
    'org display': [display],
    'data query': [query(records), query(records.filter(r => r.Id !== '301Full001' && r.Id !== '301Full002'))],
    'api request': [{ stdout: { hasErrors: true, results: [{ statusCode: 204 }, { statusCode: 204 },
      { statusCode: 400, result: [{ errorCode: 'DEPENDENCY_EXISTS', message: 'referenced in a flow interview' }] }] } }]
  } });
  check('dependency error exits 3 and is listed', dep.status === 3 && dep.stdout.includes('Full v3: DEPENDENCY_EXISTS: referenced in a flow interview'));

  rmSync(sandbox, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`
Expected: library checks pass; command-line checks FAIL (`Cannot find module …/flow-version-cleanup.mjs` in the child's stderr); exit 1.

- [ ] **Step 3: Implement the script**

Create `plugins/hean-harness/scripts/flow-version-cleanup.mjs`:

```js
#!/usr/bin/env node
/**
 * Deletes the oldest non-Active versions of every flow at the platform's
 * 50-version limit, through the Tooling API from the Salesforce CLI.
 *
 *   flow-version-cleanup.mjs plan [--org <alias|username|sandbox name>] [--count <N>]
 *   flow-version-cleanup.mjs apply <plan file>
 *
 * plan only reads. apply refuses unless the org is a saved deploy target,
 * because the org write gate never sees the sf calls this script makes.
 * No Apex and no metadata deploy: Apex reaches the Tooling API only through
 * an HTTP callout, which needs a Remote Site Setting or Named Credential.
 *
 * Exit codes: 0 done; 1 could not run; 2 nothing to delete (plan);
 * 3 some versions failed (apply).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectedOrgs, defaultOrg, orgOf, projectRoot, readRoles, recordHome, refusal } from './lib/org-roles.mjs';
import { EXIT, FLOW_QUERY, buildBatches, checkComplete, isLockError, matchOrg, parseBatchResponse, parseCount,
         reconcile, renderPlan, renderReport, roleCommands, selectVersions, stillDeletable } from './lib/flow-version-cleanup.mjs';

const ROLES_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'org-roles.mjs');
const USAGE = 'Usage: flow-version-cleanup.mjs plan [--org <name>] [--count <N>]\n' +
              '       flow-version-cleanup.mjs apply <plan file>';
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const fail = reason => { console.log(`ERROR: ${reason}`); process.exit(EXIT.ERROR); };

/** Runs sf; the JSON is read from the first `{` of stdout, since the CLI can print a warning first. */
function sf(args) {
  const r = spawnSync('sf', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000 });
  const stdout = r.stdout ?? '';
  let json = null;
  const start = stdout.indexOf('{');
  if (start >= 0) { try { json = JSON.parse(stdout.slice(start)); } catch { /* the caller reports */ } }
  return { json, stdout, stderr: (r.stderr ?? '').trim() || r.error?.message || '', status: r.status };
}

function queryFlows(username) {
  const r = sf(['data', 'query', '--use-tooling-api', '--json', '-o', username, '-q', FLOW_QUERY]);
  if (r.json?.status !== 0) fail(`the flow query failed: ${r.json?.message || r.stderr || 'no output'}`);
  try { checkComplete(r.json.result); } catch (e) { fail(e.message); }
  return r.json.result.records;
}

function sfdxRoot() {
  const root = projectRoot(process.cwd());
  if (!root) fail('run this from inside an SFDX project, where the org roles are saved');
  return root;
}

function resolveOrg(root) {
  const name = opt('--org');
  if (name) {
    const found = matchOrg(name, connectedOrgs());
    if (!found.length) fail(`no org logged in on this machine matches "${name}"`);
    if (found.length > 1) {
      fail(`"${name}" matches more than one org: ${found.map(o => `${o.aliases[0] ?? o.username} (${o.username})`).join(', ')}`);
    }
    return { ...found[0], name: found[0].aliases[0] ?? found[0].username };
  }
  const d = defaultOrg(root);
  if (!d) fail('no org was given and no CLI default org is set');
  const org = orgOf(d.name);
  if (!org) fail(`the CLI default org ${d.name} is not logged in on this machine`);
  return { ...org, name: d.name };
}

function plan() {
  const root = sfdxRoot();
  let count;
  try { count = parseCount(opt('--count')); } catch (e) { fail(e.message); }
  const org = resolveOrg(root);
  console.log(`ORG: ${org.name} (${org.username}, org ${org.orgId})`);
  const { flows, skipped } = selectVersions(queryFlows(org.username), count);
  console.log(renderPlan({ count, flows, skipped }));

  const saved = readRoles(recordHome(root))[org.orgId] ?? null;
  const roles = roleCommands(saved, saved?.alias ?? saved?.username ?? org.name, ROLES_SCRIPT);
  if (roles.locked) {
    console.log(`!! ${org.name} is locked for writes: ${saved ? `saved as ${saved.role}, agents do not write` : 'no saved role'}.`);
    console.log(`ALLOW: ${roles.allow}`);
    console.log(`RESTORE: ${roles.restore}`);
  } else {
    console.log(`ROLE: ${org.name} is a saved deploy target.`);
  }

  if (!flows.some(f => f.delete.length)) { console.log('RESULT: nothing to delete'); process.exit(EXIT.NOTHING); }
  const file = join(mkdtempSync(join(tmpdir(), 'flow-version-cleanup-')), 'plan.json');
  writeFileSync(file, JSON.stringify({ org: { name: org.name, username: org.username, orgId: org.orgId }, count, flows, skipped }, null, 2));
  console.log(`PLAN_FILE: ${file}`);
  process.exit(EXIT.OK);
}

function apply() {
  const file = argv[1];
  if (!file) fail(USAGE);
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { fail(`cannot read the plan file ${file}`); }
  const root = sfdxRoot();
  const { name, username } = saved.org;
  const refused = refusal(root, { name: username, from: 'flag' });
  if (refused) fail(`${name} is not a deploy target, so nothing was deleted.\n${refused}`);

  const display = sf(['org', 'display', '--json', '-o', username]);
  const api = display.json?.result?.apiVersion;
  if (!api) fail(`cannot read the API version of ${name}: ${display.json?.message || display.stderr || 'no output'}`);

  const before = queryFlows(username);
  const planned = saved.flows.flatMap(f => f.delete.map(v => ({ ...v, name: f.name, definitionId: f.definitionId })));
  const { keep, dropped } = stillDeletable(planned, before);

  const dir = mkdtempSync(join(tmpdir(), 'flow-version-cleanup-batches-'));
  let sent = 0;
  // One request at a time: two requests deleting versions of the same flow at once fail with UNABLE_TO_LOCK_ROW.
  const send = versions => buildBatches(versions, api).flatMap(batch => {
    const body = join(dir, `batch-${String(++sent).padStart(3, '0')}.json`);
    writeFileSync(body, JSON.stringify(batch.body));
    console.error(`batch ${sent}: deleting ${batch.versions.length} versions`);
    const r = sf(['api', 'request', 'rest', `/services/data/v${api}/tooling/composite/batch`,
                  '--method', 'POST', '--body', `@${body}`, '-o', username]);
    return parseBatchResponse(batch.versions, r.stdout, r.stderr);
  });

  let results = send(keep);
  const locked = results.filter(r => !r.ok && isLockError(r.error));
  if (locked.length) {
    console.error(`retrying ${locked.length} versions that were locked`);
    const retried = new Map(send(locked.map(({ ok, error, ...v }) => v)).map(r => [r.id, r]));
    results = results.map(r => retried.get(r.id) ?? r);
  }

  const after = queryFlows(username);
  results = reconcile(results, after);
  console.log(renderReport({ name, results, dropped, skipped: saved.skipped, before, after }));
  process.exit(results.some(r => !r.ok) ? EXIT.FAILED : EXIT.OK);
}

if (argv[0] === 'plan') plan();
else if (argv[0] === 'apply') apply();
else fail(USAGE);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`
Expected: every line `pass`, `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/scripts/flow-version-cleanup.mjs plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs
git commit -m "@HEAN-1: Add the flow version cleanup plan and apply script"
```

---

### Task 4: `/hean-harness:flow-version-cleanup` skill and wiki coverage row

**Files:**
- Create: `plugins/hean-harness/skills/flow-version-cleanup/SKILL.md`
- Modify: `docs/wiki-coverage.md` (Skills table, add one row after `| flow-trigger-order | Skills | documented |`)

**Interfaces:**
- Consumes: the `plan` / `apply` output contract from Task 3; `scripts/org-roles.mjs status`.
- Produces: the skill.

- [ ] **Step 1: Write SKILL.md**

Create `plugins/hean-harness/skills/flow-version-cleanup/SKILL.md` (no `---` line after the frontmatter; file ends with exactly one newline):

````markdown
---
name: flow-version-cleanup
description: Flow version limit cleanup for one Salesforce org — finds every flow at the 50-version limit and deletes its oldest non-Active versions through Tooling API batch requests from the Salesforce CLI, with one confirmation and a temporary write permission that is always reset, never Apex or a metadata deploy
argument-hint: "[org alias or username] [--count <N, default 5>]"
---

# Flow version cleanup

A flow holds at most 50 versions (Salesforce Help, "General Flow Limits"). At the limit, saving or
deploying the flow fails. This skill finds every flow at the limit in one org and deletes its oldest
non-Active versions.

## Why no Apex

Apex has no statement that deletes a flow version. Only the Tooling API does, and Apex reaches the
Tooling API only through an HTTP callout, which needs a Remote Site Setting or Named Credential
deployed to the org. The Salesforce CLI calls the Tooling API directly and needs nothing deployed.

- Never write or run Apex for this: no `sf apex run`, no script file.
- Never deploy metadata for this: no Remote Site Setting, Named Credential, External Credential or
  Connected App.
- Never delete `FlowInterview` records to unlock a version.
- Never change the org's saved role except through steps 4 and 6.

## Task list

Create one task per step below, steps 1 to 7, before step 1. Mark each `in_progress` when it starts
and `completed` when it ends.

## Steps

Run every command from the SFDX project root. `S` below is `${CLAUDE_PLUGIN_ROOT}/scripts`.

1. **Arguments.** Take the org from the first argument, from `-o <alias>`, or from the user's words
   ("in qa", "the UAT sandbox"). Take `--count <N>` when given. Never ask which flows: the script
   finds them.

2. **Plan (read-only).** Run, leaving out `--org` when no org was named and `--count` when no count
   was given:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-version-cleanup.mjs" plan --org <org> --count <N>
   ```

   - **Exit 1 with "matches more than one org" or "no org logged in on this machine matches":** run
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" status`, ask the user which org in one
     `AskUserQuestion` call listing the logged-in orgs, then run step 2 again with that alias.
   - **Any other exit 1:** report the `ERROR:` line and stop.
   - **Exit 2:** report that no flow is at the 50-version limit (or that every one was skipped,
     with the SKIPPED list) and stop.
   - **Exit 0:** show the user the `ORG:` line, the plan table, the totals and the SKIPPED list as
     printed. Relay every line starting with `!!` word for word. Keep the `ALLOW:`, `RESTORE:` and
     `PLAN_FILE:` values for later steps.

3. **One confirmation.** Ask one `AskUserQuestion` question naming the org alias, the count, the
   number of versions and the number of flows.
   - Org printed `ROLE: … saved deploy target`: options "Delete" and "Cancel".
   - Org printed `!! … locked for writes`: options "Allow writes for this run, delete, then reset
     the role" and "Cancel".
   - "Cancel": stop. Nothing was written.

4. **Temporary permission.** Only when the org was locked: run the `ALLOW:` command exactly as
   printed. From here on, step 6 runs whatever happens.

5. **Delete.** Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-version-cleanup.mjs" apply "<PLAN_FILE>"
   ```

   Each batch of 25 versions takes about 30 seconds. Use a 600000 ms timeout; when the plan's total
   is above 400 versions, run it in the background and wait for it to finish. Keep its output and
   exit code: 0 all deleted, 3 some failed, 1 could not run (nothing deleted when it stops before
   the first batch).

6. **Reset.** Only when step 4 ran, and after every outcome of step 5 — exit 0, 1 or 3, an
   interrupted run, or a timeout: run the `RESTORE:` command exactly as printed, then
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/org-roles.mjs" status`. When the reset fails, print
   `!! The role of <alias> was not restored. Run: <RESTORE command>` and tell the user.

7. **Report.** Show the `RESULT:` line, the Before | After table, and each list the script printed:
   FAILED, DELETED DESPITE AN ERROR RESPONSE, NOT SENT, SKIPPED. Group the failures by error code
   and say what each needs:
   - `DEPENDENCY_EXISTS` naming a flow interview: a paused or failed interview still uses that
     version; it can be deleted after the interview finishes or is removed by its owner.
   - `DEPENDENCY_EXISTS` naming a branding set or Survey Version: a survey still references it.
   - `UNABLE_TO_LOCK_ROW` after the retry: run the skill again later.
   - `FIELD_INTEGRITY_EXCEPTION` "Unable to load specified entity": check the Before | After counts;
     the version may already be gone.
   Say whether the role was reset, from the `status` output.
````

- [ ] **Step 2: Add the wiki coverage row**

In `docs/wiki-coverage.md`, after the line `| flow-trigger-order | Skills | documented |`, add the row with the status the user chose at plan review (`pending` when the user deferred the decision):

```markdown
| flow-version-cleanup | — | pending |
```

- [ ] **Step 3: Check the skill text**

Run: `grep -c '^---$' plugins/hean-harness/skills/flow-version-cleanup/SKILL.md`
Expected: `2` (frontmatter only).

Run: `tail -c 1 plugins/hean-harness/skills/flow-version-cleanup/SKILL.md | od -c | head -1`
Expected: the last byte is `\n`, and the line before it is not empty.

Run: `grep -n -i -E 'rews|field-service|sharedqa' plugins/hean-harness/skills/flow-version-cleanup/SKILL.md plugins/hean-harness/scripts/flow-version-cleanup.mjs plugins/hean-harness/scripts/lib/flow-version-cleanup.mjs plugins/hean-harness/scripts/__tests__/flow-version-cleanup.test.mjs`
Expected: no output.

- [ ] **Step 4: Run the full test loop**

Run (in the background or with a timeout above 600000 ms; never two loops at once):
`for t in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do node "$t" || echo "FAILED: $t"; done`
Expected: no `FAILED:` line. Never commit `assets/rules/user/zz-test-dropped-rule.md`.

- [ ] **Step 5: Commit**

```bash
git add plugins/hean-harness/skills/flow-version-cleanup/SKILL.md docs/wiki-coverage.md
git commit -m "@HEAN-1: Add the flow version cleanup skill"
```
