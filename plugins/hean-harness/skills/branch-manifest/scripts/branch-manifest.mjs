#!/usr/bin/env node
// Writes <output-dir>/<name>.xml, the Salesforce manifest (package.xml) of every component added or
// modified between the current branch's merge-base with its base branch and the working tree.
// Scope rules:
// - Committed, staged, unstaged, and untracked files count alike, under the sfdx-project.json package directories.
// - A file inside an LWC, Aura, or static-resource folder lists the whole bundle; a field file lists Object.Field.
// - A deleted component is absent; a file deleted inside a surviving bundle still lists the bundle.
// - A renamed file is listed under its new name only; .forceignore matches (Jest tests) are absent.
// - A custom-labels file lists only the individual labels that are new or changed since the merge-base,
//   as CustomLabel members; it never gets the whole-file CustomLabels member, which would deploy every
//   label in the file. A label removed since the merge-base is reported separately, not listed.
// - Files the Salesforce CLI cannot map to a metadata type are reported as skipped.
// Every outcome, errors included, is printed to stdout with exit code 0, so the skill that injects this
// output always receives it. Tests: bash <skill-dir>/__tests__/branch-manifest.test.sh
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  MAX_BUFFER,
  git,
  gitOut,
  nulList,
  resolveMergeBase
} from "../../../scripts/lib/merge-base.mjs";

const USAGE =
  "Usage: branch-manifest.mjs [--base <branch>] [--name <manifest-name>] [--output-dir <dir>] [--args-stdin]";
// Work IDs such as ABC-123; the first one in the branch name names the manifest.
const WORK_ID = /[A-Z][A-Z0-9]*-\d+/;
const UNINFERABLE = /^(.*): Could not infer a metadata type$/;
// Folders whose components are directories: deleting one file inside still changes the component.
const BUNDLE_FOLDERS = new Set(["lwc", "aura", "staticresources"]);
// A custom-labels file, source-format suffix; sf always names it CustomLabels.labels-meta.xml.
const LABELS_FILE = /\.labels-meta\.xml$/;
// Label fields compared as scalars; categories is multi-valued and compared as a sorted set instead.
const LABEL_FIELDS = ["value", "shortDescription", "protected", "language"];

// Skill arguments arrive as free text on stdin; only --base and --name are read from it.
function readOptions() {
  let options;
  try {
    options = parseArgs({
      allowPositionals: true,
      options: {
        base: { type: "string" },
        name: { type: "string" },
        "output-dir": { type: "string", default: join(".claude", "manifest") },
        "args-stdin": { type: "boolean", default: false }
      }
    }).values;
  } catch (error) {
    throw new Error(`${error.message}\n${USAGE}`);
  }
  if (options["args-stdin"]) {
    const text = readFileSync(0, "utf8");
    options.base ??= /--base(?:=|\s+)(\S+)/.exec(text)?.[1];
    options.name ??= /--name(?:=|\s+)(\S+)/.exec(text)?.[1];
  }
  return options;
}

