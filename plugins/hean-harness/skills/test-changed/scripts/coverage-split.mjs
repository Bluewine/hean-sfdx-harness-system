#!/usr/bin/env node
// Prints Jest line coverage for the files this branch changed, separate from
// the files it did not touch, so a whole-suite run never charges a branch for
// a coverage gap someone else already left behind. "Changed" is read from the
// working tree as it sits right now — a file only staged, only edited, or
// never added at all still counts, exactly like a fully committed one.
// Reads <repo-root>/coverage/coverage-summary.json, which
// `npx jest --coverage --coverageReporters=json-summary` writes there.
// `--since <epoch seconds>` names when this run's Jest started; a summary
// older than that is from an earlier run, left behind by a Jest run that
// stopped before writing coverage, and is refused.
// A path under .claude/worktrees/ is another branch's checkout and is never
// counted, even when the Jest run was not told to skip it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  gitOut,
  nulList,
  resolveMergeBase
} from "../../../scripts/lib/merge-base.mjs";

const NO_SUMMARY =
  "No coverage summary found — run npx jest --coverage --coverageReporters=json-summary first.";
const STALE_SUMMARY =
  "The coverage summary is older than this Jest run, so Jest stopped before writing coverage. No numbers are reported.";
const NO_BASE =
  "Base branch could not be found, so the split into changed and untouched files is skipped.";
const WORKTREES = ".claude/worktrees/";
// The line-coverage report is 53 columns wide; the percentage is right-aligned
// inside it so every line's number ends at the same column, whatever the
// label or the file count's width.
const WIDTH = 53;

// Every file that differs from the merge-base, plus every staged, unstaged, or
// untracked file. `git diff <merge-base>` alone already compares that commit
// against the working tree, so committed, staged, and unstaged changes all
// show up in one call; only untracked files need a second one.
function changedFiles() {
  const branch = gitOut(["branch", "--show-current"]).trim();
  let mergeBase;
  try {
    mergeBase = resolveMergeBase(undefined, branch);
  } catch {
    return null;
  }
  const diffed = nulList(gitOut(["diff", "--name-only", "-z", mergeBase.sha]));
  const untracked = nulList(
    gitOut(["ls-files", "--others", "--exclude-standard", "-z"])
  );
  return new Set([...diffed, ...untracked]);
}

function addLines(bucket, data) {
  bucket.total += data.lines.total;
  bucket.covered += data.lines.covered;
  bucket.count += 1;
}

// "—" when the group has no files, or its files have no lines to cover.
function row(label, stats, note = "") {
  const pctText =
    stats.count === 0 || stats.total === 0
      ? "—"
      : `${((stats.covered / stats.total) * 100).toFixed(1)}%`;
  const prefix = `${label} (${stats.count}):`;
  const pad = Math.max(1, WIDTH - prefix.length - pctText.length);
  return `${prefix}${" ".repeat(pad)}${pctText}${note}`;
}

function sinceArg() {
  const i = process.argv.indexOf("--since");
  return i >= 0 ? Number(process.argv[i + 1]) : null;
}

function run(root) {
  const summaryPath = join(root, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) return NO_SUMMARY;
  const since = sinceArg();
  if (since !== null && statSync(summaryPath).mtimeMs < since * 1000)
    return STALE_SUMMARY;
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const changed = changedFiles();
  const changedStats = { total: 0, covered: 0, count: 0 };
  const untouchedStats = { total: 0, covered: 0, count: 0 };
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const relPath = (isAbsolute(file) ? relative(root, file) : file)
      .split(sep)
      .join("/");
    if (relPath.startsWith(WORKTREES)) continue;
    addLines(changed?.has(relPath) ? changedStats : untouchedStats, data);
  }
  const wholeStats = {
    total: changedStats.total + untouchedStats.total,
    covered: changedStats.covered + untouchedStats.covered,
    count: changedStats.count + untouchedStats.count
  };
  const whole = row("Whole repository", wholeStats);
  if (changed === null) return [NO_BASE, whole].join("\n");
  const uncovered = untouchedStats.total - untouchedStats.covered;
  const note =
    uncovered > 0
      ? `   ← ${uncovered} uncovered line${
          uncovered === 1 ? "" : "s"
        }, not from this branch`
      : "";
  return [
    row("Files this branch changed", changedStats),
    row("Files this branch did not touch", untouchedStats, note),
    whole
  ].join("\n");
}

const root = gitOut(["rev-parse", "--show-toplevel"]).trim();
process.stdout.write(`${run(root)}\n`);
