// Finds the branch's base branch and merge-base commit. Shared by
// branch-manifest and coverage-split, so both scripts scope their own diff
// to the same commit a branch actually forked from.
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

export const MAX_BUFFER = 64 * 1024 * 1024;
// Base branch names tried after the branch's recorded creation source and origin's default branch.
export const COMMON_BASES = ["integration", "develop", "main", "master"];
// Work IDs such as ABC-123; the first one in a branch name names the story. branch-manifest and the
// per-story manifest commit check both read it from here, so both name the same file.
export const WORK_ID = /[A-Z][A-Z0-9]*-\d+/;

// The error a call with a deadline throws once the deadline has passed; its deadline property is true.
export const deadlineError = () =>
  Object.assign(new Error("the deadline passed"), { deadline: true });

// The error a call with a deadline throws when the system cannot start its program; its spawnFailed property
// is true, so the per-story manifest check runs branch-manifest as its own process instead, as it always did,
// and a start that fails for every program reads as it always read. A program that is not on PATH (ENOENT) or
// cannot be run (EACCES) fails the same way in either process, so that error goes on as it is.
export const spawnError = (error) =>
  ["ENOENT", "EACCES"].includes(error.code) ? null : Object.assign(new Error(error.message), { spawnFailed: true });

// options (all optional): cwd and env, the folder and environment git runs with, this process's own by
// default; common, the absolute common git directory, when the caller knows it; deadline, a time in milliseconds since the epoch past which the call stops and throws
// deadlineError(). branch-manifest passes them when it runs inside the per-story manifest check.
export function git(args, input, { cwd, env, deadline } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input,
    maxBuffer: MAX_BUFFER,
    cwd,
    env,
    ...(deadline ? { timeout: Math.max(1, deadline - Date.now()) } : {})
  });
  if (deadline && result.error?.code === "ETIMEDOUT") throw deadlineError();
  if (deadline && result.error && spawnError(result.error)) throw spawnError(result.error);
  return result;
}

export function gitOut(args, options) {
  const result = git(args, undefined, options);
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function nulList(text) {
  return text.split("\0").filter(Boolean);
}

export function refExists(ref, options) {
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], undefined, options)
      .status === 0
  );
}

// The reflog's oldest entry records the ref a local branch was created from, when it names one.
export function creationSource(branch, options) {
  if (!branch) return null;
  const entries = git([
    "reflog",
    "show",
    "--format=%gs",
    `refs/heads/${branch}`
  ], undefined, options)
    .stdout.trim()
    .split("\n");
  const source = /^branch: Created from (.+)$/.exec(
    entries[entries.length - 1] ?? ""
  )?.[1];
  const name = source
    ?.replace(/^refs\/(heads|remotes)\//, "")
    .replace(/^origin\//, "");
  return name && name !== "HEAD" && name !== branch && refExists(source, options)
    ? name
    : null;
}

// options.common, when given, is the repository's absolute common git directory. Without the reftable
// storage, a symbolic ref is only ever a loose file there (git never packs one), so nothing at that path
// means no origin default, the answer symbolic-ref would give, without starting git. lstat, not exists:
// with core.preferSymlinkRefs the ref is a symbolic link whose target does not resolve as a path.
const present = (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
export function originDefault(options) {
  const common = options?.common;
  if (common && !present(join(common, "reftable")) && !present(join(common, "refs", "remotes", "origin", "HEAD")))
    return null;
  const result = git([
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD"
  ], undefined, options);
  return result.status === 0
    ? result.stdout.trim().replace(/^origin\//, "")
    : null;
}

// The refs that name a commit, in order: one git call for all of them, as refExists answers each.
// A name holding a newline cannot be one line of cat-file's input, so it is asked on its own.
function existingRefs(refs, options) {
  if (!refs.length || refs.some((ref) => ref.includes("\n")))
    return refs.filter((ref) => refExists(ref, options));
  const types = git(
    ["cat-file", "--batch-check=%(objecttype)"],
    refs.map((ref) => `${ref}^{commit}\n`).join(""),
    options
  ).stdout.split("\n");
  return refs.filter((_, i) => types[i] === "commit");
}

// Every candidate is tried as origin/<name> and <name>; the newest merge-base wins, so a stale local
// branch never drags merged work into the diff, and an older trunk loses to the branch actually cut from.
export function resolveMergeBase(explicit, branch, options) {
  const names = explicit
    ? [explicit]
    : [creationSource(branch, options), originDefault(options), ...COMMON_BASES];
  const refs = [
    ...new Set(
      names
        .filter((name) => name && name !== branch)
        .flatMap((name) => [`origin/${name}`, name])
    )
  ];
  let best = null;
  for (const ref of existingRefs(refs, options)) {
    const sha = git(["merge-base", "HEAD", ref], undefined, options).stdout.trim();
    if (!sha) continue;
    const newer =
      !best ||
      (sha !== best.sha &&
        git(["merge-base", "--is-ancestor", best.sha, sha], undefined, options)
          .status === 0);
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
