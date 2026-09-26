#!/usr/bin/env node
// Prints Jest line coverage for the files this branch changed, separate from
// the files it did not touch, so a whole-suite run never charges a branch for
// a coverage gap someone else already left behind. "Changed" is read from the
// working tree as it sits right now — a file only staged, only edited, or
// never added at all still counts, exactly like a fully committed one.
// Reads <repo-root>/coverage/coverage-summary.json, which
// `npx jest --coverage --coverageReporters=json-summary` writes there.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  gitOut,
  nulList,
  resolveMergeBase
} from "../../../scripts/lib/merge-base.mjs";

const NO_SUMMARY =
  "No coverage summary found — run npx jest --coverage --coverageReporters=json-summary first.";
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
  const mergeBase = resolveMergeBase(undefined, branch);
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

function row(label, count, stats, note = "") {
  if (count === 0) return `${label} (0): —`;
  const pctText = `${((stats.covered / stats.total) * 100).toFixed(1)}%`;
  const prefix = `${label} (${count}):`;
  const pad = Math.max(1, WIDTH - prefix.length - pctText.length);
  return `${prefix}${" ".repeat(pad)}${pctText}${note}`;
}

function run(root) {
  const summaryPath = join(root, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) return NO_SUMMARY;
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const changed = changedFiles();
  const changedStats = { total: 0, covered: 0, count: 0 };
  const untouchedStats = { total: 0, covered: 0, count: 0 };
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const relPath = isAbsolute(file) ? relative(root, file) : file;
    addLines(changed.has(relPath) ? changedStats : untouchedStats, data);
  }
  if (changedStats.count === 0)
    return row("Files this branch changed", 0, changedStats);
  const uncovered = untouchedStats.total - untouchedStats.covered;
  const note =
    uncovered > 0
      ? `   ← ${uncovered} uncovered line${
          uncovered === 1 ? "" : "s"
        }, not from this branch`
      : "";
  const wholeStats = {
    total: changedStats.total + untouchedStats.total,
    covered: changedStats.covered + untouchedStats.covered,
    count: changedStats.count + untouchedStats.count
  };
  return [
    row("Files this branch changed", changedStats.count, changedStats),
    row(
      "Files this branch did not touch",
      untouchedStats.count,
      untouchedStats,
      note
    ),
    row("Whole repository", wholeStats.count, wholeStats)
  ].join("\n");
}

const root = gitOut(["rev-parse", "--show-toplevel"]).trim();
process.stdout.write(`${run(root)}\n`);
