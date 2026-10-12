# Runbook Stage Guardrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runbook or destructive-changes file placed in a stage folder whose step the repository's `deploy.yml` does not list is warned about when written, refused when committed, and handled the same way by the PR and deprecate-flow skills.

**Architecture:** A new library, `scripts/lib/deploy-steps.mjs`, parses `deploy.yml` without a YAML dependency and maps each path to the step it needs. A new PreToolUse Bash hook, `hooks/runbook-stage-gate.mjs`, works out what a `git commit` records with a helper taken out of the per-story manifest check (`scripts/lib/commit-index.mjs`). It refuses a commit when a required step is missing. The existing `hooks/runbook-compile-check.mjs` calls the same library after every Write and Edit, and skips the compile for a script whose stage runs no anonymous Apex. The rule and three skills read `deploy.yml` before they derive rows or write files.

**Tech Stack:** Node (built-ins only), git, the plugin's own `scripts/lib/*`.

**Spec:** `docs/superpowers/specs/2026-10-08-runbook-stage-guardrail.md`

## Global Constraints

- Plugin root: `plugins/hean-harness/`. Every path below starts at the repository root.
- Use only Node built-ins and the plugin's own `scripts/lib/*`. Add no dependencies and no YAML parser.
- Reuse helpers; never copy them. `stagingOf`/`stagesInteractively` (`scripts/lib/staging.mjs`), `gitCommands`/`repoOf`/`git`/`tryGit` (`scripts/lib/command-line.mjs`). The commit-index builder and the walk over a command's commits move from `hooks/manifest-commit-check.mjs` to `scripts/lib/commit-index.mjs` (Task 2), because two hooks need them.
- Comment style matches `hooks/runbook-compile-check.mjs` and `scripts/lib/manifest-check.mjs`: a header comment that says why, a one-line `/** … */` on each exported function, and no narration.
- The new commit hook's `timeout` in `hooks/hooks.json` is `10`. It calls no `sf`.
- The checks fail open. With no `deploy.yml` they allow silently. When `deploy.yml` cannot be read, the staging cannot be named, or the index cannot be built, they allow with a line that starts with `!! `.
- Do not bump the plugin version (`plugins/hean-harness/.claude-plugin/plugin.json`, `package.json`).
- Never run plugin code in `/Users/d.min/git-repos/REWS-Workplace-Services/*` and never write there. The fixtures in Task 1 are already copied from those repositories (`git show origin/integration:deploy.yml`, 2026-10-08).
- Tests use temporary git repositories, a temporary `HOME` and `CLAUDE_CONFIG_DIR`, and delete `CLAUDE_CODE_CHILD_SESSION` from the child environment. Create Node scratch folders with `mkdtempSync`, which throws on failure. In shell, use `T=$(mktemp -d) || exit 1` and check `[ -d "$T" ]` before using it. Never `rm -rf` a variable you have not checked.
- Commit subject: `@HEAN-1: <Capitalised imperative summary>`. The summary is at most 10 words and the whole subject at most 77 characters. Add no trailers of any kind (no `Co-Authored-By`, no `Claude-Session`). Stage by explicit path. Commit only when the session's saved commit preference allows it. Under `No commits` the commit approval gate refuses, and you skip the step.
- Full test loop, run at the end of every task, one file at a time, with no two loops running at once. Each test sets up its own isolation, so the loop unsets `CLAUDE_CONFIG_DIR` (`setup-twice.test.mjs` fails when an outer one is set) and uses a scratch `HOME`:
  ```bash
  T=$(mktemp -d) || exit 1; [ -d "$T" ] || exit 1; mkdir "$T/home"
  for f in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do echo "== $f"; env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CONFIG_DIR HOME="$T/home" node "$f" || echo "FAILED: $f"; done
  [ -n "$T" ] && [ -d "$T" ] && rm -rf "$T"
  ```
  Expected: no `FAILED:` line. `setup-twice.test.mjs` takes several minutes. At `e8b9376` every file passes this loop.

## Review Focus

- **Placeholder files that a client repository already keeps in a stage with no step for them.** Corrigo keeps `runbooks/post-deploy/apex/00_postdeployApexScript.apex`, `runbooks/post-deploy/metaData/classes/REWS_Deployment.cls`, the `version`-only `commands.txt` files and the `REWS_Deployment` member of `destructiveChangesPost.xml`. Expected: a commit that leaves them untouched, deletes them, or removes a member is never refused. Test: Task 3, "corrigo shape: allowed".
- **Staged content that differs from the working tree.** The gate judges what the commit records, not what is on disk. Test: Task 3, "the staged content is checked, not the working tree" and "an unstaged change is not part of the commit".
- **A commit that finishes a merge, cherry-pick, revert or rebase.** It records work taken from elsewhere, and the gate must not block it. This uses the same rule as the manifest check. Test: Task 3, "a merge in progress is not checked".
- **The first commit of a new repository (no HEAD).** The index diff and the HEAD comparison must still work. Test: Task 3, "a first commit is checked".
- **An unreadable `deploy.yml` in a repository whose commits mostly touch no runbook file.** The `!!` line appears only when the commit or write touches a stage-folder path, so the line does not appear on every commit. Test: Task 3, "Unreadable deploy.yml". Task 4, "an unreadable deploy.yml".

## Decisions the code forced (deviations from the spec's wording)

