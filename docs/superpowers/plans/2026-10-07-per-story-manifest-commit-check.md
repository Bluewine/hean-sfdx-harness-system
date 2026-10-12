# Per-story Manifest Commit Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commit that touches Salesforce metadata on a story branch records an up-to-date `.claude/manifest/<WORK-ID>.xml`, checked by a Claude Code PreToolUse hook and, where the plugin owns `.githooks/`, by a git `pre-commit` hook.

**Architecture:** `branch-manifest.mjs` gains `--from-index`, which lists what an index records (the repository's, or the one `GIT_INDEX_FILE` names). A shared library `scripts/lib/manifest-check.mjs` decides whether a commit is checked, rebuilds the manifest into a scratch folder, and compares it with the copy the commit records. The Claude Code hook `hooks/manifest-commit-check.mjs` builds the index the commit will record in a temporary file before calling the library; the git `pre-commit` hook calls the library's `--git-hook` mode against the index git already built, from a fixed-path copy under `<config>/hean-harness/hooks/`. Installed git hooks are recognised by the hash setup recorded.

**Tech Stack:** Node (built-ins only), POSIX `sh`, git, the Salesforce CLI (`sf`), the plugin's install record (`scripts/lib/manifest.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-07-per-story-manifest-commit-check.md`

## Global Constraints

- Plugin root: `plugins/hean-harness/`. All paths below are relative to the repository root.
- Node built-ins and the plugin's own `scripts/lib/*` only. No new dependencies.
- Follow the comment density and style of `hooks/runbook-compile-check.mjs` and `scripts/lib/commit-format.mjs`: a header comment stating why, one-line `/** … */` on exported functions, no narration.
- Reuse helpers; never copy them. `stagingOf` and `stagesInteractively` move to `scripts/lib/staging.mjs` (Task 2) because a third hook needs them. `WORK_ID` moves to `scripts/lib/merge-base.mjs` (Task 1) because the check and `branch-manifest` must name the same file.
- `hooks/hooks.json`: the new hook's `timeout` is `60`. The check's own deadline is 50 seconds, ending in `!! The per-story manifest was not checked: the rebuild took longer than 50 seconds.`
- When the check cannot run (`sf` missing, timeout, `Error:` from the script, no base branch), the commit goes through with `!! The per-story manifest was not checked: <reason>.`
- Hotfix and back-merge branches (`*-HF`, `*-BM`, `hotfix-*`) are skipped.
- Never run plugin code in a client repository (`rews-field-service`, `rews-base`). Tests use temporary repositories and a fake `sf` (except `branch-manifest.test.sh`, which already requires the real `sf` CLI).
- Do not bump the plugin version in `.claude-plugin/plugin.json`.
- Commit subject: `@HEAN-1: <Capitalised imperative summary>`, summary at most 10 words, whole subject at most 77 characters, no trailers of any kind (no `Co-Authored-By`, no `Claude-Session`). Stage and commit by explicit path. Commit only as the session's saved commit preference allows; under `No commits` the commit approval gate refuses, and the step is skipped.
- Full test loop, run at the end of every task, one file at a time, never two loops at once:
  ```bash
  for f in plugins/hean-harness/hooks/__tests__/*.test.mjs plugins/hean-harness/scripts/__tests__/*.test.mjs; do echo "== $f"; node "$f" || echo "FAILED: $f"; done
  ```
  plus `bash plugins/hean-harness/skills/branch-manifest/__tests__/branch-manifest.test.sh` in any task that changes `branch-manifest.mjs` or `merge-base.mjs`. Expected: no `FAILED:` line, and the shell test ends with `All checks passed`.
- Never commit `plugins/hean-harness/assets/rules/user/zz-test-dropped-rule.md` (a test writes it briefly).

## Review Focus

- **A commit run from a subfolder, or through `git -C <repo>` / `cd <repo> &&` from another folder:** the refusal's command must work when typed where Claude stands, so it names the repository with `git -C` (index commit) or a leading `cd` (commit by path). Test: Task 2, "Where the commit runs".
- **Same-call staging the text cannot name** (`git add "$FILES"`, a glob, `--pathspec-from-file`, `-p`): the check must not guess a manifest; it allows with the `!!` "not checked" line. Test: Task 2, "The check cannot run".
- **A rebuild slower than the deadline:** the hook must answer before Claude Code's 60-second limit, allowing with the `!!` line. Test: Task 2, shortened deadline through `HEAN_MANIFEST_CHECK_DEADLINE_MS`.
- **A story-branch commit that changes nothing under a package directory** (notes, runbooks, `.claude/`): silent allow, no `sf` run. Test: Task 2, "Current".
- **`GIT_INDEX_FILE` given as a relative path** (git sets it for hooks; a script may set it from a subfolder): `branch-manifest --from-index` must read that index, not the repository's. Test: Task 1.

## Decisions the code forced (deviations from the spec's wording)

- **Fixed-path layout.** The check spawns `branch-manifest.mjs`, which imports `../../../scripts/lib/merge-base.mjs`. The copy therefore keeps the plugin's layout under `<config>/hean-harness/hooks/`, and the git hook runs `<config>/hean-harness/hooks/scripts/lib/manifest-check.mjs --git-hook`, not `.../hooks/manifest-check.mjs`. `<config>` is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, matching `scripts/lib/paths.mjs`.
- **"Another check refuses" in Claude Code — controller ruling (overrides the code in Task 2).** Claude Code runs all matching PreToolUse hooks in parallel (code.claude.com/docs/en/hooks: "All matching hooks run in parallel."), so the hook cannot see a sibling's decision. The hook therefore **never writes into the repository and never runs other hooks** (no `siblingRefusal`; re-running `runbook-compile-check` would compile against the org on every commit). On a stale or missing manifest it writes the rebuilt file to `<config>/hean-harness/manifest-check/<repo-hash>/<WORK-ID>.xml` (outside the repository, `<repo-hash>` = first 12 hex chars of sha1 of the repository root) and refuses with one exact command that copies it into `.claude/manifest/<WORK-ID>.xml` and stages it (`cp '<scratch>' '<root>/.claude/manifest/<WORK-ID>.xml' && git -C '<root>' add .claude/manifest/<WORK-ID>.xml`; for a commit by path: the `cp`, then the same commit with the manifest path added). For an empty manifest the command is `git -C '<root>' rm .claude/manifest/<WORK-ID>.xml` (path-list equivalent for a commit by path). A commit refused by another check therefore leaves no change in the repository. The `git-hook` mode (Task 4) uses the same scratch-file-plus-command refusal.
- **`pre-commit` only in SFDX repositories.** It is installed only where `sfdx-project.json` is at the repository root, so a non-SFDX repository does not get `core.hooksPath` set for a hook that never applies.
- **Commit format `off` keeps `core.hooksPath`** while the plugin's `pre-commit` is recorded in that repository; only `commit-msg` is removed.
- **Unnameable staging is not guessed** (see Review Focus); `stagingOf` gains an `unknown: true` flag for it. `git commit -i/--include` counts as picked hunks through the existing `stagesInteractively`, so it is allowed with the `!!` line.
- **`sf` reads source paths from disk in `--from-index` mode.** Only the change list, bundle existence and custom-label contents come from the index. A path staged but missing on disk makes `sf` fail, and the commit goes through with the `!!` line.
- **Test-only deadline override:** `HEAN_MANIFEST_CHECK_DEADLINE_MS`.

## File Structure

- `plugins/hean-harness/scripts/lib/merge-base.mjs` — gains the shared `WORK_ID` regex.
- `plugins/hean-harness/skills/branch-manifest/scripts/branch-manifest.mjs` — gains `--from-index`.
- `plugins/hean-harness/scripts/lib/staging.mjs` (new) — `stagingOf`, `stagesInteractively`, moved from the two hooks.
- `plugins/hean-harness/scripts/lib/manifest-check.mjs` (new) — the check, shared by both hooks; `--git-hook` entry.
- `plugins/hean-harness/hooks/manifest-commit-check.mjs` (new) — the Claude Code PreToolUse hook.
- `plugins/hean-harness/scripts/lib/githooks.mjs` (new) — hook state by recorded hash; the `pre-commit` installer.
- `plugins/hean-harness/assets/githooks/pre-commit` (new) — the git hook.
- `plugins/hean-harness/scripts/install-manifest-check.mjs` (new) — the fixed-path copy.
- Tests: `skills/branch-manifest/__tests__/branch-manifest.test.sh`, `hooks/__tests__/manifest-commit-check.test.mjs` (new), `scripts/__tests__/setup-twice.test.mjs`.

---

### Task 1: `branch-manifest --from-index`

**Files:**
- Modify: `plugins/hean-harness/scripts/lib/merge-base.mjs:6-8`
- Modify: `plugins/hean-harness/skills/branch-manifest/scripts/branch-manifest.mjs:1-47, 49-70, 105-142, 169-183, 272-287`
- Test: `plugins/hean-harness/skills/branch-manifest/__tests__/branch-manifest.test.sh`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const WORK_ID = /[A-Z][A-Z0-9]*-\d+/` in `scripts/lib/merge-base.mjs`.
  - CLI: `node branch-manifest.mjs --from-index [--name <id>] [--output-dir <dir>]`. Reads the index named by `GIT_INDEX_FILE` (relative paths resolved against the starting folder) or the repository's own. Output format is unchanged: first line `Manifest: <dir>/<name>.xml created|updated|unchanged` or `Manifest: <path> not written; …`, or `Error: <reason>`; sections `Components (N):`, `Added since the previous version of the file (N):`, `Dropped since the previous version of the file (N) — …:`, each item indented two spaces as `Type: Member`.

- [ ] **Step 1: Write the failing test**

Insert this block in `branch-manifest.test.sh` immediately before the line `# Another project: trunk named main, branch created from HEAD, no work ID, no origin.`:

```bash
# --from-index: only what the index records counts. Committed and staged changes are listed; an unstaged
# edit and an untracked file are not; labels are read from the index; GIT_INDEX_FILE names another index,
# and a relative one is read from the folder it was given in.
new_repo index integration
for c in Base Edit; do put $D/classes/$c.cls "public class $c {}"; put $D/classes/$c.cls-meta.xml; done
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>BaseLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Base desc</shortDescription>
        <value>Base value</value>
    </labels>
</CustomLabels>
XML
commit "base"
git checkout -q -b work-IDX-1_fixture integration
put $D/classes/Done.cls "public class Done {}"; put $D/classes/Done.cls-meta.xml; commit "committed"
put $D/classes/Staged.cls "public class Staged {}"; put $D/classes/Staged.cls-meta.xml
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>BaseLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Base desc</shortDescription>
        <value>Base value</value>
    </labels>
    <labels>
        <fullName>StagedLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Staged desc</shortDescription>
        <value>Staged value</value>
    </labels>
</CustomLabels>
XML
git add $D/classes/Staged.cls $D/classes/Staged.cls-meta.xml $D/labels/CustomLabels.labels-meta.xml
echo "// unstaged" >> $D/classes/Edit.cls
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>BaseLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Base desc</shortDescription>
        <value>Base value</value>
    </labels>
    <labels>
        <fullName>StagedLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Staged desc</shortDescription>
        <value>Staged value</value>
    </labels>
    <labels>
        <fullName>UnstagedLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Unstaged desc</shortDescription>
        <value>Unstaged value</value>
    </labels>
</CustomLabels>
XML
put $D/classes/Loose.cls "public class Loose {}"; put $D/classes/Loose.cls-meta.xml

OUT="$(node "$SCRIPT" --from-index --output-dir "$ROOT/idx-out")"
check "from-index: committed and staged components only" "ApexClass:Done ApexClass:Staged CustomLabel:StagedLabel" \
  "$(members "$ROOT/idx-out/IDX-1.xml")"
check "from-index: the unstaged edit is absent" "no" "$(has "$OUT" 'ApexClass: Edit')"
check "from-index: the untracked file is absent" "no" "$(has "$OUT" 'ApexClass: Loose')"
node "$SCRIPT" --output-dir "$ROOT/tree-out" >/dev/null
check "without --from-index the working tree still counts" \
  "ApexClass:Done ApexClass:Edit ApexClass:Loose ApexClass:Staged CustomLabel:StagedLabel CustomLabel:UnstagedLabel" \
  "$(members "$ROOT/tree-out/IDX-1.xml")"
cp "$(git rev-parse --git-path index)" "$ROOT/alt-index"
GIT_INDEX_FILE="$ROOT/alt-index" git add $D/classes/Loose.cls $D/classes/Loose.cls-meta.xml
(cd force-app && GIT_INDEX_FILE=../../alt-index node "$SCRIPT" --from-index --output-dir "$ROOT/alt-out" >/dev/null)
check "a relative GIT_INDEX_FILE is read from the folder it was given in" \
  "ApexClass:Done ApexClass:Loose ApexClass:Staged CustomLabel:StagedLabel" "$(members "$ROOT/alt-out/IDX-1.xml")"
check "the repository's own index is untouched" "no" "$(has "$(git diff --cached --name-only)" 'Loose.cls')"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/hean-harness/skills/branch-manifest/__tests__/branch-manifest.test.sh`
Expected: the script stops with `Error: Unknown option '--from-index'` captured in `OUT`; the `from-index:` checks print `FAIL`, and the run ends with `N check(s) failed`.

- [ ] **Step 3: Move `WORK_ID` into `merge-base.mjs`**

In `scripts/lib/merge-base.mjs`, after the `COMMON_BASES` line, add:

```js
// Work IDs such as ABC-123; the first one in a branch name names the story. branch-manifest and the
// per-story manifest commit check both read it from here, so both name the same file.
export const WORK_ID = /[A-Z][A-Z0-9]*-\d+/;
```

In `branch-manifest.mjs`, delete the two lines `// Work IDs such as ABC-123; …` and `const WORK_ID = …`, add `WORK_ID` to the import from `../../../scripts/lib/merge-base.mjs` (alphabetical: `MAX_BUFFER, WORK_ID, git, gitOut, nulList, resolveMergeBase`), and change `import { join, sep } from "node:path";` to `import { join, resolve, sep } from "node:path";`.

- [ ] **Step 4: Add the flag**

Header comment: after the line `// - Files the Salesforce CLI cannot map to a metadata type are reported as skipped.` add:

```js
// - With --from-index, only what the index records counts: the change list is the index against the
//   merge-base, untracked files are not read, and custom labels are read from the index. The index is
//   the repository's, or the one GIT_INDEX_FILE names, so a caller can check a commit before git makes it.
```

Replace `USAGE`:

```js
const USAGE =
  "Usage: branch-manifest.mjs [--base <branch>] [--name <manifest-name>] [--output-dir <dir>] [--from-index] [--args-stdin]";
```

In `readOptions`, add to `options` after `"output-dir"`:

```js
        "from-index": { type: "boolean", default: false },
```

- [ ] **Step 5: Read the index when asked**

Replace `bundleDirectory`, `changedPaths` and `sourcePaths` with:

```js
// A bundle survives a deleted file when the bundle folder still holds files: on disk, or in the index.
function bundleDirectory(file, fromIndex) {
  const parts = file.split("/");
  for (let i = parts.length - 3; i >= 0; i--) {
    if (!BUNDLE_FOLDERS.has(parts[i])) continue;
    const dir = parts.slice(0, i + 2).join("/");
    if (fromIndex) return gitOut(["ls-files", "-z", "--", dir]) ? dir : null;
    return existsSync(dir) && statSync(dir).isDirectory() ? dir : null;
  }
  return null;
}

function changedPaths(mergeBase, filter, dirs, fromIndex) {
  return nulList(
    gitOut([
      "diff",
      ...(fromIndex ? ["--cached"] : []),
      "--name-only",
      "--no-renames",
      `--diff-filter=${filter}`,
      "-z",
      mergeBase,
      "--",
      ...dirs
    ])
  );
}

function sourcePaths(mergeBase, dirs, fromIndex) {
  const changed = changedPaths(mergeBase, "ACMT", dirs, fromIndex);
  const untracked = fromIndex
    ? []
    : nulList(gitOut(["ls-files", "--others", "--exclude-standard", "-z", "--", ...dirs]));
  const deleted = changedPaths(mergeBase, "D", dirs, fromIndex);
  const ignored = forceIgnored(deleted);
  const bundles = deleted
    .filter((file) => !ignored.has(file))
    .map((file) => bundleDirectory(file, fromIndex))
    .filter(Boolean);
  return [...new Set([...changed, ...untracked, ...bundles])].sort();
}
```

Replace `labelChanges` with (an empty ref makes `atRef` read `:<path>`, the index):

```js
// Compares each labels file's merge-base version against its current version — the working tree, or the
// index with --from-index — or its absence, for a file deleted outright, so the manifest can list
// individual labels instead of the whole file.
function labelChanges(mergeBase, files, fromIndex) {
  const changed = new Set();
  const deleted = [];
  for (const file of files) {
    const before = parseLabels(atRef(mergeBase, file));
    const after = parseLabels(
      fromIndex ? atRef("", file) : existsSync(file) ? readFileSync(file, "utf8") : null
    );
    for (const [fullName, value] of after)
      if (before.get(fullName) !== value) changed.add(fullName);
    for (const fullName of before.keys())
      if (!after.has(fullName)) deleted.push(fullName);
  }
  return { members: [...changed].sort(), deleted: deleted.sort() };
}
```

In `run()`, replace the lines from `const options = readOptions();` through `const labels = labelChanges(mergeBase.sha, labelFiles);` with:

```js
  const options = readOptions();
  const fromIndex = options["from-index"];
  // git reads a relative GIT_INDEX_FILE against its working folder, which the chdir below changes
  if (process.env.GIT_INDEX_FILE)
    process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
  process.chdir(gitOut(["rev-parse", "--show-toplevel"]).trim());
  const branch = gitOut(["branch", "--show-current"]).trim();
  const name = manifestName(options.name, branch);
  const mergeBase = resolveMergeBase(options.base, branch);
  const target = join(options["output-dir"], `${name}.xml`);
  const dirs = packageDirectories();
  const paths = sourcePaths(mergeBase.sha, dirs, fromIndex);
  const deletedLabelFiles = changedPaths(mergeBase.sha, "D", dirs, fromIndex).filter((file) =>
    LABELS_FILE.test(file)
  );
  const labelFiles = [
    ...new Set([...paths.filter((file) => LABELS_FILE.test(file)), ...deletedLabelFiles])
  ];
  const labels = labelChanges(mergeBase.sha, labelFiles, fromIndex);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bash plugins/hean-harness/skills/branch-manifest/__tests__/branch-manifest.test.sh`
Expected: every line starts `ok`, last line `All checks passed`.

- [ ] **Step 7: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 8: Commit**

```bash
git add plugins/hean-harness/scripts/lib/merge-base.mjs plugins/hean-harness/skills/branch-manifest/scripts/branch-manifest.mjs plugins/hean-harness/skills/branch-manifest/__tests__/branch-manifest.test.sh
git commit -m "@HEAN-1: Add the from-index mode to branch-manifest"
```

---

### Task 2: Shared check library and the Claude Code hook

> **Controller ruling (read first):** wherever this task's code below writes the rebuilt manifest into the repository (`copyFileSync(real, file)`) or calls `siblingRefusal`, replace it with the behaviour in "Decisions the code forced" → "Another check refuses": write the rebuilt file to the scratch path outside the repository and refuse with the exact copy-and-stage command; do not implement `siblingRefusal`. Tests: the stale case asserts the repository's `.claude/manifest/<WORK-ID>.xml` is unchanged after the refusal, the scratch file exists with the rebuilt content, and running the printed command then retrying the commit is allowed.


**Files:**
- Create: `plugins/hean-harness/scripts/lib/staging.mjs`
- Modify: `plugins/hean-harness/hooks/flow-description-gate.mjs:34, 124-172` (move `stagingOf` and its option tables out)
- Modify: `plugins/hean-harness/hooks/runbook-compile-check.mjs:19-21, 29, 102-119` (import from the library, drop the local `stagesInteractively`)
- Create: `plugins/hean-harness/scripts/lib/manifest-check.mjs`
- Create: `plugins/hean-harness/hooks/manifest-commit-check.mjs`
- Modify: `plugins/hean-harness/hooks/hooks.json:44-48` (register after `runbook-compile-check.mjs`)
- Test: `plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`

**Interfaces:**
- Consumes: `branch-manifest.mjs --from-index` and `WORK_ID`, `MAX_BUFFER` from `scripts/lib/merge-base.mjs` (Task 1); `gitCommands`, `repoOf`, `git`, `tryGit` from `scripts/lib/command-line.mjs`; `shQuote` from `scripts/lib/shell.mjs`.
- Produces:
  - `scripts/lib/staging.mjs`: `stagingOf(sub, args) → null | { scope: 'paths'|'tracked'|'all', paths: string[], unknown?: true }`; `stagesInteractively(sub, args) → boolean`.
  - `scripts/lib/manifest-check.mjs`:
    - `DEADLINE_MS: number` (50 000, or `HEAN_MANIFEST_CHECK_DEADLINE_MS`), `deadlineText() → string` (`"50 seconds"`), `notChecked(reason) → string`.
    - `manifestTarget(root) → null | { id: string, rel: string }` (`rel` is `.claude/manifest/<id>.xml`).
    - `checkManifest({ root, target, indexFile = null, deadline }) → { kind: 'skip' } | { kind: 'current' } | { kind: 'stale', xml, added: string[], dropped: string[] } | { kind: 'empty' } | { kind: 'unchecked', reason }`.
    - `writeManifest(root, target, xml) → void`; `refusalText(target, result, next) → string`.
  - `hooks/manifest-commit-check.mjs`: `commitCheck(command, sessionCwd, deadline) → { warnings: string[], refusal?: { root, target, result, text } }`; `siblingRefusal(input, deadline) → true | false | null`.

- [ ] **Step 1: Write the failing test**

Create `plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`:

```js
#!/usr/bin/env node
/**
 * Which commits the per-story manifest check lets through, which it refuses,
 * and what it leaves on disk.
 *
 * No org is called. PATH starts with a fake `sf` that maps classes/*.cls to
 * ApexClass and flows/*.flow-meta.xml to Flow and writes the package.xml that
 * branch-manifest reads; FAKE_SF_SLEEP_MS makes it slow. Each repository is a
 * throwaway SFDX repository. CLAUDE_CONFIG_DIR is a throwaway folder whose
 * saved preference is "commit per task", so the commit approval gate, which
 * the check consults before writing, lets the commits through.
 *
 * Run: node hooks/__tests__/manifest-commit-check.test.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync,
         symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'manifest-commit-check.mjs');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'manifest-check-')));
const BIN = join(sandbox, 'bin');
const NO_SF = join(sandbox, 'no-sf');
mkdirSync(BIN);
mkdirSync(NO_SF);
const FAKE_SF = String.raw`#!${process.execPath}
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const ms = Number(process.env.FAKE_SF_SLEEP_MS || 0);
if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const types = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--source-dir') continue;
  const p = args[++i];
  const cls = /\/classes\/([^/]+?)\.cls(?:-meta\.xml)?$/.exec(p);
  const flow = /\/flows\/([^/]+?)\.flow-meta\.xml$/.exec(p);
  const hit = cls ? ['ApexClass', cls[1]] : flow ? ['Flow', flow[1]] : null;
  if (!hit) {
    console.log(JSON.stringify({ status: 1, message: path.resolve(p) + ': Could not infer a metadata type' }));
    process.exit(1);
  }
  (types[hit[0]] ??= new Set()).add(hit[1]);
}
const blocks = Object.keys(types).sort().map(t =>
  '    <types>\n' + [...types[t]].sort().map(m => '        <members>' + m + '</members>\n').join('') +
  '        <name>' + t + '</name>\n    </types>\n');