// Never blocks: an explicit name wins, then the first work ID in the branch name, then the branch name itself.
function manifestName(explicit, branch) {
  if (explicit) return explicit.replace(/\.xml$/, "");
  if (!branch)
    return `detached-${gitOut(["rev-parse", "--short=8", "HEAD"]).trim()}`;
  return WORK_ID.exec(branch)?.[0] ?? branch.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function packageDirectories() {
  if (!existsSync("sfdx-project.json"))
    throw new Error("sfdx-project.json not found at the repository root");
  return JSON.parse(
    readFileSync("sfdx-project.json", "utf8")
  ).packageDirectories.map((dir) => dir.path);
}

function forceIgnored(paths) {
  if (!paths.length || !existsSync(".forceignore")) return new Set();
  const excludes = join(process.cwd(), ".forceignore");
  const result = git(
    [
      "-c",
      `core.excludesFile=${excludes}`,
      "check-ignore",
      "--no-index",
      "-z",
      "--stdin"
    ],
    paths.join("\0")
  );
  return new Set(nulList(result.stdout));
}

function bundleDirectory(file) {
  const parts = file.split("/");
  for (let i = parts.length - 3; i >= 0; i--) {
    if (!BUNDLE_FOLDERS.has(parts[i])) continue;
    const dir = parts.slice(0, i + 2).join("/");
    return existsSync(dir) && statSync(dir).isDirectory() ? dir : null;
  }
  return null;
}

function changedPaths(mergeBase, filter, dirs) {
  return nulList(
    gitOut([
      "diff",
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

function sourcePaths(mergeBase, dirs) {
  const changed = changedPaths(mergeBase, "ACMT", dirs);
  const untracked = nulList(
    gitOut(["ls-files", "--others", "--exclude-standard", "-z", "--", ...dirs])
  );
  const deleted = changedPaths(mergeBase, "D", dirs);
  const ignored = forceIgnored(deleted);
  const bundles = deleted
    .filter((file) => !ignored.has(file))
    .map(bundleDirectory)
    .filter(Boolean);
  return [...new Set([...changed, ...untracked, ...bundles])].sort();
}

// A file's content at a given ref, or null when the file did not exist there (new file, or `git show` miss).
function atRef(ref, path) {
  const result = git(["show", `${ref}:${path}`]);
  return result.status === 0 ? result.stdout : null;
}

// fullName -> a canonical string of its compared fields, so two labels compare equal only when every
// tracked field matches; categories is sorted first since its element order carries no meaning.
function parseLabels(xml) {
  const labels = new Map();
  if (!xml) return labels;
  for (const [, block] of xml.matchAll(/<labels>([\s\S]*?)<\/labels>/g)) {
    const fullName = /<fullName>([^<]*)<\/fullName>/.exec(block)?.[1];
    if (!fullName) continue;
    const categories = [...block.matchAll(/<categories>([^<]*)<\/categories>/g)]
      .map((m) => m[1])
      .sort();
    const fields = LABEL_FIELDS.map(
      (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)?.[1] ?? ""
    );
    labels.set(fullName, JSON.stringify([categories, ...fields]));
  }
  return labels;
}

// Compares each labels file's merge-base version against its current version (or absence, for a file
// deleted outright) so the manifest can list individual labels instead of the whole file.
function labelChanges(mergeBase, files) {
  const changed = new Set();
  const deleted = [];
  for (const file of files) {
    const before = parseLabels(atRef(mergeBase, file));
    const after = parseLabels(existsSync(file) ? readFileSync(file, "utf8") : null);
    for (const [fullName, value] of after)
      if (before.get(fullName) !== value) changed.add(fullName);
    for (const fullName of before.keys())
      if (!after.has(fullName)) deleted.push(fullName);
  }
  return { members: [...changed].sort(), deleted: deleted.sort() };
}

// sf lists every label currently in a touched file under CustomLabel, plus a CustomLabels member for the
// whole file. Replace the former with only the labels this branch added or changed, and drop the latter
// unconditionally: deploying it would deploy every label in the file, and sf gives it only one generic
// member ("CustomLabels") shared across every touched file, so it can never be scoped to just the new ones.
function applyLabelScope(xml, changedMembers) {
  if (!xml || !/<name>CustomLabel<\/name>/.test(xml)) return xml;
  let result = xml.replace(
    / {4}<types>\n {8}<members>CustomLabels<\/members>\n {8}<name>CustomLabels<\/name>\n {4}<\/types>\n/,
    ""
  );
  const block = changedMembers.length
    ? `    <types>\n${changedMembers
        .map((member) => `        <members>${member}</members>`)
        .join("\n")}\n        <name>CustomLabel</name>\n    </types>\n`
    : "";
  result = result.replace(
    / {4}<types>\n(?: {8}<members>[^<]*<\/members>\n)* {8}<name>CustomLabel<\/name>\n {4}<\/types>\n/,
    block
  );
  return /<types>/.test(result) ? result : null;
}

// Runs the Salesforce CLI resolver; a path it cannot map to a metadata type is dropped and the run repeats.
function generate(paths, outDir) {
  let remaining = paths;
  const skipped = [];
  while (remaining.length) {
    const args = [
      "project",
      "generate",
      "manifest",
      "--json",
      "--output-dir",
      outDir,
      "--name",
      "package.xml"
    ];
    const result = spawnSync(
      "sf",
      [...args, ...remaining.flatMap((p) => ["--source-dir", p])],
      {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        maxBuffer: MAX_BUFFER
      }
    );
    if (result.error) throw new Error(`cannot run sf: ${result.error.message}`);
    if (result.status === 0)
      return {
        xml: readFileSync(join(outDir, "package.xml"), "utf8"),
        skipped
      };
    let message = result.stderr.trim();
    try {
      message = JSON.parse(
        result.stdout.replace(/\x1b\[[0-9;]*m/g, "")
      ).message;
    } catch {
      // Non-JSON output: report stderr as-is.
    }
    const absolute = UNINFERABLE.exec(message ?? "")?.[1];
    const bad =
      absolute &&
      remaining.find((p) => absolute.endsWith(sep + p.split("/").join(sep)));
    if (!bad)
      throw new Error(`sf project generate manifest failed: ${message}`);
    skipped.push(bad);
    remaining = remaining.filter((p) => p !== bad);
  }
  return { xml: null, skipped };
}

function members(xml) {
  const found = [];
  for (const [, block] of (xml ?? "").matchAll(/<types>([\s\S]*?)<\/types>/g)) {
    const type = /<name>([^<]+)<\/name>/.exec(block)[1];
    for (const [, member] of block.matchAll(/<members>([^<]+)<\/members>/g))
      found.push(`${type}: ${member}`);
  }
  return found;
}

function section(title, items, note = "") {
  const heading = `${title} (${items.length})${note && ` — ${note}`}:`;
  return items.length ? [heading, ...items.map((item) => `  ${item}`)] : [];
}

function run() {
  const options = readOptions();
  process.chdir(gitOut(["rev-parse", "--show-toplevel"]).trim());
  const branch = gitOut(["branch", "--show-current"]).trim();
  const name = manifestName(options.name, branch);
  const mergeBase = resolveMergeBase(options.base, branch);
  const target = join(options["output-dir"], `${name}.xml`);
  const dirs = packageDirectories();
  const paths = sourcePaths(mergeBase.sha, dirs);
  const deletedLabelFiles = changedPaths(mergeBase.sha, "D", dirs).filter((file) =>
    LABELS_FILE.test(file)
  );
  const labelFiles = [
    ...new Set([...paths.filter((file) => LABELS_FILE.test(file)), ...deletedLabelFiles])
  ];
  const labels = labelChanges(mergeBase.sha, labelFiles);
  const scratch = mkdtempSync(join(tmpdir(), "branch-manifest-"));
  let generated;
  try {
    generated = generate(paths, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const xml = applyLabelScope(generated.xml, labels.members);
  const current = members(xml);
  const previous = existsSync(target) ? readFileSync(target, "utf8") : null;
  let status = "not written; no Salesforce metadata was added or modified";
  if (current.length) {
    status =
      previous === null ? "created" : previous === xml ? "unchanged" : "updated";
    if (status !== "unchanged") {
      mkdirSync(options["output-dir"], { recursive: true });
      writeFileSync(target, xml);
    }
  }
  const lines = [
    `Manifest: ${target} ${status}`,
    `Base: ${mergeBase.ref}, merge-base ${mergeBase.sha.slice(0, 8)}`
  ];
  lines.push(...section("Components", current));
  lines.push(
    ...section(
      "Deleted custom labels",
      labels.deleted.map((label) => `CustomLabel: ${label}`),
      "removed from source since the merge-base; needs a destructive-change entry"
    )
  );
  if (previous !== null && current.length) {
    const before = members(previous);
    lines.push(
      ...section(
        "Added since the previous version of the file",
        current.filter((m) => !before.includes(m))
      )
    );
    const dropped = before.filter((m) => !current.includes(m));
    lines.push(
      ...section(
        "Dropped since the previous version of the file",
        dropped,
        "no longer changed on this branch, or added to the file by hand"
      )
    );
  }
  const skippedNote =
    "the Salesforce CLI does not recognize these files as metadata, so a deploy ignores them too";
  lines.push(...section("Skipped", generated.skipped, skippedNote));
  return lines.join("\n");
}

try {
  process.stdout.write(`${run()}\n`);
} catch (error) {
  process.stdout.write(`Error: ${error.message}\n`);
}