- **`requiredStep(path, repoRoot)` returns a superset**: `{ stage, kind, key, value, compare }`. `kind` (`metadata|apex|commands|destruct`) drives `stepPresent`. `compare` (`'commands'|'members'|null`) tells callers when the content must be compared with HEAD. `repoRoot` is needed only for an absolute `path`.
- **The spec's "unknown" is two results**: `readDeploySteps(root)` returns `{ missing: true }` (callers stay silent) or `{ error }` (callers add a `!!` line). A file that names no stage counts as unreadable, so an empty `deploy.yml` never refuses everything.
- **Shared commit helper.** `scripts/lib/commit-index.mjs` holds `commitsIn` (the walk over a command's `git add`/`git commit` calls) and `commitIndex` (the temporary index). Both hooks import it. `manifest-check.mjs` exports `operationInProgress` for the gate. `scripts/install-manifest-check.mjs`'s copy list does not change, because the git pre-commit path never imports `commit-index.mjs`.
- **The gate skips a commit during a merge, cherry-pick, revert or rebase**, using the manifest check's own list. The spec does not mention this. Without it, a resolved merge of another developer's work is refused.
- **An unreadable `deploy.yml` produces a `!!` line only when the commit records a stage-folder path.** This keeps the spec's fail-open rule without adding a warning to every commit.
- **The compile check's commit gate and `--check` also skip a script whose stage runs no anonymous Apex.** The spec says only that the write does not compile such a script. Without the skip, no pass is ever recorded, and the compile gate gives a second, misleading refusal ("has not compiled") next to the stage gate's refusal.
- **`.keep` is excluded only under `metaData/`**, as the spec says. A `commands.txt` line counts as a comment when it starts with `#`. The spec says "a comment" without naming the marker.
- **deprecate-flow also checks `pre.metadata[].sourceFolder`**, because Phases 5 and 7 write under `runbooks/pre-deploy/metaData/`. With no `deploy.yml`, the skill says so at the Phase 4 gate and continues, which matches the hooks' fail-open rule.

## File Structure

- `plugins/hean-harness/scripts/lib/deploy-steps.mjs` (new): parses `deploy.yml`, maps a path to its step, checks whether the step is present, compares content, and builds the message line.
- `plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/{field-service,base,corrigo}.yml` (new): the three verified shapes.
- `plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs` (new).
- `plugins/hean-harness/scripts/lib/commit-index.mjs` (new): `commitsIn`, `commitIndex`, moved from `hooks/manifest-commit-check.mjs`.
- `plugins/hean-harness/hooks/manifest-commit-check.mjs`: uses `commit-index.mjs`.
- `plugins/hean-harness/scripts/lib/manifest-check.mjs`: exports `operationInProgress`.
- `plugins/hean-harness/scripts/lib/staging.mjs`: the header names its users.
- `plugins/hean-harness/hooks/runbook-stage-gate.mjs` (new), `plugins/hean-harness/hooks/hooks.json`, `plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs` (new).
- `plugins/hean-harness/hooks/runbook-compile-check.mjs`, `plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs`.
- `plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md`, `plugins/hean-harness/skills/create-pr/SKILL.md`, `plugins/hean-harness/skills/update-pr/SKILL.md`, `plugins/hean-harness/skills/deprecate-flow/SKILL.md`.

---

### Task 1: `deploy-steps.mjs` and its fixtures

**Files:**
- Create: `plugins/hean-harness/scripts/lib/deploy-steps.mjs`
- Create: `plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/field-service.yml`, `base.yml`, `corrigo.yml`
- Test: `plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `scripts/lib/deploy-steps.mjs`):
  - `DEPLOY_YML = 'deploy.yml'`, `COMMAND_KEYS = ['runSFCommandFromFile', 'runSFDXCommandFromFile']`
  - `parseDeploySteps(text: string) → { [stage: string]: { [key: string]: string | Array<{[k: string]: string}> } }`. Throws `Error` whose message names `line N` or `it names no stage`.
  - `readDeploySteps(root: string) → { steps } | { missing: true } | { error: string }`. `error` starts with `deploy.yml could not be read (`.
  - `stepFor(stage: 'pre'|'post', kind: 'metadata'|'apex'|'commands'|'destruct') → { stage, kind, key: string, value: string }`. `key` is the backticked `deploy.yml` key text, such as `` `post.metadata[].sourceFolder` ``, or for commands `` `post.runSFCommandFromFile` or `post.runSFDXCommandFromFile` ``.
  - `requiredStep(path: string, repoRoot?: string) → { stage, kind, key, value, compare: 'commands'|'members'|null } | null`
  - `stepPresent(steps, req) → boolean`
  - `commandLines(text) → string[]`, `addsCommand(next: string|null, old: string|null) → boolean`
  - `memberPairs(xml) → Set<string>` (`Type:member`), `addedMembers(next, old) → string[]`
  - `missingStepLine(rel, req, steps) → string`
  - `missingStep(rel: string, steps, { content: rel => string|null, head: rel => string|null }) → string | null`

- [ ] **Step 1: Add the fixtures**

These are the `origin/integration` contents of the client repositories' `deploy.yml`, byte for byte, each ending in one newline.

`plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/field-service.yml`:

```yaml
pre:
  metadata:
    - sourceFolder: ./runbooks/pre-deploy/metaData/
  runAnonymousScriptFromDir: "runbooks/pre-deploy/apex"
  runSFCommandFromFile: "runbooks/pre-deploy/sf/commands.txt"
  metadata-destruct:
    - destructiveChangesXml: deletePackage/pre/destructiveChangesPre.xml
      packageXml: deletePackage/pre/package.xml

deploy:
  sourceFormat: sfdx
  type: tag
  format: custom

post:
  metadata:
    - sourceFolder: ./runbooks/post-deploy/metaData/
  runAnonymousScriptFromDir: "runbooks/post-deploy/apex"
  runSFCommandFromFile: "runbooks/post-deploy/sf/commands.txt"
  metadata-destruct:
    - destructiveChangesXml: deletePackage/post/destructiveChangesPost.xml
      packageXml: deletePackage/post/package.xml
```

`plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/base.yml`:

```yaml
pre:
  metadata:
    - sourceFolder: ./runbooks/pre-deploy/metaData/
  runAnonymousScriptFromDir: "runbooks/pre-deploy/apex"
  runSFDXCommandFromFile: "runbooks/pre-deploy/sf/commands.txt"
  metadata-destruct:
    - destructiveChangesXml: deletePackage/pre/destructiveChangesPre.xml
      packageXml: deletePackage/pre/package.xml

deploy:
  sourceFormat: sfdx
  type: tag
  format: custom

post:
  metadata:
    - sourceFolder: ./runbooks/post-deploy/metaData/
  runAnonymousScriptFromDir: "runbooks/post-deploy/apex"
  runSFDXCommandFromFile: "runbooks/post-deploy/sf/commands.txt"
  metadata-destruct:
    - destructiveChangesXml: deletePackage/post/destructiveChangesPost.xml
      packageXml: deletePackage/post/package.xml
```

`plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/corrigo.yml`:

```yaml
pre:
  metadata:
    - sourceFolder: ./runbooks/pre-deploy/metaData/
  runAnonymousScriptFromDir: "runbooks/pre-deploy/apex"
  runSFDXCommandFromFile: "runbooks/pre-deploy/sf/commands.txt"

deploy:
  sourceFormat: sfdx
  type: tag
  format: custom

post:
  runSFDXCommandFromFile: "runbooks/post-deploy/sf/commands.txt"
```

- [ ] **Step 2: Write the failing test**

`plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs`:

```js
#!/usr/bin/env node
/**
 * How deploy-steps.mjs reads deploy.yml and which step each runbook path
 * needs, for the three deploy.yml shapes the client repositories use.
 *
 * The fixtures are those repositories' deploy.yml files as their integration
 * branches held them on 2026-10-08. Only a throwaway folder is written.
 *
 * Run: node scripts/__tests__/deploy-steps.test.mjs
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const {
  parseDeploySteps, readDeploySteps, requiredStep, stepPresent, missingStep, addsCommand, addedMembers
} = await import(join(dirname(TESTS), 'lib', 'deploy-steps.mjs'));
const fixture = name => readFileSync(join(TESTS, 'fixtures', 'deploy-yml', `${name}.yml`), 'utf8');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-steps-')));

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);

const xml = (...types) => '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  types.map(([t, ms]) => `    <types>\n${ms.map(m => `        <members>${m}</members>\n`).join('')}        <name>${t}</name>\n    </types>\n`).join('') +
  '    <version>63.0</version>\n</Package>\n';

console.log('Parser');
const fs = parseDeploySteps(fixture('field-service'));
check('field-service: the pre metadata folder', fs.pre.metadata?.[0]?.sourceFolder === './runbooks/pre-deploy/metaData/', JSON.stringify(fs.pre));
check('field-service: quotes are removed', fs.pre.runSFCommandFromFile === 'runbooks/pre-deploy/sf/commands.txt');
check('field-service: a list item keeps its continuation key', fs.post['metadata-destruct']?.[0]?.packageXml === 'deletePackage/post/package.xml');
check('field-service: the deploy block is read', fs.deploy?.sourceFormat === 'sfdx');
const base = parseDeploySteps(fixture('base'));
check('base: the SFDX commands key', base.post.runSFDXCommandFromFile === 'runbooks/post-deploy/sf/commands.txt' && base.post.runSFCommandFromFile === undefined);
const corrigo = parseDeploySteps(fixture('corrigo'));
check('corrigo: post holds only the commands file',
  JSON.stringify(corrigo.post) === JSON.stringify({ runSFDXCommandFromFile: 'runbooks/post-deploy/sf/commands.txt' }), JSON.stringify(corrigo.post));
check('corrigo: pre has no metadata-destruct', corrigo.pre['metadata-destruct'] === undefined);
check('CRLF line endings read the same', JSON.stringify(parseDeploySteps(fixture('field-service').replace(/\n/g, '\r\n'))) === JSON.stringify(fs));
const commented = parseDeploySteps([
  '# pipeline steps',
  'pre:',
  '  # the metadata step',
  '  metadata: # list',
  "    - sourceFolder: 'runbooks/pre-deploy/metaData' # no ./ or trailing /",
  '',
  '  runAnonymousScriptFromDir: ./runbooks/pre-deploy/apex/',
  '  runSFDXCommandFromFile: "runbooks/pre-deploy/sf/commands.txt" # quoted, then a comment',
  '  note: "a #b"',
  'post:',
  ''
].join('\n'));
check('comment lines, blank lines and trailing comments are ignored',
  commented.pre.metadata?.[0]?.sourceFolder === 'runbooks/pre-deploy/metaData' && commented.pre.runAnonymousScriptFromDir === './runbooks/pre-deploy/apex/',
  JSON.stringify(commented));
check('a quoted value keeps its # and drops a trailing comment',
  commented.pre.note === 'a #b' && commented.pre.runSFDXCommandFromFile === 'runbooks/pre-deploy/sf/commands.txt', JSON.stringify(commented.pre));
check('an empty stage is an empty object', JSON.stringify(commented.post) === '{}');
for (const [label, text, part] of [
  ['a tab-indented line', 'pre:\n\tmetadata:\n', 'line 2'],
  ['a three-space indent', 'pre:\n   runAnonymousScriptFromDir: x\n', 'line 2'],
  ['a list item under no key', 'pre:\n    - sourceFolder: x\n', 'line 2'],
  ['a list item under a scalar key', 'pre:\n  runAnonymousScriptFromDir: x\n    - sourceFolder: y\n', 'line 3'],
  ['a value on a stage line', 'pre: x\n', 'line 1'],
  ['a file that names no stage', '# only a comment\n', 'names no stage']
]) {
  let error = null;
  try { parseDeploySteps(text); } catch (e) { error = e.message; }
  has(`${label} cannot be parsed`, error, part);
}

console.log('Reading the file');
const repo = join(sandbox, 'repo');
mkdirSync(repo);
check('no deploy.yml is missing', readDeploySteps(repo).missing === true);
writeFileSync(join(repo, 'deploy.yml'), 'pre:\n\tmetadata:\n');
has('an unparsable deploy.yml is an error', readDeploySteps(repo).error, 'deploy.yml could not be read', 'line 2');
writeFileSync(join(repo, 'deploy.yml'), fixture('corrigo'));
check('a readable deploy.yml gives its steps', readDeploySteps(repo).steps?.post?.runSFDXCommandFromFile === 'runbooks/post-deploy/sf/commands.txt');
rmSync(join(repo, 'deploy.yml'));
mkdirSync(join(repo, 'deploy.yml'));
has('a deploy.yml that is a folder is an error', readDeploySteps(repo).error, 'deploy.yml could not be read');

console.log('Path to step');
check('a metaData file needs the metadata step',
  JSON.stringify(requiredStep('runbooks/post-deploy/metaData/flowDefinitions/F.flowDefinition-meta.xml')) ===
  JSON.stringify({ stage: 'post', kind: 'metadata', key: '`post.metadata[].sourceFolder`', value: 'runbooks/post-deploy/metaData', compare: null }),
  JSON.stringify(requiredStep('runbooks/post-deploy/metaData/flowDefinitions/F.flowDefinition-meta.xml')));
check('.keep needs no step', requiredStep('runbooks/post-deploy/metaData/.keep') === null && requiredStep('runbooks/pre-deploy/metaData/classes/.keep') === null);
check('a top-level .apex needs the apex step',
  requiredStep('runbooks/pre-deploy/apex/01_x.apex')?.kind === 'apex' && requiredStep('runbooks/pre-deploy/apex/01_x.apex')?.value === 'runbooks/pre-deploy/apex');
check('a non-.apex file or a nested .apex under apex/ needs no step',
  requiredStep('runbooks/pre-deploy/apex/readme.txt') === null && requiredStep('runbooks/pre-deploy/apex/old/01_x.apex') === null);
check('commands.txt needs the commands step, compared line by line',
  requiredStep('runbooks/post-deploy/sf/commands.txt')?.kind === 'commands' && requiredStep('runbooks/post-deploy/sf/commands.txt')?.compare === 'commands');
check('another file under sf/ needs the commands step outright',
  requiredStep('runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex')?.kind === 'commands' &&
  requiredStep('runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex')?.compare === null);
check('a destructive manifest needs the destruct step, compared member by member',
  requiredStep('deletePackage/post/destructiveChangesPost.xml')?.kind === 'destruct' && requiredStep('deletePackage/post/destructiveChangesPost.xml')?.compare === 'members');
check('a mismatched or other deletePackage file needs no step',
  requiredStep('deletePackage/pre/destructiveChangesPost.xml') === null && requiredStep('deletePackage/pre/package.xml') === null);
check('paths outside the stage folders need no step',
  ['runbooks/pre-deploy/sh/00_x.sh', 'force-app/main/default/flows/F.flow-meta.xml', 'deploy.yml'].every(p => requiredStep(p) === null));
check('an absolute path is read against the repository root',
  requiredStep(join(repo, 'runbooks/pre-deploy/apex/01_x.apex'), repo)?.value === 'runbooks/pre-deploy/apex');

console.log('Steps per shape');
const PATHS = {
  preMeta: 'runbooks/pre-deploy/metaData/classes/A.cls', preApex: 'runbooks/pre-deploy/apex/01_x.apex',
  preCmd: 'runbooks/pre-deploy/sf/commands.txt', preDestruct: 'deletePackage/pre/destructiveChangesPre.xml',
  postMeta: 'runbooks/post-deploy/metaData/classes/A.cls', postApex: 'runbooks/post-deploy/apex/01_x.apex',
  postCmd: 'runbooks/post-deploy/sf/commands.txt', postDestruct: 'deletePackage/post/destructiveChangesPost.xml'
};
const ALL = Object.fromEntries(Object.keys(PATHS).map(k => [k, true]));
const EXPECTED = {
  'field-service': ALL,
  base: ALL,
  corrigo: { preMeta: true, preApex: true, preCmd: true, preDestruct: false, postMeta: false, postApex: false, postCmd: true, postDestruct: false }
};
for (const [shape, want] of Object.entries(EXPECTED)) {
  const steps = parseDeploySteps(fixture(shape));
  for (const [name, path] of Object.entries(PATHS)) {
    check(`${shape}: ${name} ${want[name] ? 'runs' : 'does not run'}`, stepPresent(steps, requiredStep(path)) === want[name]);
  }
}
const loose = parseDeploySteps([
  'post:',
  '  metadata:',
  '    - sourceFolder: "runbooks/post-deploy/metaData"',
  "  runAnonymousScriptFromDir: './runbooks/post-deploy/apex/'",
  '  runSFCommandFromFile: ./runbooks/post-deploy/sf/commands.txt',
  '  metadata-destruct:',
  '    - destructiveChangesXml: ./deletePackage/post/destructiveChangesPost.xml'
].join('\n'));
check('./ and a trailing / are ignored', ['postMeta', 'postApex', 'postCmd', 'postDestruct'].every(n => stepPresent(loose, requiredStep(PATHS[n]))));
check('a sourceFolder naming another folder does not count',
  !stepPresent(parseDeploySteps('post:\n  metadata:\n    - sourceFolder: ./runbooks/post-deploy/other/\n'), requiredStep(PATHS.postMeta)));

console.log('Content compared with HEAD');
check('the version placeholder, blank lines and comments add no command', !addsCommand('version\n\n# later\n', null));
check('a real line adds a command', addsCommand('version\napex run --file ./runbooks/post-deploy/sf/01_x.apex\n', 'version'));
check('a line HEAD already has adds nothing', !addsCommand('apex run --file a\r\n', 'apex run --file a\n'));
check('a new member is added', JSON.stringify(addedMembers(xml(['ApexClass', ['A', 'B']]), xml(['ApexClass', ['A']]))) === '["ApexClass:B"]');
check('the same name under another type is added', addedMembers(xml(['Flow', ['A']]), xml(['ApexClass', ['A']])).length === 1);
check('a removed or reordered member adds nothing', addedMembers(xml(['ApexClass', ['B']]), xml(['ApexClass', ['A', 'B']])).length === 0);
check('every member of a file HEAD lacks is added', addedMembers(xml(['ApexClass', ['A']]), null).length === 1);
check('a placeholder manifest adds nothing', addedMembers(xml(), null).length === 0);

console.log('Missing-step lines');
const steps = parseDeploySteps(fixture('corrigo'));
const none = { content: () => null, head: () => null };
has('a post metaData file names the key and the stage that runs it', missingStep(PATHS.postMeta, steps, none),
  PATHS.postMeta, '`post.metadata[].sourceFolder`', '`pre` runs this step; `post` does not');
const destructLine = missingStep(PATHS.postDestruct, steps, { content: () => xml(['Flow', ['Old-1']]), head: () => xml() });
has('an added member in a stage with no destruct step is named', destructLine, PATHS.postDestruct, '`post.metadata-destruct[].destructiveChangesXml`');
check('no other stage is named when neither runs the step', !destructLine?.includes('runs this step'));
check('a destructive manifest with no added member needs nothing',
  missingStep(PATHS.postDestruct, steps, { content: () => xml(['ApexClass', ['A']]), head: () => xml(['ApexClass', ['A', 'B']]) }) === null);
check('a listed step needs nothing', missingStep(PATHS.preApex, steps, none) === null);
const noCommands = parseDeploySteps('pre:\n  runAnonymousScriptFromDir: runbooks/pre-deploy/apex\n');
check('a placeholder commands file needs nothing', missingStep(PATHS.postCmd, noCommands, { content: () => 'version', head: () => null }) === null);
has('a real command names both keys', missingStep(PATHS.postCmd, noCommands, { content: () => 'apex run --file x', head: () => 'version' }),
  '`post.runSFCommandFromFile` or `post.runSFDXCommandFromFile`');
check('content is not read for a path whose step is listed',
  missingStep(PATHS.postCmd, steps, { content: () => { throw new Error('read'); }, head: () => null }) === null);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs`
Expected: it exits non-zero with `ERR_MODULE_NOT_FOUND` for `scripts/lib/deploy-steps.mjs`.

- [ ] **Step 4: Write the library**

`plugins/hean-harness/scripts/lib/deploy-steps.mjs`:

```js
/**
 * Which pre and post steps a repository's deploy.yml lists, and which step a
 * runbook or destructive-changes path needs.
 *
 * The shared Jenkins library runs only the steps deploy.yml lists, and client
 * repositories list different ones. A file under a stage folder whose step is
 * missing is never deployed, and nothing reports it: a hand deploy of the
 * same file passes. The commit gate (hooks/runbook-stage-gate.mjs) and the
 * write-time warning (hooks/runbook-compile-check.mjs) share this answer.
 *
 * deploy.yml has one fixed shape, so a small parser reads it rather than a
 * YAML dependency: top-level stage keys, two-space nested keys, scalar values
 * with or without quotes, and `- key: value` list items with continuation
 * keys. A line outside that shape makes the file unreadable, and every caller
 * then lets the work through with a "!!" line: a guessed step list would
 * refuse commits the pipeline deploys.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export const DEPLOY_YML = 'deploy.yml';

/** The two keys repositories use for the commands-file step. */
export const COMMAND_KEYS = ['runSFCommandFromFile', 'runSFDXCommandFromFile'];

const CAP = { pre: 'Pre', post: 'Post' };

// per step kind: the value deploy.yml must hold, the keys that can hold it, and what Jenkins does with the file
const STEPS = {
  metadata: { value: s => `runbooks/${s}-deploy/metaData`, keys: s => [`${s}.metadata[].sourceFolder`], verb: 'deploys' },
  apex: { value: s => `runbooks/${s}-deploy/apex`, keys: s => [`${s}.runAnonymousScriptFromDir`], verb: 'runs' },
  commands: { value: s => `runbooks/${s}-deploy/sf/commands.txt`, keys: s => COMMAND_KEYS.map(k => `${s}.${k}`), verb: 'runs' },
  destruct: { value: s => `deletePackage/${s}/destructiveChanges${CAP[s]}.xml`, keys: s => [`${s}.metadata-destruct[].destructiveChangesXml`], verb: 'applies' }
};

/** A path as deploy.yml may write it, compared without a leading ./ or a trailing /. */
const norm = p => String(p ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');

/** A scalar value: quotes removed, or, unquoted, a trailing " # comment" removed. */
function scalar(raw) {
  const v = raw.trim();
  const quoted = /^(["'])(.*?)\1\s*(?:#.*)?$/.exec(v);
  return quoted ? quoted[2] : v.replace(/\s+#.*$/, '');
}

const isBlank = raw => raw.trim() === '' || raw.trim().startsWith('#');

/**
 * deploy.yml's text as { stage: { key: string | Array<object> } }. Throws,
 * naming the line, on a line outside the fixed shape, and when no stage is named.
 */
export function parseDeploySteps(text) {
  const out = {};
  let top = null, key = null, item = null;
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (isBlank(line)) return;
    const fail = () => { throw new Error(`line ${i + 1} is not in the shape deploy.yml uses: ${JSON.stringify(line.trim())}`); };
    let m;
    if ((m = /^([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!isBlank(m[2])) fail();
      top = m[1]; out[top] = {}; key = null; item = null;
      return;
    }
    if ((m = /^ {2}([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!top) fail();
      key = m[1]; item = null;
      out[top][key] = isBlank(m[2]) ? [] : scalar(m[2]);
      return;
    }
    if ((m = /^ {4}- ([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!top || !key || !Array.isArray(out[top][key])) fail();
      item = { [m[1]]: scalar(m[2]) };
      out[top][key].push(item);
      return;
    }
    if ((m = /^ {6}([A-Za-z][\w-]*):(.*)$/.exec(line))) {
      if (!item) fail();
      item[m[1]] = scalar(m[2]);
      return;
    }
    fail();
  });
  if (!Object.keys(out).length) throw new Error('it names no stage');
  return out;
}

/** { steps } from <root>/deploy.yml, { missing: true } when there is none, or { error } when it cannot be read. */
export function readDeploySteps(root) {
  const file = join(root, DEPLOY_YML);
  if (!existsSync(file)) return { missing: true };
  try {
    return { steps: parseDeploySteps(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `${DEPLOY_YML} could not be read (${e.message})` };
  }
}

/** The step one stage needs for one kind of file: { stage, kind, key, value }. */
export const stepFor = (stage, kind) => ({
  stage, kind, key: STEPS[kind].keys(stage).map(k => `\`${k}\``).join(' or '), value: STEPS[kind].value(stage)
});

/**
 * The step a path needs, { stage, kind, key, value, compare }, or null when it
 * needs none. compare says the file's content decides: 'commands' for a
 * commands file, 'members' for a destructive manifest. path is repository-
 * relative, or absolute with repoRoot given.
 */
export function requiredStep(path, repoRoot = null) {
  const rel = (isAbsolute(path) && repoRoot ? relative(repoRoot, path) : path).split(sep).join('/');
  let m = /^runbooks\/(pre|post)-deploy\/(metaData|apex|sf)\/(.+)$/.exec(rel);
  if (m) {
    const [, stage, folder, rest] = m;
    if (folder === 'metaData') return rest.split('/').at(-1) === '.keep' ? null : { ...stepFor(stage, 'metadata'), compare: null };
    if (folder === 'apex') return /^[^/]+\.apex$/.test(rest) ? { ...stepFor(stage, 'apex'), compare: null } : null;
    return { ...stepFor(stage, 'commands'), compare: rest === 'commands.txt' ? 'commands' : null };
  }
  m = /^deletePackage\/(pre|post)\/destructiveChanges(Pre|Post)\.xml$/.exec(rel);
  if (m && CAP[m[1]] === m[2]) return { ...stepFor(m[1], 'destruct'), compare: 'members' };
  return null;
}

/** Whether deploy.yml lists the step req names. */
export function stepPresent(steps, req) {
  const stage = steps?.[req.stage] ?? {};
  const list = k => (Array.isArray(stage[k]) ? stage[k] : []);
  const one = k => (typeof stage[k] === 'string' ? norm(stage[k]) : null);
  if (req.kind === 'metadata') return list('metadata').some(i => norm(i.sourceFolder) === req.value);
  if (req.kind === 'apex') return one('runAnonymousScriptFromDir') === req.value;
  if (req.kind === 'commands') return COMMAND_KEYS.some(k => one(k) === req.value);
  return list('metadata-destruct').some(i => norm(i.destructiveChangesXml) === req.value);
}

/** The lines of a commands file that run something: not blank, not a # comment, not the `version` placeholder. */
export const commandLines = text => String(text ?? '').split(/\r?\n/).map(l => l.trim())
  .filter(l => l && !l.startsWith('#') && l !== 'version');

/** Whether next has a command line old lacks. */
export function addsCommand(next, old) {
  const had = new Set(commandLines(old));
  return commandLines(next).some(l => !had.has(l));
}

/** The Type:member pairs a destructive manifest lists. */
export function memberPairs(xml) {
  const pairs = new Set();
  for (const [, body] of String(xml ?? '').matchAll(/<types>([\s\S]*?)<\/types>/g)) {
    const name = /<name>\s*([^<]*?)\s*<\/name>/.exec(body)?.[1] ?? '';
    for (const [, member] of body.matchAll(/<members>\s*([^<]*?)\s*<\/members>/g)) pairs.add(`${name}:${member}`);
  }
  return pairs;
}

/** The Type:member pairs next lists and old does not. */
export function addedMembers(next, old) {
  const had = memberPairs(old);
  return [...memberPairs(next)].filter(p => !had.has(p));
}

/** One line naming the path, the missing key and, when it has the step, the other stage. */
export function missingStepLine(rel, req, steps) {
  const other = req.stage === 'pre' ? 'post' : 'pre';
  const elsewhere = stepPresent(steps, stepFor(other, req.kind)) ? ` \`${other}\` runs this step; \`${req.stage}\` does not.` : '';
  return `${rel}: deploy.yml has no ${req.key} for ${req.value}, so Jenkins never ${STEPS[req.kind].verb} it.${elsewhere}`;
}

/**
 * The missing-step line for one path, or null when it needs no step, its step
 * is listed, or it adds nothing that runs. content(rel) and head(rel) give the
 * file as written or committed and as HEAD has it (null when absent); they are
 * read only for a commands file or a destructive manifest, whose placeholders
 * every repository carries.
 */
export function missingStep(rel, steps, { content, head }) {
  const req = requiredStep(rel);
  if (!req || stepPresent(steps, req)) return null;
  if (req.compare === 'commands' && !addsCommand(content(rel), head(rel))) return null;
  if (req.compare === 'members' && !addedMembers(content(rel), head(rel)).length) return null;
  return missingStepLine(rel, req, steps);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs`
Expected: `0 failed` and exit 0.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/scripts/lib/deploy-steps.mjs plugins/hean-harness/scripts/__tests__/deploy-steps.test.mjs plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/field-service.yml plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/base.yml plugins/hean-harness/scripts/__tests__/fixtures/deploy-yml/corrigo.yml
git commit -m "@HEAN-1: Add the deploy.yml step reader for runbook stages"
```

### Task 2: Shared commit-index helper

This task is a pure refactor of a hook that has already shipped. The guard is the existing `manifest-commit-check.test.mjs`, which must pass unchanged. It is its own task so that a reviewer can approve or reject the move separately from the new gate.

**Files:**
- Create: `plugins/hean-harness/scripts/lib/commit-index.mjs`
- Modify: `plugins/hean-harness/hooks/manifest-commit-check.mjs:23-84` (imports and the moved helpers), `:131-173` (`commitCheck`)
- Modify: `plugins/hean-harness/scripts/lib/manifest-check.mjs:44-45, 85-88`
- Modify: `plugins/hean-harness/scripts/lib/staging.mjs:5-8`
- Test: `plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs` (unchanged)

**Interfaces:**
- Consumes: `gitCommands`, `repoOf`, `git` (`command-line.mjs`); `stagingOf`, `stagesInteractively` (`staging.mjs`).
- Produces:
  - `commitsIn(command: string, sessionCwd: string)` is a generator of `{ c, root, dir, earlier, own, byPath: boolean, unknown: boolean }` for each `git commit` in the command, leaving out `--dry-run`. `earlier` items are `{ scope, paths, unknown?, dir, c }`, and `own` is `[{ scope, paths, unknown?, dir }]` or `[]`.
  - `commitIndex(root, earlier, own, byPath) → { file: string, cleanup: () => void }`. It throws when git cannot build the index.
  - `operationInProgress(root: string) → boolean`, exported from `scripts/lib/manifest-check.mjs`.

- [ ] **Step 1: Write the shared library**

`plugins/hean-harness/scripts/lib/commit-index.mjs`:

```js
/**
 * What each `git commit` in a Bash call will record, worked out before the
 * call runs.
 *
 * Shared by the per-story manifest check and the runbook stage gate. Both
 * judge the commit's content, not the index as it stands, so both need the
 * same answer for `git add f && git commit`, `git commit -a` and `git commit
 * <paths>`, and copies of that logic drift. The git pre-commit hook does not
 * use this file: git has already built the index there.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitCommands, repoOf, git } from './command-line.mjs';
import { stagingOf, stagesInteractively } from './staging.mjs';

/** The `git add` arguments that replay one staging. */
const ADD_ARGS = { paths: s => ['--', ...s.paths], tracked: () => ['-u'], all: () => ['-A'] };

/**
 * The files a commit by path records, as paths from the repository's top: the
 * files its paths match in the index (env names it) or in HEAD, as git lists
 * them. An untracked file inside a named folder is not among them, because git
 * commits only files it knows.
 */
function pathFiles(s, env) {
  const names = out => out.split('\0').filter(Boolean);
  return new Set([
    ...names(git(s.dir, 'ls-files', '-z', '--full-name', '--', ...s.paths, { env })),
    ...names(git(s.dir, 'ls-tree', '-r', '-z', '--name-only', '--full-name', 'HEAD', '--', ...s.paths))
  ]);
}

/**
 * A temporary index holding what the commit will record, { file, cleanup }:
 * the current index plus the stagings earlier in the command and the commit's
 * own (-a). A commit by path (own holds its paths) records instead HEAD plus
 * the working-tree state of the files its paths match in that index or in
 * HEAD. Throws when git cannot build it.
 */
export function commitIndex(root, earlier, own, byPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'commit-index-'));
  const file = join(scratch, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: file };
  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  try {
    const real = resolve(root, git(root, 'rev-parse', '--git-path', 'index'));
    if (!existsSync(real)) git(root, 'read-tree', 'HEAD', { env });
    else copyFileSync(real, file);
    for (const s of byPath ? earlier : [...earlier, ...own]) git(s.dir, 'add', ...ADD_ARGS[s.scope](s), { env });
    if (byPath) {
      const files = [...pathFiles(own[0], env)];
      git(root, 'read-tree', 'HEAD', { env });
      // update-index adds a file the working tree has and removes one it lacks, as the commit does
      if (files.length) git(root, 'update-index', '--add', '--remove', '-z', '--stdin', { env, input: files.join('\0') + '\0' });
    }
    return { file, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * Every `git commit` in the command, in order, with what it stages: yields
 * { c, root, dir, earlier, own, byPath, unknown }. earlier is the stagings the
 * same command ran before it in that repository, each with its folder and git
 * command; own is the commit's own staging (-a or paths); unknown is true when
 * any of them stages files the text cannot name. A --dry-run commit is left out.
 */
export function* commitsIn(command, sessionCwd) {
  const staged = new Map();   // root -> stagings earlier in this command, each with the folder it runs in
  for (const c of gitCommands(command, sessionCwd)) {
    if (c.sub !== 'add' && c.sub !== 'stage' && c.sub !== 'commit') continue;
    const root = repoOf(c, sessionCwd);
    if (!root) continue;
    const dir = c.dir ?? sessionCwd;
    const staging = stagesInteractively(c.sub, c.args) ? { scope: 'all', paths: [], unknown: true } : stagingOf(c.sub, c.args);
    if (c.sub !== 'commit') {
      if (staging) staged.set(root, [...(staged.get(root) ?? []), { ...staging, dir, c }]);
      continue;
    }
    const earlier = staged.get(root) ?? [];
    staged.delete(root);
    if (c.args.includes('--dry-run')) continue;
    const own = staging ? [{ ...staging, dir }] : [];
    yield { c, root, dir, earlier, own, byPath: staging?.scope === 'paths', unknown: [...earlier, ...own].some(s => s.unknown) };
  }
}
```

- [ ] **Step 2: Make the manifest hook use it**

In `plugins/hean-harness/hooks/manifest-commit-check.mjs`, replace lines 23-32 (the imports) with:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GIT_VALUE_OPTS } from '../scripts/lib/command-line.mjs';
import { commitsIn, commitIndex } from '../scripts/lib/commit-index.mjs';
import { shQuote } from '../scripts/lib/shell.mjs';
import {
  DEADLINE_MS, manifestTarget, checkManifest, writeManifest, stageCommand, refusalText, notChecked
} from '../scripts/lib/manifest-check.mjs';
```

Delete lines 39-84: the `ADD_ARGS` constant, `pathFiles` and `commitIndex`, each with its comment. Keep `SELF` and `word`.

Replace the body of `commitCheck` (lines 131-173, keeping its `/** … */` comment above) with:

```js
export function commitCheck(command, sessionCwd, deadline = Date.now() + DEADLINE_MS) {
  const warnings = [];
  for (const { c, root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    const target = manifestTarget(root);
    if (!target) continue;
    if (unknown) {
      warnings.push(notChecked('the command stages files its text does not name (a variable, a glob, a pathspec file or picked hunks)'));
      continue;
    }
    let index;
    try {
      index = commitIndex(root, earlier, own, byPath);
    } catch (e) {
      warnings.push(notChecked(`the index this commit records could not be built (${e.message.split('\n')[0]})`));
      continue;
    }
    let result;
    try { result = checkManifest({ root, target, indexFile: index.file, deadline }); }
    finally { index.cleanup(); }
    if (result.kind === 'unchecked') { warnings.push(notChecked(result.reason)); continue; }
    if (result.kind !== 'stale' && result.kind !== 'empty') continue;
    const scratchFile = result.kind === 'stale' ? writeManifest(root, target, result.xml) : null;
    const { next, retry } = nextCommands(c, root, target, result.kind, scratchFile, sessionCwd, byPath, earlier);
    const text = refusalText(target, result, next, retry, { restaged: earlier.length > 0 });
    return { warnings, refusal: { root, target, result, text } };
  }
  return { warnings };
}
```

`nextCommands` and `retryGlobals` stay. They still use `join`, `shQuote`, `GIT_VALUE_OPTS` and `word`.

- [ ] **Step 3: Export the in-progress test**

In `plugins/hean-harness/scripts/lib/manifest-check.mjs`, after line 45 (`const IN_PROGRESS = [...]`), add:

```js

/** Whether a merge, cherry-pick, revert or rebase is in progress, so a commit records work taken from elsewhere. */
export function operationInProgress(root) {
  return IN_PROGRESS.some(name => {
    const p = tryGit(root, 'rev-parse', '--git-path', name);
    return !!p && existsSync(resolve(root, p));
  });
}
```

In `manifestTarget`, replace the loop at lines 85-88:

```js
  for (const name of IN_PROGRESS) {
    const p = tryGit(root, 'rev-parse', '--git-path', name);
    if (p && existsSync(resolve(root, p))) return null;
  }
```

with:

```js
  if (operationInProgress(root)) return null;
```

- [ ] **Step 4: Name the users in the staging header**

In `plugins/hean-harness/scripts/lib/staging.mjs`, replace lines 5-8:

```js
 * Shared by the hooks that check a commit before git makes it: the Flow
 * description gate, the runbook compile check and the per-story manifest
 * check. All need the same answer to "what does this call stage", and copies
 * of a parser drift.
```

with:

```js
 * Shared by the hooks that check a commit before git makes it: the Flow
 * description gate, the runbook compile check, and, through commit-index.mjs,
 * the per-story manifest check and the runbook stage gate. All need the same
 * answer to "what does this call stage", and copies of a parser drift.
```

- [ ] **Step 5: Run the guard test**

Run: `env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CONFIG_DIR node plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`
Expected: `85 passed, 0 failed, 85 total`, the same count as at `e8b9376`.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/scripts/lib/commit-index.mjs plugins/hean-harness/hooks/manifest-commit-check.mjs plugins/hean-harness/scripts/lib/manifest-check.mjs plugins/hean-harness/scripts/lib/staging.mjs
git commit -m "@HEAN-1: Move the commit index builder into a shared library"
```

### Task 3: Commit-time refusal (`runbook-stage-gate.mjs`)

**Files:**
- Create: `plugins/hean-harness/hooks/runbook-stage-gate.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json:49-53` (after the `manifest-commit-check.mjs` entry)
- Test: `plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs`

**Interfaces:**
- Consumes: `commitsIn`, `commitIndex` (Task 2); `operationInProgress` (Task 2); `readDeploySteps`, `requiredStep`, `missingStep` (Task 1); `tryGit`, `git` (`command-line.mjs`).
- Produces:
  - `stageCheck(command: string, sessionCwd: string) → { warnings: string[], refusal?: string }`
  - `notChecked(reason) → '!! The runbook stage check did not run: <reason>.'`
  - Hook output: a deny with `permissionDecisionReason` that starts with `!! This commit records runbook files Jenkins never deploys or runs`, or `{ systemMessage, hookSpecificOutput.additionalContext }` carrying the `!!` warnings.

- [ ] **Step 1: Write the failing test**

`plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs`:

```js
#!/usr/bin/env node
/**
 * Which commits the runbook stage gate refuses, for the deploy.yml shapes the
 * client repositories use.
 *
 * Each repository is a throwaway git repository carrying one of the
 * deploy.yml fixtures and the placeholder runbook files those repositories
 * keep. HOME and CLAUDE_CONFIG_DIR are throwaway folders and
 * CLAUDE_CODE_CHILD_SESSION is unset. No sf is called.
 *
 * Run: node hooks/__tests__/runbook-stage-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'runbook-stage-gate.mjs');
const FIXTURES = join(dirname(HOOKS), 'scripts', '__tests__', 'fixtures', 'deploy-yml');
const fixture = name => readFileSync(join(FIXTURES, `${name}.yml`), 'utf8');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-stage-')));
const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const xml = (...types) => '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  types.map(([t, ms]) => `    <types>\n${ms.map(m => `        <members>${m}</members>\n`).join('')}        <name>${t}</name>\n    </types>\n`).join('') +
  '    <version>63.0</version>\n</Package>\n';

const POST_META = 'runbooks/post-deploy/metaData/flowDefinitions/Old_Flow.flowDefinition-meta.xml';
const PRE_META = 'runbooks/pre-deploy/metaData/flowDefinitions/Old_Flow.flowDefinition-meta.xml';
const POST_APEX = 'runbooks/post-deploy/apex/01_backfill.apex';
const POST_CMD = 'runbooks/post-deploy/sf/commands.txt';
const PRE_CMD = 'runbooks/pre-deploy/sf/commands.txt';
const PRE_DESTRUCT = 'deletePackage/pre/destructiveChangesPre.xml';
const POST_DESTRUCT = 'deletePackage/post/destructiveChangesPost.xml';
const PLACED = 'runbooks/post-deploy/metaData/classes/ACME_Deployment.cls';
const PLACED_APEX = 'runbooks/post-deploy/apex/00_postdeployApexScript.apex';
const BASE_POST_DESTRUCT = xml(['ApexClass', ['ACME_Deployment']]);
const ADDED_POST_DESTRUCT = xml(['ApexClass', ['ACME_Deployment']], ['Flow', ['Old_Flow-1']]);

/** A throwaway repository shaped like a client repository: deploy.yml (unless null) and the placeholder runbook files. */
function makeRepo(name, deployYml) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  if (deployYml !== null) write(repo, 'deploy.yml', deployYml);
  for (const s of ['pre', 'post']) {
    write(repo, `runbooks/${s}-deploy/sf/commands.txt`, 'version');
    write(repo, `runbooks/${s}-deploy/metaData/.keep`, '');
  }
  write(repo, PRE_DESTRUCT, xml());
  write(repo, POST_DESTRUCT, BASE_POST_DESTRUCT);
  write(repo, PLACED, 'public class ACME_Deployment {}\n');
  write(repo, PLACED_APEX, '// placeholder\n');
  write(repo, 'notes.txt', 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}
const reset = repo => { git(repo, 'reset', '-q', '--hard'); git(repo, 'clean', '-qfd'); };

/** Run the hook as Claude Code does before a Bash call: { deny, warn, context }, each null when absent. */
function hook(cwd, command) {
  const out = execFileSync(process.execPath, [HOOK], { env, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'test', cwd, tool_input: { command } }) });
  const o = out.trim() ? JSON.parse(out) : {};
  return {
    deny: o.hookSpecificOutput?.permissionDecision === 'deny' ? o.hookSpecificOutput.permissionDecisionReason : null,
    warn: o.systemMessage ?? null,
    context: o.hookSpecificOutput?.additionalContext ?? null
  };
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;
const REFUSED = '!! This commit records runbook files Jenkins never deploys or runs';
const NOT_RUN = '!! The runbook stage check did not run';
let r;

console.log('corrigo shape: refused');
const corrigo = makeRepo('corrigo', fixture('corrigo'));
write(corrigo, POST_META, '<FlowDefinition/>\n');
git(corrigo, 'add', '--', POST_META);
r = hook(corrigo, 'git commit -m "x"');
has('a post metaData file is refused', r.deny, REFUSED, POST_META, '`post.metadata[].sourceFolder`', '`pre` runs this step; `post` does not');
has('the refusal says what to do and who decides deploy.yml', r.deny, 'Move each file to a stage that runs its step', "user's decision");
reset(corrigo);
write(corrigo, POST_APEX, 'System.debug(1);\n');
git(corrigo, 'add', '--', POST_APEX);
has('a post apex script is refused', hook(corrigo, 'git commit -m "x"').deny, POST_APEX, '`post.runAnonymousScriptFromDir`', '`pre` runs this step');
reset(corrigo);
write(corrigo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
git(corrigo, 'add', '--', POST_DESTRUCT);
r = hook(corrigo, 'git commit -m "x"');
has('an added member in the post destructive manifest is refused', r.deny, POST_DESTRUCT, '`post.metadata-destruct[].destructiveChangesXml`');
check('no other stage is named when neither runs the step', !r.deny?.includes('runs this step'), r.deny);
reset(corrigo);
write(corrigo, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
git(corrigo, 'add', '--', PRE_DESTRUCT);
has('an added member in the pre destructive manifest is refused', hook(corrigo, 'git commit -m "x"').deny, PRE_DESTRUCT, '`pre.metadata-destruct[].destructiveChangesXml`');
reset(corrigo);
write(corrigo, POST_META, '<FlowDefinition/>\n');
write(corrigo, POST_APEX, 'System.debug(1);\n');
write(corrigo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
write(corrigo, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
git(corrigo, 'add', '-A');
has('one refusal lists every offending path', hook(corrigo, 'git commit -m "x"').deny, POST_META, POST_APEX, POST_DESTRUCT, PRE_DESTRUCT);
reset(corrigo);

console.log('corrigo shape: what the commit records');
write(corrigo, POST_APEX, 'System.debug(1);\n');
has('git add and commit in one call is refused', hook(corrigo, `git add -- ${POST_APEX} && git commit -m "x"`).deny, POST_APEX);
reset(corrigo);
write(corrigo, PLACED_APEX, '// changed\n');
has('commit -a with a changed tracked post script is refused', hook(corrigo, 'git commit -am "x"').deny, PLACED_APEX);
has('a commit by path naming it is refused', hook(corrigo, `git commit -m "x" -- ${PLACED_APEX}`).deny, PLACED_APEX);
write(corrigo, 'notes.txt', 'two\n');
git(corrigo, 'add', '--', PLACED_APEX);
check('a commit by path of other files leaves the staged script out', silent(hook(corrigo, 'git commit -m "x" -- notes.txt')));
reset(corrigo);
write(corrigo, POST_APEX, 'System.debug(1);\n');
git(corrigo, 'add', '--', POST_APEX);
has('a commit through git -C from another folder is refused', hook(sandbox, `git -C ${corrigo} commit -m "x"`).deny, POST_APEX);
has('a commit after cd is refused', hook(sandbox, `cd ${corrigo} && git commit -m "x"`).deny, POST_APEX);
check('a dry run is not checked', silent(hook(corrigo, 'git commit --dry-run -m "x"')));
check('a command that is not a commit is silent', silent(hook(corrigo, 'git status')));
r = hook(corrigo, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'does not name');
reset(corrigo);
write(corrigo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
git(corrigo, 'add', '--', POST_DESTRUCT);
write(corrigo, POST_DESTRUCT, BASE_POST_DESTRUCT);
has('the staged content is checked, not the working tree', hook(corrigo, 'git commit -m "x"').deny, POST_DESTRUCT);
reset(corrigo);
write(corrigo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
check('an unstaged change is not part of the commit', silent(hook(corrigo, 'git commit -m "x"')));
reset(corrigo);

console.log('corrigo shape: allowed');
write(corrigo, PRE_META, '<FlowDefinition/>\n');
write(corrigo, POST_CMD, 'version\napex run --file ./runbooks/post-deploy/sf/01_cleanup.apex\n');
write(corrigo, 'runbooks/post-deploy/sf/01_cleanup.apex', 'System.debug(1);\n');
write(corrigo, 'runbooks/post-deploy/metaData/.keep', 'x\n');
write(corrigo, PRE_CMD, 'version\n# nothing yet\n\n');
git(corrigo, 'add', '-A');
r = hook(corrigo, 'git commit -m "x"');
check('pre metaData, a real post command, its script, .keep and a placeholder commands file are allowed', silent(r), JSON.stringify(r));
reset(corrigo);
git(corrigo, 'rm', '-q', '--', PLACED, PLACED_APEX);
write(corrigo, POST_DESTRUCT, xml());
git(corrigo, 'add', '--', POST_DESTRUCT);
check('deleting post files and removing a destructive member are allowed', silent(hook(corrigo, 'git commit -m "x"')));
reset(corrigo);
mkdirSync(join(corrigo, 'runbooks/pre-deploy/metaData/classes'), { recursive: true });   // git mv needs the destination folder
git(corrigo, 'mv', PLACED, 'runbooks/pre-deploy/metaData/classes/ACME_Deployment.cls');
check('moving a file to a stage that runs its step is allowed', silent(hook(corrigo, 'git commit -m "x"')));
reset(corrigo);
write(corrigo, 'notes.txt', 'two\n');
git(corrigo, 'add', '--', 'notes.txt');
check('a commit that leaves the placeholders untouched is silent', silent(hook(corrigo, 'git commit -m "x"')));
reset(corrigo);
git(corrigo, 'checkout', '-q', '-b', 'other');
write(corrigo, POST_APEX, 'System.debug(1);\n');
git(corrigo, 'add', '-A');
git(corrigo, 'commit', '-q', '-m', 'other');
git(corrigo, 'checkout', '-q', 'integration');
git(corrigo, 'merge', '-q', '--no-ff', '--no-commit', 'other');
check('a merge in progress is not checked', silent(hook(corrigo, 'git commit -m "x"')));
git(corrigo, 'merge', '--abort');

console.log('A first commit');
{
  const fresh = join(sandbox, 'fresh');
  mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'integration');
  write(fresh, 'deploy.yml', fixture('corrigo'));
  write(fresh, POST_APEX, 'System.debug(1);\n');
  git(fresh, 'add', '-A');
  has('a first commit is checked', hook(fresh, 'git commit -m "x"').deny, POST_APEX);
}

console.log('Other shapes');
for (const shape of ['field-service', 'base']) {
  const repo = makeRepo(shape, fixture(shape));
  write(repo, POST_META, '<FlowDefinition/>\n');
  write(repo, POST_APEX, 'System.debug(1);\n');
  write(repo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
  write(repo, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
  git(repo, 'add', '-A');
  r = hook(repo, 'git commit -m "x"');
  check(`${shape}: every stage folder is allowed`, silent(r), JSON.stringify(r));
}
{
  const bare = makeRepo('bare', null);
  write(bare, POST_APEX, 'System.debug(1);\n');
  git(bare, 'add', '-A');
  check('a repository without deploy.yml is silent', silent(hook(bare, 'git commit -m "x"')));
}

console.log('Unreadable deploy.yml');
{
  const broken = makeRepo('broken', 'pre:\n\tmetadata:\n');
  write(broken, 'notes.txt', 'two\n');
  git(broken, 'add', '--', 'notes.txt');
  check('a commit with no stage-folder file is silent', silent(hook(broken, 'git commit -m "x"')));
  write(broken, POST_APEX, 'System.debug(1);\n');
  git(broken, 'add', '--', POST_APEX);
  r = hook(broken, 'git commit -m "x"');
  check('a commit with a stage-folder file is allowed', r.deny === null, JSON.stringify(r));
  has('... with a !! line naming the reason', r.warn, NOT_RUN, 'deploy.yml could not be read', 'line 2');
  has('... that Claude sees too', r.context, 'deploy.yml could not be read');
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `env -u CLAUDE_CODE_CHILD_SESSION node plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs`
Expected: the first `hook()` call throws, because Node cannot find `hooks/runbook-stage-gate.mjs`, and the run exits non-zero.

- [ ] **Step 3: Write the hook**

`plugins/hean-harness/hooks/runbook-stage-gate.mjs`:

```js
#!/usr/bin/env node
/**
 * Refuses a `git commit` that records a runbook or destructive-changes file in
 * a stage folder whose step the repository's deploy.yml does not list.
 *
 * The shared Jenkins library runs only the pre and post steps deploy.yml
 * lists, and repositories list different ones. A file under a stage folder
 * whose step is missing is never deployed and nothing reports it; a hand
 * deploy that tests it passes. scripts/lib/deploy-steps.mjs maps each path to
 * the step it needs.
 *
 * What the commit records comes from scripts/lib/commit-index.mjs, as for the
 * per-story manifest check. A file only deleted is never refused. A commands
 * file counts only when it gains a line that runs something, and a
 * destructive manifest only when it gains a <members> entry, each compared
 * with HEAD: the placeholder files every repository carries are not changes.
 * A commit during a merge, cherry-pick, revert or rebase records work taken
 * from elsewhere and is not checked.
 *
 * The check fails open. No deploy.yml: silent. Staging the text cannot name,
 * an index git cannot build, or an unreadable deploy.yml when the commit
 * records a stage-folder file: the commit goes through with a "!!" line. It
 * calls no sf, so the 10-second hook timeout is enough.
 */

import { readFileSync } from 'node:fs';

import { git, tryGit } from '../scripts/lib/command-line.mjs';
import { commitsIn, commitIndex } from '../scripts/lib/commit-index.mjs';
import { readDeploySteps, requiredStep, missingStep } from '../scripts/lib/deploy-steps.mjs';
import { operationInProgress } from '../scripts/lib/manifest-check.mjs';

const SELF = 'runbook-stage-gate.mjs';

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The runbook stage check did not run: ${String(reason).replace(/\.$/, '')}.`;

/** The paths the commit adds or changes, read from the index it records; deletions left out. */
const recordedPaths = (root, env) =>
  git(root, 'diff', '--cached', '--name-only', '--no-renames', '--diff-filter=d', '-z', { env }).split('\0').filter(Boolean);

const refusalText = lines =>
  '!! This commit records runbook files Jenkins never deploys or runs, because deploy.yml does not list the step ' +
  'their stage folder needs:\n\n' +
  lines.map(l => `    ${l}`).join('\n') + '\n\n' +
  'Move each file to a stage that runs its step, or add the step to deploy.yml. A new step changes what Jenkins ' +
  "runs for every release of this repository, so adding one is the user's decision: ask before editing deploy.yml. " +
  'Then retry the commit.';

/** Check every commit in the command, in order: { warnings, refusal? }. The first refused commit stops the walk. */
export function stageCheck(command, sessionCwd) {
  const warnings = [];
  for (const { root, earlier, own, byPath, unknown } of commitsIn(command, sessionCwd)) {
    const deploy = readDeploySteps(root);
    if (deploy.missing || operationInProgress(root)) continue;
    if (unknown) {
      warnings.push(notChecked('the command stages files its text does not name (a variable, a glob, a pathspec file or picked hunks)'));
      continue;
    }
    let index;
    try {
      index = commitIndex(root, earlier, own, byPath);
    } catch (e) {
      warnings.push(notChecked(`the index this commit records could not be built (${e.message.split('\n')[0]})`));
      continue;
    }
    let lines;
    try {
      const env = { ...process.env, GIT_INDEX_FILE: index.file };
      const paths = recordedPaths(root, env).filter(rel => requiredStep(rel));
      if (paths.length && deploy.error) { warnings.push(notChecked(deploy.error)); continue; }
      lines = paths.map(rel => missingStep(rel, deploy.steps, {
        content: f => tryGit(root, 'show', `:${f}`, { env }),
        head: f => tryGit(root, 'show', `HEAD:${f}`)
      })).filter(Boolean);
    } finally {
      index.cleanup();
    }
    if (lines.length) return { warnings, refusal: refusalText(lines) };
  }
  return { warnings };
}

const isMain = process.argv[1] && process.argv[1].endsWith(SELF);
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (input.tool_name !== 'Bash') process.exit(0);
  const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
  let r;
  try { r = stageCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd()); }
  catch (e) { r = { warnings: [notChecked(e.message)] }; }
  if (r.refusal) {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.refusal } });
  }
  if (r.warnings.length) {
    const text = r.warnings.join('\n');
    emit({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
  }
  process.exit(0);
}
```

- [ ] **Step 4: Register the hook**

In `plugins/hean-harness/hooks/hooks.json`, in the `PreToolUse` → `Bash` list, insert this entry directly after the `manifest-commit-check.mjs` entry (the one with `"timeout": 60`):

```json
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/runbook-stage-gate.mjs\"",
            "timeout": 10
          },
```

Then check that the file still parses: `node -e "JSON.parse(require('fs').readFileSync('plugins/hean-harness/hooks/hooks.json','utf8'))"`. Expected: no output, exit 0.

- [ ] **Step 5: Run the test to verify it passes**

Run: `env -u CLAUDE_CODE_CHILD_SESSION node plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs`
Expected: `0 failed` and exit 0.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/hooks/runbook-stage-gate.mjs plugins/hean-harness/hooks/hooks.json plugins/hean-harness/hooks/__tests__/runbook-stage-gate.test.mjs
git commit -m "@HEAN-1: Add the runbook stage gate for commits"
```

### Task 4: Write-time warning in `runbook-compile-check.mjs`

**Files:**
- Modify: `plugins/hean-harness/hooks/runbook-compile-check.mjs:7-11` (header), `:30-32` (imports), after `:78` (new `stageWarning`), `:137-139` (commit gate), `:158-163` (`--check`), `:180-187` (PostToolUse)
- Test: `plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs:33, 62-80`, plus a new section before `:246`

**Interfaces:**
- Consumes: `readDeploySteps`, `requiredStep`, `stepPresent`, `missingStep` (Task 1).
- Produces: `stageWarning(root: string, rel: string) → { text: string, skipCompile: boolean } | null`, exported from `hooks/runbook-compile-check.mjs`. `text` starts with `!! `.

- [ ] **Step 1: Isolate the existing test's environment**

In `plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs`, replace line 33:

```js
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${BIN}:${process.env.PATH}`, FAKE_JSFORCE_LOG: CALLS };
```

with:

```js
const HOME = join(sandbox, 'home');
mkdirSync(HOME);
const env = { ...process.env, HOME, CLAUDE_CONFIG_DIR: join(sandbox, 'config'), PATH: `${BIN}:${process.env.PATH}`, FAKE_JSFORCE_LOG: CALLS };
delete env.CLAUDE_CODE_CHILD_SESSION;
```

In `makeRepo` (lines 62-80), make the five direct `execFileSync('git', [...])` calls use that environment. Replace:

```js
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T']);
```

with:

```js
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], { env });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T'], { env });
```

and replace:

```js
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'base']);
```

with:

```js
  execFileSync('git', ['-C', repo, 'add', '.'], { env });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'base'], { env });
```

- [ ] **Step 2: Write the failing test**

Insert this section immediately before the line `rmSync(sandbox, { recursive: true, force: true });` near the end of `runbook-compile-check.test.mjs`:

```js
console.log('Stage check');
const FIXTURES = join(dirname(HOOKS), 'scripts', '__tests__', 'fixtures', 'deploy-yml');
/** A repository from makeRepo with one deploy.yml fixture committed. */
function shapedRepo(name, shape) {
  const r = makeRepo(name);
  write(r, 'deploy.yml', readFileSync(join(FIXTURES, `${shape}.yml`), 'utf8'));
  git(r, 'add', 'deploy.yml');
  git(r, 'commit', '-q', '-m', 'deploy.yml');
  return r;
}
const POST_META = 'runbooks/post-deploy/metaData/flowDefinitions/Old_Flow.flowDefinition-meta.xml';
const POST_DESTRUCT = 'deletePackage/post/destructiveChangesPost.xml';
const destructive = members => '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  (members.length ? `    <types>\n${members.map(m => `        <members>${m}</members>\n`).join('')}        <name>Flow</name>\n    </types>\n` : '') +
  '    <version>63.0</version>\n</Package>\n';
{
  const corrigo = shapedRepo('corrigo', 'corrigo');
  const before = calls().length;
  write(corrigo, POST, GOOD);
  let out = afterWrite(corrigo, POST);
  let ctx = out.hookSpecificOutput?.additionalContext;
  check('a stage warning does not block', out.decision === undefined, JSON.stringify(out));
  has('corrigo: a post script is warned', ctx, '!! ', POST, '`post.runAnonymousScriptFromDir`', '`pre` runs this step; `post` does not', 'ask the user');
  check('corrigo: that script is not compiled', calls().length === before && !ctx?.includes('compiles at API'), ctx);
  write(corrigo, PRE, GOOD);
  ctx = afterWrite(corrigo, PRE).hookSpecificOutput?.additionalContext;
  check('corrigo: a pre script compiles with no stage warning', ctx === `${PRE} compiles at API 42.0 on dev@example.com (the pipeline's anonymous Apex version).`, ctx);
  write(corrigo, POST_META, '<FlowDefinition/>\n');
  has('corrigo: a post metaData file is warned', afterWrite(corrigo, POST_META).hookSpecificOutput?.additionalContext, '!! ', POST_META, '`post.metadata[].sourceFolder`');
  write(corrigo, 'runbooks/post-deploy/metaData/.keep', '');
  check('corrigo: .keep is silent', JSON.stringify(afterWrite(corrigo, 'runbooks/post-deploy/metaData/.keep')) === '{}');
  write(corrigo, POST_DESTRUCT, destructive([]));
  check('corrigo: a placeholder destructive manifest is silent', JSON.stringify(afterWrite(corrigo, POST_DESTRUCT)) === '{}');
  write(corrigo, POST_DESTRUCT, destructive(['Old_Flow-1']));
  has('corrigo: an added destructive member is warned', afterWrite(corrigo, POST_DESTRUCT).hookSpecificOutput?.additionalContext,
    '!! ', POST_DESTRUCT, '`post.metadata-destruct[].destructiveChangesXml`');
  write(corrigo, 'runbooks/post-deploy/sf/commands.txt', 'version\napex run --file x\n');
  check('corrigo: a post command is silent (post runs its commands file)', JSON.stringify(afterWrite(corrigo, 'runbooks/post-deploy/sf/commands.txt')) === '{}');
  git(corrigo, 'add', '--', POST);
  check('the compile gate leaves a script its stage never runs to the stage gate', refusal(corrigo, 'git commit -m "x"') === null);
  const run = spawnSync('node', [HOOK, '--check', join(corrigo, POST)], { env, encoding: 'utf8' });
  check('--check on such a script exits 1 without compiling',
    run.status === 1 && run.stderr.includes('`post.runAnonymousScriptFromDir`') && calls().length === before, run.stderr);
}
{
  const fs = shapedRepo('field-service', 'field-service');
  write(fs, POST, GOOD);
  check('field-service: a post script compiles with no stage warning',
    afterWrite(fs, POST).hookSpecificOutput?.additionalContext === `${POST} compiles at API 42.0 on dev@example.com (the pipeline's anonymous Apex version).`);
  write(fs, POST_META, '<FlowDefinition/>\n');
  check('field-service: a post metaData file is silent', JSON.stringify(afterWrite(fs, POST_META)) === '{}');
  write(fs, POST, GOOD + '// later\n');
  git(fs, 'add', '--', POST);
  has('field-service: an unchecked post script is still refused', refusal(fs, 'git commit -m "x"'), POST);
}
{
  const broken = makeRepo('broken-yml');
  write(broken, 'deploy.yml', 'pre:\n\tmetadata:\n');
  write(broken, POST, GOOD);
  has('an unreadable deploy.yml adds one !! line, and the script still compiles', afterWrite(broken, POST).hookSpecificOutput?.additionalContext,
    `!! The runbook stage check did not run for ${POST}: deploy.yml could not be read`, `${POST} compiles at API 42.0`);
  check('an unreadable deploy.yml says nothing for a file outside the stage folders', JSON.stringify(afterWrite(broken, 'notes.txt')) === '{}');
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `env -u CLAUDE_CODE_CHILD_SESSION node plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs`
Expected: the existing checks still pass and the new `Stage check` lines fail. For example, `FAIL  corrigo: a post script is warned` appears, and the run exits 1.

- [ ] **Step 4: Implement the warning**

In `plugins/hean-harness/hooks/runbook-compile-check.mjs`, replace header lines 7-11:

```js
 *   PostToolUse, Write|Edit   a write to runbooks/<pre|post>-deploy/apex/*.apex
 *                             compiles the file (scripts/lib/runbook-compile.mjs).
 *                             A compile error is returned as context starting
 *                             with "!! " and says what to fix; a pass records
 *                             the file's git object id. Nothing here blocks.
```

with:

```js
 *   PostToolUse, Write|Edit   a write to runbooks/<pre|post>-deploy/apex/*.apex
 *                             compiles the file (scripts/lib/runbook-compile.mjs).
 *                             A compile error is returned as context starting
 *                             with "!! " and says what to fix; a pass records
 *                             the file's git object id. A write to a stage
 *                             folder whose step deploy.yml does not list
 *                             (scripts/lib/deploy-steps.mjs) adds a "!! "
 *                             warning instead, and such a script is not
 *                             compiled. Nothing here blocks.
```

After the existing import block (after line 32, the `runbook-compile.mjs` import), add:

```js
import { readDeploySteps, requiredStep, stepPresent, missingStep } from '../scripts/lib/deploy-steps.mjs';
```

After the `check` function (after line 78), add:

```js

/**
 * The stage warning for one written file, { text, skipCompile }, or null when
 * it needs no step, its stage runs the step, or the repository has no
 * deploy.yml. skipCompile is set for a runbook script whose stage runs no
 * anonymous Apex: compiling a script Jenkins never runs checks nothing.
 */
export function stageWarning(root, rel) {
  if (!requiredStep(rel)) return null;
  const deploy = readDeploySteps(root);
  if (deploy.missing) return null;
  if (deploy.error) return { text: `!! The runbook stage check did not run for ${rel}: ${deploy.error}.`, skipCompile: false };
  const line = missingStep(rel, deploy.steps, {
    content: f => { try { return readFileSync(join(root, f), 'utf8'); } catch { return null; } },
    head: f => tryGit(root, 'show', `HEAD:${f}`)
  });
  if (!line) return null;
  return {
    text: `!! ${line}\n\nMove the file to a stage that runs this step, or ask the user whether to add the step to ` +
          'deploy.yml. A commit of it is refused until one of the two is done.',
    skipCompile: RUNBOOK_SCRIPT.test(rel)
  };
}
```

In `commitRefusal`, replace lines 137-139:

```js
    const ids = stagedScripts(root);
    for (const f of inCall) ids.set(f, existsSync(join(root, f)) ? objectId(root, f) : null);
    if (!ids.size) continue;
```

with:

```js
    const ids = stagedScripts(root);
    for (const f of inCall) ids.set(f, existsSync(join(root, f)) ? objectId(root, f) : null);
    // a script whose stage runs no anonymous Apex is never compiled; the runbook stage gate refuses its commit
    const { steps } = readDeploySteps(root);
    if (steps) for (const f of [...ids.keys()]) if (!stepPresent(steps, requiredStep(f))) ids.delete(f);
    if (!ids.size) continue;
```

In the `--check` branch, directly after the closing `}` of `if (!where || !RUNBOOK_SCRIPT.test(where.rel)) { … }` (line 163), add:

```js
    const stage = stageWarning(where.root, where.rel);
    if (stage?.skipCompile) { console.error(stage.text); process.exit(1); }
```

Replace the PostToolUse block (lines 180-187):

```js
  if (input.hook_event_name === 'PostToolUse') {
    const raw = input?.tool_input?.file_path;
    if (!raw) process.exit(0);
    const where = locate(resolve(input.cwd || process.cwd(), raw));
    if (!where || !RUNBOOK_SCRIPT.test(where.rel)) process.exit(0);
    // a failed compile is context, not a block: a block stops Claude's loop, and the commit gate enforces the fix
    context((await check(where.root, where.rel)).text);
  }
```

with:

```js
  if (input.hook_event_name === 'PostToolUse') {
    const raw = input?.tool_input?.file_path;
    if (!raw) process.exit(0);
    const where = locate(resolve(input.cwd || process.cwd(), raw));
    if (!where) process.exit(0);
    const stage = stageWarning(where.root, where.rel);
    if (!RUNBOOK_SCRIPT.test(where.rel) || stage?.skipCompile) {
      if (stage) context(stage.text);
      process.exit(0);
    }
    // a failed compile is context, not a block: a block stops Claude's loop, and the commit gate enforces the fix
    const compiled = (await check(where.root, where.rel)).text;
    context(stage ? `${stage.text}\n\n${compiled}` : compiled);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `env -u CLAUDE_CODE_CHILD_SESSION node plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs`
Expected: `0 failed` and exit 0. The total is the 46 original checks plus the new ones.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/hooks/runbook-compile-check.mjs plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs
git commit -m "@HEAN-1: Warn on writes to a stage deploy.yml does not run"
```

### Task 5: The rule and skills follow `deploy.yml`

**Files:**
- Modify: `plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md:14-20, 34, 61-63`
- Modify: `plugins/hean-harness/skills/create-pr/SKILL.md:144`
- Modify: `plugins/hean-harness/skills/update-pr/SKILL.md:233`
- Modify: `plugins/hean-harness/skills/deprecate-flow/SKILL.md:113, 124, 134, 171`

**Interfaces:**
- Consumes: the hook names `runbook-stage-gate.mjs` and `runbook-compile-check.mjs` (Tasks 3, 4), and the `deploy.yml` key names from Task 1.
- Produces: nothing that code reads.

Every edit follows the meta-file rules: imperative or declarative sentences, no `---` separators added after the frontmatter, no trailing blank lines, and headers written as noun phrases.

- [ ] **Step 1: Rewrite "Stage mechanics" in the rule**

In `plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md`, replace lines 16-20:

```markdown
Each stage runs around the `force-app` deployment, in this order:

1. Convert `runbooks/<stage>-deploy/metaData/` and deploy the result
2. Run every `.apex` file under `runbooks/<stage>-deploy/apex/` in filename order
3. Apply `deletePackage/<stage>/destructiveChanges<Stage>.xml`
```

with:

```markdown
The repository's `deploy.yml` decides which steps each stage runs. The shared Jenkins library runs only the steps it lists, and repositories list different ones. Read it before placing a file under a stage folder.

Each stage runs around the `force-app` deployment. The library runs a stage's listed steps in this order:

1. **Metadata** — `<stage>.metadata[].sourceFolder: ./runbooks/<stage>-deploy/metaData/`: convert that folder and deploy the result
2. **Anonymous Apex** — `<stage>.runAnonymousScriptFromDir: runbooks/<stage>-deploy/apex`: run every `.apex` file in it in filename order
3. **Commands file** — `<stage>.runSFCommandFromFile` or `<stage>.runSFDXCommandFromFile` (repositories use either key): run the commands in `runbooks/<stage>-deploy/sf/commands.txt`
4. **Metadata destruct** — `<stage>.metadata-destruct[].destructiveChangesXml: deletePackage/<stage>/destructiveChanges<Stage>.xml`: apply the destructive manifest

**A stage folder whose step `deploy.yml` does not list is never deployed**, and nothing reports it: a hand deploy of the file succeeds, and the pipeline skips it. Move such a file to a stage that runs its step. Adding a step to `deploy.yml` changes what Jenkins runs for every release of the repository; ask the user first. The plugin's `runbook-stage-gate.mjs` hook refuses a commit that adds such a file, and `runbook-compile-check.mjs` warns when one is written.
```

- [ ] **Step 2: Renumber the destructive step reference**

In the same file, in the bullet that starts with `- **Deploy the referencing components' updated content early,` (line 34), replace:

```markdown
so the metadata-deploy step (Stage mechanics step 1) clears every reference before that stage's destructive step (step 3) runs.
```

with:

```markdown
so the metadata-deploy step (Stage mechanics step 1) clears every reference before that stage's destructive step (step 4) runs.
```

- [ ] **Step 3: Add the `deploy.yml` check to "Automatic rows"**

In the same file, replace line 63:

```markdown
Derive one row per item the change touches. Every row's Mode is **Automatic**.
```

with:

````markdown
Derive one row per item the change touches. Every row's Mode is **Automatic**.

Read the repository's `deploy.yml` first, and derive a row only for a step it lists (Stage mechanics). A changed file under a stage folder whose step it does not list gets no row. This covers a `runbooks/<stage>-deploy/` file other than a `.keep` or a commands file that holds only blank lines, `#` comments and the `version` placeholder, and a `<members>` entry the change adds to a destructive manifest. Print this line for each one instead, as reply text, never in the PR body:

```
!! {path} — deploy.yml has no {stage}.{key}, so Jenkins never deploys or runs it. Move it to a stage that runs this step, or ask the user to add the step.
```

When the repository has no `deploy.yml`, derive rows from the table alone.
````

- [ ] **Step 4: Point create-pr and update-pr at the check**

In `plugins/hean-harness/skills/create-pr/SKILL.md` line 144, and in `plugins/hean-harness/skills/update-pr/SKILL.md` line 233, both paragraphs end with this sentence:

```markdown
That rule is the single source of truth for which paths produce which rows, how to describe a runbook script, and how to diff the destructive manifests against the merge base — follow it rather than restating it here.
```

In both files, replace that sentence with:

```markdown
That rule is the single source of truth for which paths produce which rows, how to describe a runbook script, and how to diff the destructive manifests against the merge base — follow it rather than restating it here. Read the repository's `deploy.yml` before deriving rows: the rule derives a row only for a step `deploy.yml` lists, and prints a `!!` line as reply text, never in the body, for each changed file whose stage step is missing.
```

- [ ] **Step 5: Make deprecate-flow check `deploy.yml`**

In `plugins/hean-harness/skills/deprecate-flow/SKILL.md`, replace line 113:

```markdown
The deploy runs `pre.metadata` → `pre.runAnonymousScriptFromDir` → `pre.runSFCommandFromFile` → `pre.metadata-destruct` → main deploy → `post.metadata-destruct`.
```

with:

```markdown
The deploy runs `pre.metadata` → `pre.runAnonymousScriptFromDir` → the `pre` commands-file step (`runSFCommandFromFile` or `runSFDXCommandFromFile`) → `pre.metadata-destruct` → main deploy → `post.metadata-destruct`, but only the steps the repository's `deploy.yml` lists. Repositories list different ones.
```

After line 124 (`Rebuild is outside this skill's stated scope. … Warn the user before proceeding down it.`), insert:

```markdown

### Step check

Read `deploy.yml` at the repository root before Phase 4, and check that it lists every step the intent needs. Compare paths after removing a leading `./` and a trailing `/`.

| Intent | Steps `deploy.yml` must list |
|---|---|
| Deprecation | `pre.metadata[].sourceFolder` naming `runbooks/pre-deploy/metaData` (Phases 5 and 7); `pre.runSFCommandFromFile` or `pre.runSFDXCommandFromFile` naming `runbooks/pre-deploy/sf/commands.txt` (Phase 6); `post.metadata-destruct[].destructiveChangesXml` naming `deletePackage/post/destructiveChangesPost.xml` |
| Rebuild | `pre.metadata[].sourceFolder` naming `runbooks/pre-deploy/metaData` (Phase 5); `pre.runSFCommandFromFile` or `pre.runSFDXCommandFromFile` naming `runbooks/pre-deploy/sf/commands.txt` (Phase 6); `pre.metadata-destruct[].destructiveChangesXml` naming `deletePackage/pre/destructiveChangesPre.xml` |

- **Missing step**: stop before Phase 4 and write nothing. Report each missing key and the file this skill would have written that Jenkins would never run. Never switch to the other stage on your own: a different stage changes when the deletion runs relative to the main deploy, and the pairing rules above depend on that. Adding the step to `deploy.yml` is the user's decision.
- **No `deploy.yml`**: the repository's pipeline steps cannot be read. Say so at the Phase 4 gate and continue.
```

In Phase 4, after the bullet on line 134 (`- whether this is a deprecation or a rebuild, the destructive target that follows from it, and why`), add:

```markdown
- the `deploy.yml` steps the Phase 3 step check confirmed, or that the repository has no `deploy.yml`
```

Replace line 171:

```markdown
`runSFCommandFromFile` shells out to the real `sf` CLI as a subprocess, which resolves the org's or project's own API version — unaffected by the jsforce default. `deploy.yml` runs `runSFCommandFromFile` immediately after `runAnonymousScriptFromDir` and before `metadata-destruct`, so the ordering this cleanup depends on (after deactivation, before the destructive step) is unchanged.
```

with:

```markdown
The commands-file step (`runSFCommandFromFile` or `runSFDXCommandFromFile`, whichever key the repository's `deploy.yml` uses) shells out to the Salesforce CLI as a subprocess, which resolves the org's or project's own API version — unaffected by the jsforce default. It runs immediately after `runAnonymousScriptFromDir` and before `metadata-destruct`, so the ordering this cleanup depends on (after deactivation, before the destructive step) is unchanged.
```

- [ ] **Step 6: Verify the edits**

Run:

```bash
grep -c 'runSFDXCommandFromFile' plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/deprecate-flow/SKILL.md
grep -n 'step 3' plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md
grep -c "Read the repository's \`deploy.yml\` before deriving rows" plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md
grep -n '^---$' plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/deprecate-flow/SKILL.md
for f in plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md plugins/hean-harness/skills/deprecate-flow/SKILL.md; do tail -c 2 "$f" | od -An -c; done
```

Expected:
- The first command reports at least 1 for each file.
- The second prints nothing.
- The third reports 1 for each file.
- The fourth prints only frontmatter delimiters: lines 1 and 5 of the rule, and lines 1 and 4 of deprecate-flow.
- Each `od` line ends in one `\n` that follows a character other than `\n`.

- [ ] **Step 7: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 8: Commit**

```bash
git add plugins/hean-harness/assets/rules/project/runbook-deployment-steps.md plugins/hean-harness/skills/create-pr/SKILL.md plugins/hean-harness/skills/update-pr/SKILL.md plugins/hean-harness/skills/deprecate-flow/SKILL.md
git commit -m "@HEAN-1: Update runbook skills to follow deploy.yml steps"
```

## Release

One plugin release, not part of this plan: do not bump the version. The hooks take effect after `/reload-plugins` or a restart. The rule reaches a repository when `/hean-harness:setup` runs there again.
