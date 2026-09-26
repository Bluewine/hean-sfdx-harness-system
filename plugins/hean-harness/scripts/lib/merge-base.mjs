// Finds the branch's base branch and merge-base commit. Shared by
// branch-manifest and coverage-split, so both scripts scope their own diff
// to the same commit a branch actually forked from.
import { spawnSync } from "node:child_process";

export const MAX_BUFFER = 64 * 1024 * 1024;
// Base branch names tried after the branch's recorded creation source and origin's default branch.
export const COMMON_BASES = ["integration", "develop", "main", "master"];

export function git(args, input) {
  return spawnSync("git", args, {
    encoding: "utf8",
    input,
    maxBuffer: MAX_BUFFER
  });
}

export function gitOut(args) {
  const result = git(args);
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function nulList(text) {
  return text.split("\0").filter(Boolean);
}

export function refExists(ref) {
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0
  );
}

// The reflog's oldest entry records the ref a local branch was created from, when it names one.
export function creationSource(branch) {
  if (!branch) return null;
  const entries = git([
    "reflog",
    "show",
    "--format=%gs",
    `refs/heads/${branch}`
  ])
    .stdout.trim()
    .split("\n");
  const source = /^branch: Created from (.+)$/.exec(
    entries[entries.length - 1] ?? ""
  )?.[1];
  const name = source
    ?.replace(/^refs\/(heads|remotes)\//, "")
    .replace(/^origin\//, "");
  return name && name !== "HEAD" && name !== branch && refExists(source)
    ? name
    : null;
}

export function originDefault() {
  const result = git([
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD"
  ]);
  return result.status === 0
    ? result.stdout.trim().replace(/^origin\//, "")
    : null;
}

// Every candidate is tried as origin/<name> and <name>; the newest merge-base wins, so a stale local
// branch never drags merged work into the diff, and an older trunk loses to the branch actually cut from.
export function resolveMergeBase(explicit, branch) {
  const names = explicit
    ? [explicit]
    : [creationSource(branch), originDefault(), ...COMMON_BASES];
  const refs = [
    ...new Set(
      names
        .filter((name) => name && name !== branch)
        .flatMap((name) => [`origin/${name}`, name])
    )
  ];
  let best = null;
  for (const ref of refs.filter(refExists)) {
    const sha = git(["merge-base", "HEAD", ref]).stdout.trim();
    if (!sha) continue;
    const newer =
      !best ||
      (sha !== best.sha &&
        git(["merge-base", "--is-ancestor", best.sha, sha]).status === 0);
    if (newer) best = { ref, sha };
  }
  if (!best)
    throw new Error(
      `no base branch found (tried ${
        refs.join(", ") || "nothing"
      }); pass --base <branch>`
    );
  return best;
}