fs.mkdirSync(value('--output-dir'), { recursive: true });
fs.writeFileSync(path.join(value('--output-dir'), value('--name')),
  '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  blocks.join('') + '    <version>67.0</version>\n</Package>\n');
console.log(JSON.stringify({ status: 0 }));
`;
writeFileSync(join(BIN, 'sf'), FAKE_SF);
chmodSync(join(BIN, 'sf'), 0o755);
// a PATH with git and node but no sf
symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(NO_SF, 'git'));
symlinkSync(process.execPath, join(NO_SF, 'node'));
const NO_SF_PATH = `${NO_SF}:/usr/bin:/bin`;

const CONFIG = join(sandbox, 'config');
mkdirSync(join(CONFIG, 'hean-harness'), { recursive: true });
writeFileSync(join(CONFIG, 'hean-harness', 'implementation.json'), JSON.stringify({ mode: 'main', commits: 'yes' }));
const env = { ...process.env, CLAUDE_CONFIG_DIR: CONFIG, PATH: `${BIN}:${process.env.PATH}` };

const CLASSES = 'force-app/main/default/classes';
const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const addClass = (repo, name) => {
  write(repo, `${CLASSES}/${name}.cls`, `public class ${name} {}\n`);
  write(repo, `${CLASSES}/${name}.cls-meta.xml`, '<ApexClass/>\n');
};

/** A throwaway SFDX repository: class A committed on integration, then a story branch checked out. */
function makeRepo(name, branch) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  write(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
  write(repo, '.gitignore', '.claude/*\n!.claude/manifest/\n.githooks/\n');
  write(repo, 'notes.txt', 'one\n');
  addClass(repo, 'A');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', branch);
  return repo;
}

/** Run the hook as Claude Code does before a Bash call: { deny, warn }, each null when absent. */
function hook(repo, command, { cwd = repo, extraEnv = {} } = {}) {
  const out = execFileSync(process.execPath, [HOOK], { env: { ...env, ...extraEnv }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'test', cwd, tool_input: { command } }) });
  const o = out.trim() ? JSON.parse(out) : {};
  return {
    deny: o.hookSpecificOutput?.permissionDecision === 'deny' ? o.hookSpecificOutput.permissionDecisionReason : null,
    warn: o.systemMessage ?? null
  };
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;

const OUT_OF_DATE = 'is out of date for this commit';
const NOT_CHECKED = '!! The per-story manifest was not checked';
const M = '.claude/manifest/ABC-1.xml';
const repo = makeRepo('story', 'work-ABC-1_story');
const manifest = () => existsSync(join(repo, M)) ? readFileSync(join(repo, M), 'utf8') : null;
let r;

console.log('Another check refuses');
addClass(repo, 'B');
git(repo, 'add', CLASSES);
write(repo, '.claude/hean-harness.json', JSON.stringify({ commitFormat: 'on' }));
r = hook(repo, 'git commit -m "no work item"');
check('the manifest check stays silent when another check refuses', silent(r), JSON.stringify(r));
check('a commit another check refuses leaves no manifest behind', manifest() === null, manifest());
rmSync(join(repo, '.claude', 'hean-harness.json'));

console.log('Out of date');
r = hook(repo, 'git commit -m "@ABC-1: Add B"');
has('a missing manifest is refused', r.deny, OUT_OF_DATE, `git add ${M}`, 'ApexClass: B');
check('the rebuilt manifest is written into place',
      Boolean(manifest()?.includes('<members>B</members>')) && !manifest().includes('<members>A</members>'), manifest());

console.log('Staged in the same call');
r = hook(repo, `git add ${M} && git commit -m "@ABC-1: Add B"`);
check('adding the rebuilt manifest in the same call is allowed', silent(r), JSON.stringify(r));
git(repo, 'add', M);
git(repo, 'commit', '-q', '-m', 'B');

console.log('Current');
write(repo, `${CLASSES}/B.cls`, 'public class B { Integer i; }\n');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit -m "@ABC-1: Update B"');
check('a change to a component the manifest lists is allowed', silent(r), JSON.stringify(r));
git(repo, 'commit', '-q', '-m', 'B again');
write(repo, 'notes.txt', 'two\n');
git(repo, 'add', 'notes.txt');
r = hook(repo, 'git commit -m "@ABC-1: Update notes"', { extraEnv: { PATH: NO_SF_PATH } });
check('a commit outside the package folders is not checked, and sf is not run', silent(r), JSON.stringify(r));
git(repo, 'commit', '-q', '-m', 'notes');

console.log('git commit -a');
write(repo, `${CLASSES}/A.cls`, 'public class A { Integer j; }\n');
addClass(repo, 'Untracked');
r = hook(repo, 'git commit -am "@ABC-1: Update A"');
has('commit -a counts tracked edits', r.deny, OUT_OF_DATE, 'ApexClass: A');
check('commit -a leaves untracked files out', !r.deny?.includes('Untracked') && !manifest().includes('Untracked'), manifest());
r = hook(repo, 'git commit -am "@ABC-1: Update A"');
check('commit -a picks up the rebuilt manifest on the retry', silent(r), JSON.stringify(r));
git(repo, 'checkout', '--', M);

console.log('Commit by path');
r = hook(repo, `git commit -m "@ABC-1: Update A" -- ${CLASSES}/A.cls`);
has('a commit by path without the manifest is refused', r.deny, OUT_OF_DATE, `git add ${join(repo, M)}`, `-- ${CLASSES}/A.cls ${join(repo, M)}`);
r = hook(repo, `git commit -m "@ABC-1: Update A" -- ${CLASSES}/A.cls ${M}`);
check('a commit by path naming the rebuilt manifest is allowed', silent(r), JSON.stringify(r));
git(repo, 'reset', '-q', '--hard');
git(repo, 'clean', '-qfd');

console.log('Nothing left to list');
git(repo, 'rm', '-q', `${CLASSES}/B.cls`, `${CLASSES}/B.cls-meta.xml`);
r = hook(repo, 'git commit -m "@ABC-1: Remove B"');
has('a manifest with nothing left to list is refused with git rm', r.deny, 'nothing left to list', `git rm ${M}`);
check('the hook does not delete the manifest itself', manifest() !== null);
git(repo, 'reset', '-q', '--hard');

console.log('Skipped');
addClass(repo, 'D');
git(repo, 'add', CLASSES);
const committed = manifest();
r = hook(repo, 'git commit --dry-run -m "x"');
check('a dry run is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
write(repo, '.gitignore', '.claude/\n.githooks/\n');
r = hook(repo, 'git commit -m "x"');
check('an ignored manifest is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
git(repo, 'checkout', '--', '.gitignore');
for (const branch of ['work-ABC-1-HF', 'work-ABC-1-BM', 'hotfix-ABC-1', 'feature/no-work-id']) {
  git(repo, 'checkout', '-q', '-b', branch);
  r = hook(repo, 'git commit -m "x"');
  check(`branch ${branch} is not checked`, silent(r) && manifest() === committed, JSON.stringify(r));
  git(repo, 'checkout', '-q', 'work-ABC-1_story');
}
git(repo, 'reset', '-q', '--hard');
git(repo, 'clean', '-qfd');
git(repo, 'checkout', '-q', '-b', 'other', 'integration');
addClass(repo, 'E');
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'E');
git(repo, 'checkout', '-q', 'work-ABC-1_story');
git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'other');
r = hook(repo, 'git commit -m "x"');
check('a merge in progress is not checked', silent(r) && manifest() === committed, JSON.stringify(r));
git(repo, 'merge', '--abort');
const plain = join(sandbox, 'plain');
mkdirSync(plain);
git(plain, 'init', '-q', '-b', 'work-ABC-2_story');
addClass(plain, 'P');
git(plain, 'add', '-A');
check('a repository without sfdx-project.json is not checked', silent(hook(plain, 'git commit -m "x"')));

console.log('The check cannot run');
addClass(repo, 'F');
git(repo, 'add', CLASSES);
r = hook(repo, 'git commit -m "x"', { extraEnv: { PATH: NO_SF_PATH } });
check('sf missing lets the commit through', r.deny === null, JSON.stringify(r));
has('sf missing says the manifest was not checked', r.warn, NOT_CHECKED, 'cannot run sf');
r = hook(repo, 'git commit -m "x"', { extraEnv: { HEAN_MANIFEST_CHECK_DEADLINE_MS: '1000', FAKE_SF_SLEEP_MS: '3000' } });
check('a slow rebuild lets the commit through', r.deny === null, JSON.stringify(r));
has('a slow rebuild names the deadline', r.warn, NOT_CHECKED, 'took longer than 1 second');
r = hook(repo, 'git add "$FILES" && git commit -m "x"');
check('staging the text cannot name lets the commit through', r.deny === null, JSON.stringify(r));
has('staging the text cannot name is not guessed', r.warn, NOT_CHECKED);
r = hook(repo, `git add -p ${CLASSES} && git commit -m "x"`);
has('picked hunks are not guessed', r.warn, NOT_CHECKED);
check('no manifest is written when the check cannot run', manifest() === committed);

console.log('Where the commit runs');
r = hook(repo, 'git commit -m "x"', { cwd: join(repo, 'force-app') });
has('a commit from a subfolder names the repository in the command', r.deny, `git -C ${repo} add ${M}`);
git(repo, 'checkout', '--', M);
r = hook(repo, `git -C ${repo} commit -m "x"`, { cwd: sandbox });
has('git -C from another folder names the repository in the command', r.deny, `git -C ${repo} add ${M}`);
git(repo, 'checkout', '--', M);
r = hook(repo, `cd ${repo} && git commit -m "x" -- ${CLASSES}/F.cls`, { cwd: sandbox });
has('a commit by path from another folder starts with cd', r.deny, `cd ${repo} && git add ${join(repo, M)}`);
git(repo, 'checkout', '--', M);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`
Expected: throws `Error: Cannot find module '…/hooks/manifest-commit-check.mjs'` on the first `hook(...)` call.

- [ ] **Step 3: Extract the staging parser**

Create `plugins/hean-harness/scripts/lib/staging.mjs`. Move `ADD_VALUE_OPTS`, `COMMIT_VALUE_OPTS`, `COMMIT_VALUE_SHORT` and `stagingOf` from `hooks/flow-description-gate.mjs` (lines 124-172) and `stagesInteractively` from `hooks/runbook-compile-check.mjs` (lines 102-119) into it unchanged, except the one `unknown` change marked below:

```js
/**
 * What a `git add` or `git commit` stages as it runs, read from the command
 * text before the command does.
 *
 * Shared by the hooks that check a commit before git makes it: the Flow
 * description gate, the runbook compile check and the per-story manifest
 * check. All need the same answer to "what does this call stage", and copies
 * of a parser drift.
 */

import { isLiteral } from './command-line.mjs';

// options that take the next word as their value, so it is not a path
const ADD_VALUE_OPTS = new Set(['--chmod', '--pathspec-from-file']);
const COMMIT_VALUE_OPTS = new Set(['-m', '--message', '-F', '--file', '-c', '--reedit-message',
  '-C', '--reuse-message', '-t', '--template', '--author', '--date', '--cleanup', '--fixup',
  '--squash', '--trailer']);
const COMMIT_VALUE_SHORT = 'mFcCt';

/**
 * What a `git add` or `git commit` stages as it runs, or null when it stages
 * nothing: { scope: 'paths'|'tracked'|'all', paths }. 'all' also stands for
 * anything the text cannot say, such as a pathspec file or a variable; that
 * result carries unknown: true, for a check that must not guess.
 */
export function stagingOf(sub, args) {
  /* body of the moved function, unchanged, except this line: */
  if (unknown || paths.some(p => !isLiteral(p))) return { scope: 'all', paths: [], unknown: true };
  /* … */
}

/**
 * Whether a `git add` or `git commit` picks hunks interactively (-p, --patch,
 * -i, --interactive). The staged content then differs from the working tree in
 * a way the text cannot say, so it counts as unknown staging.
 */
export function stagesInteractively(sub, args) {
  /* body of the moved function, unchanged */
}
```

(Paste the full moved bodies; the comments above mark the only edited line.)

In `hooks/flow-description-gate.mjs`: delete lines 124-172 (keep `const FLOW = …` on line 122), change line 34 to `import { gitCommands, repoOf } from '../scripts/lib/command-line.mjs';`, and add `import { stagingOf } from '../scripts/lib/staging.mjs';` below it.

In `hooks/runbook-compile-check.mjs`: delete lines 102-119 (`stagesInteractively` and its comment), replace line 29 with `import { stagingOf, stagesInteractively } from '../scripts/lib/staging.mjs';`, and in the header replace `is read with the Flow gate's parser:` with `is read with the shared staging parser (scripts/lib/staging.mjs):`.

Run: `node plugins/hean-harness/hooks/__tests__/flow-description-gate.test.mjs && node plugins/hean-harness/hooks/__tests__/runbook-compile-check.test.mjs`
Expected: both end `0 failed`.

- [ ] **Step 4: Write the check library**

Create `plugins/hean-harness/scripts/lib/manifest-check.mjs`:

```js
/**
 * Checks that a commit records an up-to-date per-story manifest,
 * .claude/manifest/<WORK-ID>.xml: the components the commit's tree changes
 * since the branch's merge-base, as branch-manifest --from-index lists them.
 *
 * Shared by the Claude Code hook (hooks/manifest-commit-check.mjs), which
 * builds the index the commit will record before the command runs, and the git
 * pre-commit hook, where git has already built it. Setup copies this file, the
 * two libraries it imports and branch-manifest.mjs, in the plugin's own
 * layout, to <config>/hean-harness/hooks/, because the plugin's folder moves
 * on every update and a git hook pointing there would break. So this file
 * imports only command-line.mjs and merge-base.mjs, and finds
 * branch-manifest.mjs relative to itself.
 *
 * When the check cannot run (no sf, no base branch, a rebuild past the
 * deadline) the commit goes through with a "!!" line naming the reason. A
 * manifest left unchecked is caught at the next commit or by the pull request
 * skills; a commit refused because a tool is missing blocks all work.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryGit } from './command-line.mjs';
import { MAX_BUFFER, WORK_ID } from './merge-base.mjs';

const BRANCH_MANIFEST = fileURLToPath(new URL('../../skills/branch-manifest/scripts/branch-manifest.mjs', import.meta.url));
// Hotfix and back-merge branches (uat-hotfix names them) do not carry their own story manifest.
const SKIPPED_BRANCH = /-(HF|BM)$|^hotfix-/;
// A commit made while one of these is in progress records work taken from elsewhere, not this story's.
const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

/** How long the check may take. Claude Code stops the hook at 60 seconds; this ends first and says so. Tests shorten it. */
export const DEADLINE_MS = Number(process.env.HEAN_MANIFEST_CHECK_DEADLINE_MS) || 50_000;

export const deadlineText = () => {
  const s = Math.round(DEADLINE_MS / 1000);
  return `${s} second${s === 1 ? '' : 's'}`;
};

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The per-story manifest was not checked: ${String(reason).replace(/\.$/, '')}.`;

/** git's environment reading the given index, or the repository's own when none is given. */
function indexEnv(indexFile) {
  const env = { ...process.env };
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  else delete env.GIT_INDEX_FILE;
  return env;
}

/** A file's content as the index holds it, untrimmed, or null when the index has no such file. */
function indexBlob(root, rel, env) {
  const r = spawnSync('git', ['-C', root, 'show', `:${rel}`], { env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The manifest a commit in this repository must keep current, { id, rel }, or
 * null when commits here are not checked: no sfdx-project.json, no work ID in
 * the branch name, a hotfix or back-merge branch, a merge, cherry-pick, revert
 * or rebase in progress, or a manifest git ignores.
 */
export function manifestTarget(root) {
  if (!existsSync(join(root, 'sfdx-project.json'))) return null;
  const branch = tryGit(root, 'branch', '--show-current');
  const id = branch ? WORK_ID.exec(branch)?.[0] : null;
  if (!id || SKIPPED_BRANCH.test(branch)) return null;
  for (const name of IN_PROGRESS) {
    const p = tryGit(root, 'rev-parse', '--git-path', name);
    if (p && existsSync(resolve(root, p))) return null;
  }
  const rel = `.claude/manifest/${id}.xml`;
  // check-ignore exits 0 when ignored, which tryGit returns as ''
  if (tryGit(root, 'check-ignore', '-q', rel) !== null) return null;
  return { id, rel };
}

/** The items under one section heading of branch-manifest's output. */
function section(out, title) {
  const lines = out.split('\n');
  const at = lines.findIndex(l => l.startsWith(`${title} (`));
  const items = [];
  for (let i = at + 1; at >= 0 && i < lines.length && lines[i].startsWith('  '); i++) items.push(lines[i].trim());
  return items;
}

/**
 * Compare the manifest the commit records with a rebuild from the same index.
 * The committed copy is put in the scratch folder first, so branch-manifest's
 * own comparison says unchanged, updated or created and lists what was added
 * and dropped.
 */
export function checkManifest({ root, target, indexFile = null, deadline = Date.now() + DEADLINE_MS }) {
  const env = indexEnv(indexFile);
  let dirs;
  try {
    dirs = JSON.parse(readFileSync(join(root, 'sfdx-project.json'), 'utf8')).packageDirectories.map(d => d.path);
  } catch (e) {
    return { kind: 'unchecked', reason: `sfdx-project.json could not be read (${e.message})` };
  }
  const changed = spawnSync('git', ['-C', root, 'diff', '--cached', '--name-only', 'HEAD', '--', ...dirs],
                            { env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (changed.status !== 0 || !changed.stdout.trim()) return { kind: 'skip' };

  const committed = indexBlob(root, target.rel, env);
  const scratch = mkdtempSync(join(tmpdir(), 'manifest-check-'));
  try {
    const file = join(scratch, `${target.id}.xml`);
    if (committed !== null) writeFileSync(file, committed);
    const late = { kind: 'unchecked', reason: `the rebuild took longer than ${deadlineText()}` };
    const left = deadline - Date.now();
    if (left <= 0) return late;
    const r = spawnSync(process.execPath,
      [BRANCH_MANIFEST, '--from-index', '--name', target.id, '--output-dir', scratch],
      { cwd: root, env, encoding: 'utf8', timeout: left, maxBuffer: MAX_BUFFER });
    if (r.error?.code === 'ETIMEDOUT' || r.signal) return late;
    if (r.error) return { kind: 'unchecked', reason: `branch-manifest could not run (${r.error.message})` };
    const out = r.stdout ?? '';
    const first = out.split('\n')[0];
    if (first.startsWith('Error: ')) return { kind: 'unchecked', reason: first.slice('Error: '.length) };
    const status = /^Manifest: .* (created|updated|unchanged|not written)/.exec(first)?.[1];
    if (!status) return { kind: 'unchecked', reason: `branch-manifest printed no result (${first || 'no output'})` };
    if (status === 'unchanged') return { kind: 'current' };
    if (status === 'not written') return committed === null ? { kind: 'current' } : { kind: 'empty' };
    return {
      kind: 'stale',
      xml: readFileSync(file, 'utf8'),
      added: section(out, status === 'created' ? 'Components' : 'Added since the previous version of the file'),
      dropped: section(out, 'Dropped since the previous version of the file')
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Put the rebuilt manifest where the commit's retry will add it. */
export function writeManifest(root, target, xml) {
  const file = join(root, target.rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, xml);
}

/** The refusal for a stale or empty result; next is the exact command to run before the retry. */
export function refusalText(target, result, next) {
  if (result.kind === 'empty') {
    return `!! The per-story manifest ${target.rel} has nothing left to list for this commit. ` +
           `Remove it in this commit and run the commit again:\n\n    ${next}`;
  }
  const list = (title, items) => items.length ? `\n\n${title}:\n${items.map(i => `    ${i}`).join('\n')}` : '';
  return `!! The per-story manifest ${target.rel} is out of date for this commit. ` +
         `It was rebuilt; add it to the commit and run the commit again.\n\n    ${next}` +
         list('Added', result.added) + list('Dropped', result.dropped);
}
```

- [ ] **Step 5: Write the Claude Code hook**

Create `plugins/hean-harness/hooks/manifest-commit-check.mjs`:

```js
#!/usr/bin/env node
/**
 * Refuses a `git commit` whose per-story manifest, .claude/manifest/<WORK-ID>.xml,
 * does not list what the commit records, after writing the rebuilt file into
 * place so the retry only has to add it.
 *
 * The check is scripts/lib/manifest-check.mjs, shared with the git pre-commit
 * hook. This hook runs before the command does, so it first builds the index
 * the commit will record in a temporary file: the current index, plus what the
 * same command stages earlier (`git add f && git commit`), plus `-a`; or, for
 * `git commit <paths>`, HEAD plus those paths. Staging the text cannot name —
 * a variable, a glob, a pathspec file, picked hunks — is not guessed: the
 * commit goes through with a "!!" line.
 *
 * Claude Code runs every PreToolUse hook at once, so this hook cannot see
 * whether another check refuses the same call. Before writing the manifest it
 * runs this plugin's other Bash PreToolUse hooks itself. When one refuses, it
 * says nothing and writes nothing: the commit is refused anyway, and the retry
 * is checked again. A manifest written for a commit that never happens is a
 * change nobody asked for.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitCommands, repoOf, git } from '../scripts/lib/command-line.mjs';
import { stagingOf, stagesInteractively } from '../scripts/lib/staging.mjs';
import { shQuote } from '../scripts/lib/shell.mjs';
import {
  DEADLINE_MS, deadlineText, manifestTarget, checkManifest, writeManifest, refusalText, notChecked
} from '../scripts/lib/manifest-check.mjs';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF = 'manifest-commit-check.mjs';

/** A word as it would be typed: quoted only when the shell would read it otherwise. */
const word = w => /^[\w@%+=:,./-]+$/.test(w) ? w : shQuote(w);

/** The `git add` arguments that replay one staging. */
const ADD_ARGS = { paths: s => ['--', ...s.paths], tracked: () => ['-u'], all: () => ['-A'] };

/**
 * A temporary index holding what the commit will record, { file, cleanup }.
 * A commit by path records HEAD plus its paths; any other commit records the
 * current index plus the stagings. Throws when git cannot build it.
 */
function commitIndex(root, stagings, byPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'manifest-index-'));
  const file = join(scratch, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: file };
  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  try {
    const real = resolve(root, git(root, 'rev-parse', '--git-path', 'index'));
    if (byPath || !existsSync(real)) git(root, 'read-tree', 'HEAD', { env });
    else copyFileSync(real, file);
    for (const s of stagings) git(s.dir, 'add', ...ADD_ARGS[s.scope](s), { env });
    return { file, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** The command to run before the retry, written to work from the session's folder. */
function nextCommand(c, root, target, kind, sessionCwd, byPath) {
  const verb = kind === 'empty' ? 'rm' : 'add';
  if (!byPath) return sessionCwd === root ? `git ${verb} ${target.rel}` : `git -C ${word(root)} ${verb} ${target.rel}`;
  const file = join(root, target.rel);
  const where = c.dir ?? sessionCwd;
  const cd = where === sessionCwd ? '' : `cd ${word(where)} && `;
  return `${cd}git ${verb} ${word(file)} && git commit ${[...c.args, file].map(word).join(' ')}`;
}

/**
 * Check every commit in the command, in order: { warnings, refusal? }. The
 * first stale or empty manifest stops the walk; nothing is written here.
 */
export function commitCheck(command, sessionCwd, deadline = Date.now() + DEADLINE_MS) {
  const staged = new Map();   // root -> stagings earlier in this command, each with the folder it runs in
  const warnings = [];
  for (const c of gitCommands(command, sessionCwd)) {
    if (c.sub !== 'add' && c.sub !== 'stage' && c.sub !== 'commit') continue;
    const root = repoOf(c, sessionCwd);
    if (!root) continue;
    const dir = c.dir ?? sessionCwd;
    const staging = stagesInteractively(c.sub, c.args) ? { scope: 'all', paths: [], unknown: true } : stagingOf(c.sub, c.args);
    if (c.sub !== 'commit') {
      if (staging) staged.set(root, [...(staged.get(root) ?? []), { ...staging, dir }]);
      continue;
    }
    const earlier = staged.get(root) ?? [];
    staged.delete(root);
    if (c.args.includes('--dry-run')) continue;
    const target = manifestTarget(root);
    if (!target) continue;
    const own = staging ? [{ ...staging, dir }] : [];
    if ([...earlier, ...own].some(s => s.unknown)) {
      warnings.push(notChecked('the command stages files its text does not name (a variable, a glob, a pathspec file or picked hunks)'));
      continue;
    }
    const byPath = staging?.scope === 'paths';
    let index;
    try {
      index = commitIndex(root, byPath ? own : [...earlier, ...own], byPath);
    } catch (e) {
      warnings.push(notChecked(`the index this commit records could not be built (${e.message.split('\n')[0]})`));
      continue;
    }
    let result;
    try { result = checkManifest({ root, target, indexFile: index.file, deadline }); }
    finally { index.cleanup(); }
    if (result.kind === 'unchecked') { warnings.push(notChecked(result.reason)); continue; }
    if (result.kind !== 'stale' && result.kind !== 'empty') continue;
    const next = nextCommand(c, root, target, result.kind, sessionCwd, byPath);
    return { warnings, refusal: { root, target, result, text: refusalText(target, result, next) } };
  }
  return { warnings };
}

/**
 * Does another of this plugin's Bash PreToolUse hooks refuse this call? true,
 * false, or null when one did not answer before the deadline.
 */
export function siblingRefusal(input, deadline) {
  const config = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  for (const group of config.hooks?.PreToolUse ?? []) {
    if (!new RegExp(`^(?:${group.matcher ?? '.*'})$`).test('Bash')) continue;
    for (const h of group.hooks ?? []) {
      if (h.type !== 'command' || h.command.includes(SELF)) continue;
      const left = deadline - Date.now();
      if (left <= 0) return null;
      const r = spawnSync('sh', ['-c', h.command], { input: JSON.stringify(input), encoding: 'utf8', timeout: left,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
      if (r.error || r.signal) return null;
      try {
        if (JSON.parse(r.stdout || '{}').hookSpecificOutput?.permissionDecision === 'deny') return true;
      } catch { /* no JSON: no decision */ }
    }
  }
  return false;
}

const isMain = process.argv[1] && process.argv[1].endsWith(SELF);
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (input.tool_name !== 'Bash') process.exit(0);
  const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
  const warn = text => emit({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
  const deadline = Date.now() + DEADLINE_MS;
  let r;
  try { r = commitCheck(input?.tool_input?.command ?? '', input.cwd || process.cwd(), deadline); }
  catch (e) { r = { warnings: [notChecked(e.message)] }; }

  if (r.refusal) {
    const { root, target, result, text } = r.refusal;
    if (result.kind === 'stale') {
      const other = siblingRefusal(input, deadline);
      // another check refuses this call; the retry is checked again
      if (other) process.exit(0);
      if (other === null) warn([...r.warnings, notChecked(`the other commit checks did not answer within ${deadlineText()}`)].join('\n'));
      writeManifest(root, target, result.xml);
    }
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } });
  }
  if (r.warnings.length) warn(r.warnings.join('\n'));
  process.exit(0);
}
```

- [ ] **Step 6: Register the hook**

In `plugins/hean-harness/hooks/hooks.json`, in the `PreToolUse` `Bash` list, insert after the `runbook-compile-check.mjs` entry:

```json
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/manifest-commit-check.mjs\"",
            "timeout": 60
          },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`
Expected: last line `N passed, 0 failed, N total`.

- [ ] **Step 8: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 9: Commit**

```bash
git add plugins/hean-harness/scripts/lib/staging.mjs plugins/hean-harness/scripts/lib/manifest-check.mjs plugins/hean-harness/hooks/manifest-commit-check.mjs plugins/hean-harness/hooks/flow-description-gate.mjs plugins/hean-harness/hooks/runbook-compile-check.mjs plugins/hean-harness/hooks/hooks.json plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs
git commit -m "@HEAN-1: Add the per-story manifest commit check hook"
```

---

### Task 3: Git hooks recognised by recorded hash (`commit-msg`)

**Files:**
- Create: `plugins/hean-harness/scripts/lib/githooks.mjs`
- Modify: `plugins/hean-harness/scripts/lib/commit-format.mjs:24-37, 47-61, 67-126`
- Test: `plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs` (new block before `// --- Auto-update`)

**Interfaces:**
- Consumes: `load` from `scripts/lib/manifest.mjs` (entries `{ type: 'file-copy', target, hash }`, `hash` is the sha256 hex of what setup wrote).
- Produces (`scripts/lib/githooks.mjs`): `HOOKS_DIR = '.githooks'`; `realPath(p) → string` (moved from `commit-format.mjs`, still re-exported there); `hookState(hook, source) → 'missing'|'current'|'older'|'edited'|'foreign'`; `writesHook(state, replace) → boolean`; `describeHook(state, replace) → string`; `keptLines(hook, state) → string[]`; `wroteLine(state, hook) → string`.

- [ ] **Step 1: Write the failing test**

In `setup-twice.test.mjs`, change the imports to:

```js
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync,
         readdirSync, appendFileSync, symlinkSync } from 'node:fs';
```

Insert immediately before the line `  // --- Auto-update ---------------------------------------------------------`:

```js
  // --- Git hooks recognised by the hash setup recorded ----------------------

  const shipped = name => readFileSync(join(dirname(SCRIPTS), 'assets', 'githooks', name), 'utf8');
  /** Make an installed hook look like an earlier plugin version's copy that setup wrote and nobody changed. */
  const olderCopy = (homeDir, repoName, hookName, text) => {
    const file = join(homeDir, '.claude', 'hean-harness', 'install-manifest.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    const entry = m.changes.find(c => c.type === 'file-copy' && c.target.endsWith(`/${repoName}/.githooks/${hookName}`));
    writeFileSync(entry.target, text);
    entry.hash = createHash('sha256').update(text).digest('hex');
    writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  };
  const backedUpIn = (homeDir, line) => {
    const dir = join(homeDir, '.claude', 'hean-harness', 'backups');
    return existsSync(dir) && readdirSync(dir).some(f => readFileSync(join(dir, f), 'utf8').includes(line));
  };
  const OLD_HOOK = '#!/bin/sh\n# an earlier version of the plugin hook\nexit 0\n';
  const USER_LINE = '# a line the user added\n';

  const homeH = join(root, 'homeH');
  const repoH = join(root, 'repoH');
  mkdirSync(join(homeH, '.claude'), { recursive: true });
  mkdirSync(repoH, { recursive: true });
  execFileSync('git', ['-C', repoH, 'init', '-q', '-b', 'main']);
  const envH = { ...process.env, HOME: homeH };
  const runHooks = (repoDir, args) => execFileSync('node', [join(SCRIPTS, 'install-githooks.mjs'), '--repo', repoDir, ...args],
    { env: envH, encoding: 'utf8', stdio: 'pipe' });
  const msgH = join(repoH, '.githooks', 'commit-msg');
  runHooks(repoH, ['--commit-format', 'on']);
  olderCopy(homeH, 'repoH', 'commit-msg', OLD_HOOK);
  let outH = runHooks(repoH, []);
  check('an unchanged commit-msg copy from an earlier version is updated',
        readFileSync(msgH, 'utf8') === shipped('commit-msg') && outH.includes('Updated ') && !outH.includes('!! KEPT'), outH);
  appendFileSync(msgH, USER_LINE);
  outH = runHooks(repoH, []);
  check('an edited plugin copy of commit-msg is kept, and says so',
        readFileSync(msgH, 'utf8').includes(USER_LINE) &&
          outH.includes('!! This is the plugin\'s copy, edited since setup installed it'), outH);
  runHooks(repoH, ['--replace-githook']);
  check('--replace-githook replaces an edited plugin copy and keeps a backup',
        readFileSync(msgH, 'utf8') === shipped('commit-msg') && backedUpIn(homeH, USER_LINE));
  const repoK = join(root, 'repoK');
  mkdirSync(join(repoK, '.githooks'), { recursive: true });
  execFileSync('git', ['-C', repoK, 'init', '-q', '-b', 'main']);
  const THEIR_HOOK = '#!/bin/sh\n# someone else\'s hook\nexit 0\n';
  writeFileSync(join(repoK, '.githooks', 'commit-msg'), THEIR_HOOK);
  const outK = runHooks(repoK, ['--commit-format', 'on']);
  check('someone else\'s untracked commit-msg is still kept',
        readFileSync(join(repoK, '.githooks', 'commit-msg'), 'utf8') === THEIR_HOOK &&
          outK.includes('!! The hook is already there, so setup leaves it as it is.'), outK);
  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envH, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall deletes the updated commit-msg', !existsSync(msgH));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: `FAIL  an unchanged commit-msg copy from an earlier version is updated` (today the older copy is kept with `!! KEPT — NOT CHANGED`), and `FAIL  an edited plugin copy of commit-msg is kept, and says so`.

- [ ] **Step 3: Write `githooks.mjs`**

Create `plugins/hean-harness/scripts/lib/githooks.mjs`:

```js
/**
 * The git hooks this plugin installs in a repository's .githooks folder, and
 * how setup tells its own copy from someone else's.
 *
 * A hook is the plugin's when the install record holds an entry for it whose
 * hash matches the file: setup wrote it and nobody changed it since. Comparing
 * with the plugin's current copy instead made every plugin update look like
 * someone else's hook, so a changed hook never reached a repository without
 * --replace-githook.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

import { load } from './manifest.mjs';

export const HOOKS_DIR = '.githooks';

/**
 * A path with symlinks resolved, including for a file that no longer exists:
 * the nearest existing parent is resolved and the rest appended. The same
 * folder can be recorded as /var/... and reported by git as /private/var/...
 */
export function realPath(p) {
  const rest = [];
  let cur = resolve(p);
  while (!existsSync(cur) && dirname(cur) !== cur) { rest.unshift(basename(cur)); cur = dirname(cur); }
  try { return join(realpathSync(cur), ...rest); } catch { return resolve(p); }
}

/**
 * 'missing'; 'current', the plugin's copy as it ships now; 'older', what setup
 * wrote, unchanged since, from an earlier plugin version; 'edited', what setup
 * wrote, changed since; or 'foreign', a file setup did not write.
 */
export function hookState(hook, source) {
  if (!existsSync(hook)) return 'missing';
  const current = readFileSync(hook);
  if (current.equals(readFileSync(source))) return 'current';
  const entry = load().changes.find(c => c.type === 'file-copy' && realPath(c.target) === realPath(hook));
  if (!entry) return 'foreign';
  return entry.hash === createHash('sha256').update(current).digest('hex') ? 'older' : 'edited';
}

/** Whether setup writes a hook found in this state. */
export const writesHook = (state, replace) =>
  state === 'missing' || state === 'older' || (replace && state !== 'current');

/** The plan line for a hook found in this state. */
export function describeHook(state, replace) {
  if (state === 'missing') return 'to add';
  if (state === 'current') return 'the plugin\'s copy, already in place';
  if (state === 'older') return 'the plugin\'s copy from an earlier version, unchanged since setup, to update';
  const found = state === 'edited' ? 'the plugin\'s copy, edited since setup' : 'present';
  return replace ? `${found}, to replace with the plugin's copy (a backup is kept)` : `${found}, left as it is`;
}

/** The lines that must reach the user when a hook is kept. */
export function keptLines(hook, state) {
  return ['', `!! KEPT — NOT CHANGED: ${hook}`,
    state === 'edited'
      ? '!! This is the plugin\'s copy, edited since setup installed it, so setup leaves it as it is.'
      : '!! The hook is already there, so setup leaves it as it is.',
    '!! To replace it with the plugin\'s copy, run setup again with --replace-githook.'];
}

/** The line reporting a hook setup wrote. */
export const wroteLine = (state, hook) =>
  `${state === 'missing' ? 'Added' : state === 'older' ? 'Updated' : 'Replaced'} ${hook}`;
```

- [ ] **Step 4: Use it in `commit-format.mjs`**

In `scripts/lib/commit-format.mjs`:
- Replace the imports on lines 24-25 with:
  ```js
  import { existsSync, chmodSync } from 'node:fs';
  import { dirname, join } from 'node:path';
  ```
- Add `import { HOOKS_DIR, realPath, hookState, writesHook, describeHook, keptLines, wroteLine } from './githooks.mjs';` after the `settings.mjs` import, and replace `export { settingsFile };` with `export { settingsFile, realPath, HOOKS_DIR };`.
- Delete `export const HOOKS_DIR = '.githooks';`, the `realPath` function with its comment (lines 47-57), and `isOurs` with its comment (lines 59-61).
- In the header, replace `A hook the repository had before is never removed or overwritten without --replace-githook, because the repository may rely on it.` with `A hook setup did not write, or the plugin's copy edited since setup wrote it, is never removed or overwritten without --replace-githook, because the repository may rely on it. The plugin's copy unchanged since setup is updated when the plugin ships a new one (scripts/lib/githooks.mjs).`
- In `applyChoice`, replace the line `const ours = isOurs(hook);` with nothing, and replace the `if (choice === 'on') { … }` block's opening through the `if (write) { … }` block with:

```js
  if (choice === 'on') {
    const state = hookState(hook, HOOK_SOURCE);
    const write = writesHook(state, replace);
    out.push(`Hook           ${hook}`);
    out.push(`               ${describeHook(state, replace)}`);
    out.push(`core.hooksPath ${hooksPath ?? 'unset'}`);
    const setPath = hooksPath === undefined;
    const otherPath = !setPath && hooksPath !== HOOKS_DIR;
    out.push(`               ${setPath ? `to set to ${HOOKS_DIR}` : otherPath ? 'points elsewhere, left as it is' : 'already correct'}`);
    if (!write && (state === 'edited' || state === 'foreign')) out.push(...keptLines(hook, state));
    if (dryRun) return out;

    init();
    writeChoice(repo, 'on');
    if (write) {
      installDir(join(repo, HOOKS_DIR));
      installFile(HOOK_SOURCE, hook);
      chmodSync(hook, 0o755);
      out.push(wroteLine(state, hook));
    }
```

The `setPath` / `otherPath` blocks after it and the whole `off` branch stay as they are (`hookExists` is still used there).

- [ ] **Step 5: Run test to verify it passes**

Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: last line `all checks passed`.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/scripts/lib/githooks.mjs plugins/hean-harness/scripts/lib/commit-format.mjs plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs
git commit -m "@HEAN-1: Recognise the commit-msg hook by its recorded hash"
```

---

### Task 4: Git `pre-commit` hook and the fixed-path check

> **Controller ruling (read first):** the `--git-hook` mode refuses the same way as the Claude Code hook after Task 2: the rebuilt file goes to the scratch path outside the repository, and the message gives the exact copy-and-stage (or `git rm`) command. It never writes into the repository.


**Files:**
- Create: `plugins/hean-harness/assets/githooks/pre-commit`
- Modify: `plugins/hean-harness/scripts/lib/manifest-check.mjs` (append the `--git-hook` entry; add `basename` to the `node:path` import)
- Create: `plugins/hean-harness/scripts/install-manifest-check.mjs`
- Modify: `plugins/hean-harness/scripts/setup.mjs:50` (new step after `Status line`)
- Modify: `plugins/hean-harness/scripts/lib/githooks.mjs` (add `applyPreCommit`)
- Modify: `plugins/hean-harness/scripts/install-githooks.mjs:1-26, 56-71`
- Modify: `plugins/hean-harness/scripts/lib/commit-format.mjs` `off` branch (`mine`, core.hooksPath lines)
- Test: `plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs` (new section), `plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs` (new block)

**Interfaces:**
- Consumes: `manifestTarget`, `checkManifest`, `writeManifest`, `refusalText`, `notChecked` (Task 2); `hookState`, `writesHook`, `describeHook`, `keptLines`, `wroteLine`, `realPath`, `HOOKS_DIR` (Task 3); `installDir`, `installFile`, `installGitConfig`, `getGitConfig` from `scripts/lib/install.mjs`; `init`, `load`, `STATE_DIR` from `scripts/lib/manifest.mjs`; `repoTracksHooks` from `scripts/lib/gitignore.mjs`.
- Produces: `node <copy>/scripts/lib/manifest-check.mjs --git-hook` (exit 1 refuses, 0 allows; messages on stderr); `applyPreCommit(repo, { replace, dryRun }) → string[]` and `PRE_COMMIT_SOURCE` in `githooks.mjs`; setup step `Manifest check`.

- [ ] **Step 1: Write the failing tests**

In `hooks/__tests__/manifest-commit-check.test.mjs`, insert before `rmSync(sandbox, { recursive: true, force: true });`:

```js
console.log('Terminal commits through the git pre-commit hook');
execFileSync(process.execPath, [join(dirname(HOOKS), 'scripts', 'install-manifest-check.mjs')], { env, stdio: 'ignore' });
const term = makeRepo('terminal', 'work-GH-2_story');
const TM = '.claude/manifest/GH-2.xml';
write(term, '.githooks/pre-commit', readFileSync(join(dirname(HOOKS), 'assets', 'githooks', 'pre-commit'), 'utf8'));
chmodSync(join(term, '.githooks', 'pre-commit'), 0o755);
git(term, 'config', 'core.hooksPath', '.githooks');
const commit = (args, extraEnv = {}) =>
  spawnSync('git', ['-C', term, 'commit', '-q', ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
const head = () => git(term, 'rev-parse', 'HEAD');

addClass(term, 'B');
git(term, 'add', CLASSES);
const before = head();
let c = commit(['-m', 'B']);
check('a terminal commit with a missing manifest is refused',
      c.status !== 0 && head() === before && c.stderr.includes(OUT_OF_DATE) && c.stderr.includes(`git add ${TM}`), c.stderr);
check('the git hook writes the rebuilt manifest', readFileSync(join(term, TM), 'utf8').includes('<members>B</members>'));
git(term, 'add', TM);
check('the retried terminal commit goes through', commit(['-m', 'B']).status === 0);
write(term, `${CLASSES}/A.cls`, 'public class A { Integer k; }\n');
c = commit(['-am', 'A']);
check('commit -a is checked against the index git builds', c.status !== 0 && c.stderr.includes('ApexClass: A'), c.stderr);
check('commit -a picks up the rebuilt manifest on the retry', commit(['-am', 'A']).status === 0);
addClass(term, 'C');
git(term, 'add', CLASSES);
const cPaths = [`${CLASSES}/C.cls`, `${CLASSES}/C.cls-meta.xml`];
c = commit(['-m', 'C', '--', ...cPaths]);
check('a commit by path is checked against its own index', c.status !== 0 && c.stderr.includes('ApexClass: C'), c.stderr);
check('a commit by path naming the manifest goes through', commit(['-m', 'C', '--', ...cPaths, TM]).status === 0);
addClass(term, 'D');
git(term, 'add', CLASSES);
c = commit(['-m', 'D'], { PATH: NO_SF_PATH });
check('a terminal commit goes through when sf is missing', c.status === 0 && c.stderr.includes(NOT_CHECKED), c.stderr);
addClass(term, 'E');
git(term, 'add', CLASSES);
const copyDir = join(CONFIG, 'hean-harness', 'hooks');
renameSync(copyDir, `${copyDir}.away`);
c = commit(['-m', 'E']);
check('the git hook does nothing once the check is gone', c.status === 0 && c.stderr === '', c.stderr);
renameSync(`${copyDir}.away`, copyDir);
```

In `scripts/__tests__/setup-twice.test.mjs`, insert after the Task 3 block (before `// --- Auto-update`):

```js
  // --- The pre-commit hook that checks the per-story manifest ----------------

  const homeP = join(root, 'homeP');
  mkdirSync(join(homeP, '.claude'), { recursive: true });
  const envP = { ...process.env, HOME: homeP };
  const sfdxRepo = name => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}\n');
    return dir;
  };
  const runP = (repoDir, args) => execFileSync('node', [join(SCRIPTS, 'install-githooks.mjs'), '--repo', repoDir, ...args],
    { env: envP, encoding: 'utf8', stdio: 'pipe' });
  const hooksPathOf = repoDir => {
    try { return execFileSync('git', ['-C', repoDir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return undefined; }
  };

  const repoP = sfdxRepo('repoP');
  const preP = join(repoP, '.githooks', 'pre-commit');
  let outP = runP(repoP, ['--commit-format', 'on']);
  check('the pre-commit hook is installed, executable, in an SFDX repository',
        existsSync(preP) && (statSync(preP).mode & 0o111) !== 0 && readFileSync(preP, 'utf8') === shipped('pre-commit'), outP);
  check('a repository without sfdx-project.json gets no pre-commit hook', !existsSync(join(repoH, '.githooks', 'pre-commit')));
  runP(repoP, ['--commit-format', 'off']);
  check('switching the commit format off keeps pre-commit and core.hooksPath',
        !existsSync(join(repoP, '.githooks', 'commit-msg')) && existsSync(preP) && hooksPathOf(repoP) === '.githooks',
        String(hooksPathOf(repoP)));
  runP(repoP, ['--commit-format', 'on']);
  olderCopy(homeP, 'repoP', 'pre-commit', OLD_HOOK);
  outP = runP(repoP, []);
  check('an unchanged pre-commit copy from an earlier version is updated',
        readFileSync(preP, 'utf8') === shipped('pre-commit') && outP.includes('Updated '), outP);
  appendFileSync(preP, USER_LINE);
  outP = runP(repoP, []);
  check('an edited plugin copy of pre-commit is kept, and says so',
        readFileSync(preP, 'utf8').includes(USER_LINE) && outP.includes('edited since setup installed it'), outP);

  const repoT = sfdxRepo('repoT');
  mkdirSync(join(repoT, '.githooks'), { recursive: true });
  writeFileSync(join(repoT, '.githooks', 'commit-msg'), '#!/bin/sh\nexit 0\n');
  execFileSync('git', ['-C', repoT, 'add', '.githooks/commit-msg']);
  runP(repoT, ['--commit-format', 'on']);
  check('a tracked .githooks/ folder gets no pre-commit hook', !existsSync(join(repoT, '.githooks', 'pre-commit')));

  const repoF = sfdxRepo('repoF');
  mkdirSync(join(repoF, '.githooks'), { recursive: true });
  const THEIR_PRE = '#!/bin/sh\n# the team\'s own pre-commit\nexit 0\n';
  writeFileSync(join(repoF, '.githooks', 'pre-commit'), THEIR_PRE);
  const outF = runP(repoF, ['--commit-format', 'on']);
  check('someone else\'s untracked pre-commit is kept, with a !! line',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === THEIR_PRE && outF.includes('!! KEPT — NOT CHANGED'), outF);
  runP(repoF, ['--replace-githook']);
  check('--replace-githook replaces someone else\'s pre-commit',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === shipped('pre-commit'));

  const repoU = sfdxRepo('repoU');
  runP(repoU, ['--commit-format', 'off']);
  check('the pre-commit hook does not depend on the commit format',
        existsSync(join(repoU, '.githooks', 'pre-commit')) && hooksPathOf(repoU) === '.githooks');

  execFileSync('node', [join(SCRIPTS, 'install-manifest-check.mjs')], { env: envP, encoding: 'utf8', stdio: 'pipe' });
  const checkDir = join(homeP, '.claude', 'hean-harness', 'hooks');
  check('the manifest check and branch-manifest are copied to the fixed folder',
        existsSync(join(checkDir, 'scripts', 'lib', 'manifest-check.mjs')) &&
          existsSync(join(checkDir, 'skills', 'branch-manifest', 'scripts', 'branch-manifest.mjs')));

  execFileSync('node', [join(SCRIPTS, 'lib', 'manifest.mjs'), 'revert'], { env: envP, encoding: 'utf8', stdio: 'pipe' });
  check('uninstall deletes an unchanged pre-commit and unsets core.hooksPath',
        !existsSync(join(repoU, '.githooks', 'pre-commit')) && hooksPathOf(repoU) === undefined, String(hooksPathOf(repoU)));
  check('uninstall copies an edited pre-commit aside before deleting it', !existsSync(preP) && backedUpIn(homeP, USER_LINE));
  check('uninstall puts back the pre-commit it replaced',
        readFileSync(join(repoF, '.githooks', 'pre-commit'), 'utf8') === THEIR_PRE);
  check('uninstall deletes the fixed copy of the manifest check', !existsSync(checkDir));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`
Expected: throws `Error: Command failed: … install-manifest-check.mjs` (file missing).
Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: throws at `shipped('pre-commit')` with `ENOENT`.

- [ ] **Step 3: Add the git hook asset**

Create `plugins/hean-harness/assets/githooks/pre-commit`, then `chmod 755` it:

```sh
#!/bin/sh
#
# Refuses a commit whose per-story manifest, .claude/manifest/<WORK-ID>.xml,
# does not list what the commit records, and writes the rebuilt file in place.
# Installed by hean-harness setup in an SFDX repository whose .githooks/ folder
# git does not track.
#
# The check lives in a fixed folder setup refreshes on every run, because the
# plugin's own folder moves when the plugin updates. When it is missing, the
# plugin was uninstalled, and this hook does nothing.

check="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hean-harness/hooks/scripts/lib/manifest-check.mjs"
[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$check" --git-hook
```

- [ ] **Step 4: Add the `--git-hook` entry**

In `scripts/lib/manifest-check.mjs`, change the path import to `import { basename, dirname, join, resolve } from 'node:path';`, add to the header comment `--git-hook runs it as git's pre-commit hook (assets/githooks/pre-commit).`, and append:

```js
/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records and named it in GIT_INDEX_FILE, for -a and a commit by path too, so
 * nothing is read from a command line. Exit 1 refuses the commit; every message
 * goes to standard error, which git shows. A failure of the check itself lets
 * the commit through, as every other "cannot run" case does.
 */
if (process.argv[1] && basename(process.argv[1]) === 'manifest-check.mjs' && process.argv.includes('--git-hook')) {
  try {
    // git may name the index relative to the folder the hook starts in; the git calls below run elsewhere
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    const root = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
    const target = root && manifestTarget(root);
    if (!target) process.exit(0);
    const result = checkManifest({ root, target, indexFile: process.env.GIT_INDEX_FILE ?? null });
    if (result.kind === 'unchecked') { process.stderr.write(`${notChecked(result.reason)}\n`); process.exit(0); }
    if (result.kind !== 'stale' && result.kind !== 'empty') process.exit(0);
    if (result.kind === 'stale') writeManifest(root, target, result.xml);
    const next = `git ${result.kind === 'empty' ? 'rm' : 'add'} ${target.rel}`;
    process.stderr.write(`${refusalText(target, result, next)}\n\n` +
      `A commit that names its paths needs ${target.rel} among them too.\n`);
    process.exit(1);
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    process.exit(0);
  }
}
```

- [ ] **Step 5: Add the fixed-path copy and its setup step**

Create `plugins/hean-harness/scripts/install-manifest-check.mjs`:

```js
#!/usr/bin/env node
/**
 * Copies the per-story manifest check to a fixed folder,
 * <config>/hean-harness/hooks/, where the git pre-commit hook setup installs
 * runs it from.
 *
 * The plugin's own folder moves when the plugin updates, so a git hook
 * pointing there breaks after the next update. The files keep the plugin's
 * layout under the fixed folder, because the check finds branch-manifest.mjs,
 * and branch-manifest.mjs finds its library, by relative path. Setup clears
 * and copies them again on every run, so the copy matches the installed plugin.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATE_DIR, init } from './lib/manifest.mjs';
import { installDir, installFile } from './lib/install.mjs';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEST = join(STATE_DIR, 'hooks');
// manifest-check.mjs and everything it loads, directly or through branch-manifest.mjs
const FILES = [
  'scripts/lib/manifest-check.mjs',
  'scripts/lib/command-line.mjs',
  'scripts/lib/merge-base.mjs',
  'skills/branch-manifest/scripts/branch-manifest.mjs'
];
const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

function main() {
  const missing = FILES.filter(f => !existsSync(join(PLUGIN_ROOT, f)));
  if (missing.length) {
    console.error(`Cannot find the manifest check files that ship with this plugin: ${missing.join(', ')}`);
    process.exit(1);
  }
  log(`Check          ${join(DEST, FILES[0])}`);
  log('               run by the .githooks/pre-commit hook setup installs in SFDX repositories');
  log('');
  if (dryRun) { log('Dry run. Nothing was changed.'); return; }

  init();
  for (const f of FILES) {
    installDir(dirname(join(DEST, f)));
    installFile(join(PLUGIN_ROOT, f), join(DEST, f));
  }
  log(`Copied ${FILES.length} files to ${DEST}`);
}

main();
```

In `scripts/setup.mjs`, after `{ name: 'Status line',   script: 'install-statusline.mjs' },` add:

```js
  { name: 'Manifest check', script: 'install-manifest-check.mjs' },
```

- [ ] **Step 6: Install `pre-commit` from the commit format step**

Append to `scripts/lib/githooks.mjs` (and extend its imports: `import { chmodSync, readFileSync, existsSync, realpathSync } from 'node:fs';`, `import { fileURLToPath } from 'node:url';`, `import { load, init } from './manifest.mjs';`, `import { installDir, installFile, installGitConfig, getGitConfig } from './install.mjs';`, `import { repoTracksHooks } from './gitignore.mjs';`):

```js
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PRE_COMMIT_SOURCE = join(PLUGIN_ROOT, 'assets', 'githooks', 'pre-commit');

/**
 * Put the pre-commit hook that checks the per-story manifest in place, and
 * point git at it. Only in an SFDX repository whose .githooks/ folder git does
 * not track: a tracked folder is the repository's, and commits made there in
 * Claude Code are still checked by the plugin's hook. Independent of the
 * commit format choice. Returns the lines to print; lines starting "!! " must
 * reach the user.
 */
export function applyPreCommit(repo, { replace = false, dryRun = false } = {}) {
  if (!existsSync(join(repo, 'sfdx-project.json'))) return [];
  const hook = join(repo, HOOKS_DIR, 'pre-commit');
  if (repoTracksHooks(repo)) {
    return [`Manifest hook  ${HOOKS_DIR}/ is tracked by the repository, so no pre-commit hook is installed`,
            '               the per-story manifest is checked only for commits made in Claude Code'];
  }
  const state = hookState(hook, PRE_COMMIT_SOURCE);
  const write = writesHook(state, replace);
  const hooksPath = getGitConfig(repo, 'core.hooksPath');
  const out = [`Manifest hook  ${hook}`, `               ${describeHook(state, replace)}`];
  if (!write && (state === 'edited' || state === 'foreign')) out.push(...keptLines(hook, state));
  if (dryRun) return out;

  init();
  if (write) {
    installDir(join(repo, HOOKS_DIR));
    installFile(PRE_COMMIT_SOURCE, hook);
    chmodSync(hook, 0o755);
    out.push(wroteLine(state, hook));
  }
  if (hooksPath === undefined) {
    installGitConfig(repo, 'core.hooksPath', HOOKS_DIR);
    out.push(`Set core.hooksPath to ${HOOKS_DIR}`);
  } else if (hooksPath !== HOOKS_DIR) {
    out.push(`core.hooksPath is ${hooksPath}, so git runs the hooks there and not ${hook}.`);
  }
  return out;
}
```

In `scripts/install-githooks.mjs`:
- Header: after the paragraph ending `…another tool may own it.` add:
  ```
   * In an SFDX repository it also puts a pre-commit hook there that checks the
   * per-story manifest (scripts/lib/githooks.mjs), whatever the commit format
   * choice. The same keep and replace rules apply to it.
  ```
- Import `import { applyPreCommit } from './lib/githooks.mjs';`.
- Replace everything in `main()` from `const saved = readChoice(repo);` to the end of `main()` with:

```js
  const saved = readChoice(repo);
  const choice = given ?? saved;
  if (!choice) {
    log('!! ASK — COMMIT FORMAT NOT CHOSEN for this repository.');
    log('!! Enforce the "@WORK-ID: Summary" commit subject format here? Run setup with');
    log('!! --commit-format on or --commit-format off. Nothing is enforced until then.');
  } else {
    if (!given) log(`Using the answer saved in ${settingsFile(repo)}`);
    for (const line of applyChoice(repo, choice, { replace, dryRun })) log(line);
  }
  log('');
  const preCommit = applyPreCommit(repo, { replace, dryRun });
  for (const line of preCommit) log(line);
  if (preCommit.length) log('');
  if (dryRun) log('Dry run. Nothing was changed.');
```

- [ ] **Step 7: Keep `core.hooksPath` when the commit format goes off**

In `scripts/lib/commit-format.mjs`, `applyChoice`'s `off` branch, replace the `mine` definition and the `core.hooksPath` / KEPT lines with:

```js
  // off: undo only what this plugin recorded for this repository's commit-msg hook. While its
  // pre-commit hook is recorded there, core.hooksPath and the folder stay, because that hook needs them.
  const top = realPath(repo);
  const preCommit = realPath(join(repo, HOOKS_DIR, 'pre-commit'));
  const preCommitRecorded = load().changes.some(c => c.type === 'file-copy' && realPath(c.target) === preCommit);
  const mine = c => category(c) === 'githooks' && (
    (c.type === 'file-copy' && realPath(c.target) === realPath(hook)) ||
    (!preCommitRecorded && (realPath(c.target) === top || realPath(c.target).startsWith(join(top, HOOKS_DIR)))));
  const recorded = load().changes.filter(mine);
  const hookRecorded = recorded.some(c => c.type === 'file-copy');
  const pathRecorded = recorded.find(c => c.type === 'git-config');

  out.push(`Hook           ${hook}`);
  out.push(`               ${!hookExists ? 'not there'
    : hookRecorded ? 'put there by this plugin, to remove (a hook it replaced is restored)'
    : 'present, left as it is'}`);
  if (pathRecorded) {
    out.push(`core.hooksPath to go back to ${pathRecorded.existedBefore ? pathRecorded.previousValue : 'unset'}`);
  } else if (preCommitRecorded) {
    out.push(`core.hooksPath stays ${HOOKS_DIR}: the plugin's pre-commit hook there still needs it`);
  }
```

The KEPT block and the rest of the branch stay as they are.

- [ ] **Step 8: Run tests to verify they pass**

Run: `node plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs`
Expected: `N passed, 0 failed, N total`.
Run: `node plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs`
Expected: `all checks passed`.

- [ ] **Step 9: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 10: Commit**

```bash
git add plugins/hean-harness/assets/githooks/pre-commit plugins/hean-harness/scripts/lib/manifest-check.mjs plugins/hean-harness/scripts/install-manifest-check.mjs plugins/hean-harness/scripts/setup.mjs plugins/hean-harness/scripts/lib/githooks.mjs plugins/hean-harness/scripts/install-githooks.mjs plugins/hean-harness/scripts/lib/commit-format.mjs plugins/hean-harness/hooks/__tests__/manifest-commit-check.test.mjs plugins/hean-harness/scripts/__tests__/setup-twice.test.mjs
git commit -m "@HEAN-1: Add the pre-commit manifest check for terminal commits"
```

---

### Task 5: Agent and skill wording

**Files:**
- Modify: `plugins/hean-harness/agents/sfdx-deployer.md:25, 32, 40-43, 71-75, 102`
- Modify: `plugins/hean-harness/skills/setup/SKILL.md:20-23, 60-64`
- Modify: `plugins/hean-harness/skills/uninstall/SKILL.md:20-37, 73-95`
- README: `README.md` describes no git hook (`grep -n -e 'pre-commit' -e 'commit-msg' -e 'githooks' README.md` returns nothing), so it is not changed.

**Interfaces:**
- Consumes: the refusal texts of Tasks 2 and 4 (`git rm .claude/manifest/<WORK-ID>.xml`), the `Components (N):` heading of `branch-manifest`, the `Manifest hook` and `!! KEPT` lines of Task 4, the fixed folder `~/.claude/hean-harness/hooks/`.
- Produces: text only.

- [ ] **Step 1: Write the failing check**

Run:
```bash
grep -c 'rebuilt at' plugins/hean-harness/agents/sfdx-deployer.md; grep -c 'nothing left to list' plugins/hean-harness/agents/sfdx-deployer.md; grep -c 'pre-commit' plugins/hean-harness/skills/setup/SKILL.md plugins/hean-harness/skills/uninstall/SKILL.md
```
Expected now: every count `0`.

- [ ] **Step 2: Edit `sfdx-deployer.md`**

- Success_Criteria line 25: replace `- A file under \`.claude/manifest/\` is never deleted.` with
  `- A file under \`.claude/manifest/\` is never deleted, except a manifest the commit check refuses a commit for because it has nothing left to list.`
- Constraints line 32: replace `Never write a package.xml by hand and never delete a file under \`.claude/manifest/\`.` with
  `Never write a package.xml by hand and never delete a file under \`.claude/manifest/\`, except a manifest the commit check reports has nothing left to list: remove that one with the \`git rm\` command the refusal names.`
- Investigation_Protocol step 1, first bullet: append ` Record the clock time (HH:MM) the skill returned and N from its \`Components (N):\` heading for the report.`
- Output_Format, `## Manifest` section: replace `**File:** [.claude/manifest/<name>.xml]` with `**Manifest:** .claude/manifest/<WORK-ID>.xml, rebuilt at [HH:MM], [N] components`.
- Final_Checklist: replace `- Did I list the components branch-manifest added and dropped?` with `- Did I list the components branch-manifest added and dropped, with the rebuild time and component count?`

- [ ] **Step 3: Edit `setup/SKILL.md`**

- Step 2, first bullet: replace
  `- an existing \`.githooks/commit-msg\` that git does not track: keep it, or replace it with the plugin's copy (\`--replace-githook\`, a backup is kept).`
  with
  `- an existing \`.githooks/commit-msg\` or \`.githooks/pre-commit\` that git does not track — someone else's hook, or the plugin's copy edited since setup installed it: keep it, or replace it with the plugin's copy (\`--replace-githook\`, a backup is kept). A plugin copy unchanged since setup is updated without asking.`
  (the sentence about a tracked hooks folder stays).
- Step 4, after the commit format bullet, add:
  ```markdown
   - whether the `Manifest hook` lines say `.githooks/pre-commit` was added, updated, replaced or
     kept. That hook checks the per-story manifest for commits typed in a terminal. It is installed
     only in a repository with `sfdx-project.json` whose `.githooks/` git does not track; say that a
     tracked `.githooks/` leaves terminal commits unchecked, while commits made in Claude Code are
     still checked. Repeat every `!! KEPT` line for it too.
   - that the `Manifest check` step copied the check to `~/.claude/hean-harness/hooks/`, where the
     pre-commit hook runs it from
  ```

- [ ] **Step 4: Edit `uninstall/SKILL.md`**

- Step 2, add a bullet after the `repo-file` bullet:
  ```markdown
     - each `file-copy` entry under `.githooks/` (`commit-msg`, `pre-commit`): the hook is deleted,
       a hook setup replaced is restored, and one edited since setup is copied to
       `~/.claude/hean-harness/backups/` first; and the copy of the manifest check under
       `~/.claude/hean-harness/hooks/`, after which a `.githooks/pre-commit` left behind does nothing
  ```
- Step 7, add a bullet after the `repo-folder` / `repo-file` bullet:
  ```markdown
     - each `.githooks/` hook deleted or restored, and that the manifest check copy under
       `~/.claude/hean-harness/hooks/` was deleted
  ```

- [ ] **Step 5: Run the check to verify it passes**

Run the Step 1 command again.
Expected: `1`, `2`, and a count of at least `1` for each skill file. Then check the meta-file rules: `grep -n '^---$' plugins/hean-harness/agents/sfdx-deployer.md plugins/hean-harness/skills/setup/SKILL.md plugins/hean-harness/skills/uninstall/SKILL.md` lists only the two frontmatter delimiters per file, and `tail -c 1` of each file is a single newline with no blank line before it.

- [ ] **Step 6: Run the full test loop** (Global Constraints). Expected: no `FAILED:` line.

- [ ] **Step 7: Commit**

```bash
git add plugins/hean-harness/agents/sfdx-deployer.md plugins/hean-harness/skills/setup/SKILL.md plugins/hean-harness/skills/uninstall/SKILL.md
git commit -m "@HEAN-1: Update deployer and setup docs for the manifest check"
```

---

### Task 6: File-link rule (user-approved 2026-10-07)

**Files:**
- Modify: `plugins/hean-harness/assets/system-prompt/global-system-prompt.txt` (naming rules: insert one bullet directly after the bullet that starts `- **A file is named by its path from the repository root the first time`)
- Modify: `plugins/hean-harness/assets/claude-md/block.md` (`### Always`: append one bullet after the bullet that starts `- Call every thing that has an identifier`)

Text below is verbatim (em dashes, backticks, brackets, line breaks). Change nothing else.

- [ ] **Step 1: Insert into global-system-prompt.txt**

```
- **A file the reader is meant to open is a clickable link.** When a reply points the reader to a
  file to read or review — a plan, a spec, a report, a handoff, or a file just written — give it as
  a markdown link whose target is the absolute path, with the file name as the text:
  "[2026-10-07-per-story-manifest-commit-check.md](/Users/…/docs/superpowers/plans/2026-10-07-per-story-manifest-commit-check.md)".
  This takes precedence over the repository-path rule above for that mention.
```

- [ ] **Step 2: Append to block.md**

```
- When pointing the user to a file to open (a plan, a spec, a report, a file just written), give it
  as a markdown link to the absolute path.
```

- [ ] **Step 3: Verify** — `git diff` shows only these two insertions; the full test loop passes (setup tests install both files).

- [ ] **Step 4: Commit** by explicit path: `@HEAN-1: Link files the reader should open`.

## Not verified while writing this plan

- Whether git passes `GIT_INDEX_FILE` to `pre-commit` as an absolute or a relative path. The plan absolutises it either way (Task 1, Task 4).
- Whether `git commit --dry-run` runs `pre-commit` in a terminal. The Claude Code hook skips `--dry-run`; the git hook cannot see the flag.
- Which tree `git commit --amend -- <paths>` starts from. The hook builds a commit by path from `HEAD`.
- What the real `sf project generate manifest` does with a `--source-dir` that exists in the index but not on disk. The plan assumes it fails, and the commit goes through with the `!!` line.
- A throwaway-repository probe of git's hook environment could not run: the session's commit approval gate refuses every `git commit` text, including in a temporary folder. The tests in Tasks 2 and 4 exercise each of these paths against real git.
