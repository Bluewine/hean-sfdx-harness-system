---
name: merge-pr
description: Merge-commit PR merger (GitHub CLI) — merges an approved pull request with a merge commit whose subject starts with the PR title's @WORK-ID, rebuilt from the repository's own default message, with no hand-edited message, then starts the open UAT release PR update after a merge into `integration`
when_to_use: The user asks to merge a pull request, such as "merge this PR <url>" or "merge <url>". The skill takes a PR URL only. Pass the PR URL, and `--work-id <ID>` only after the user supplied the work ID.
argument-hint: "<PR URL> [--work-id <ID>]"
allowed-tools: Bash(node *merge-pr.mjs*)
---

# Merge PR

GitHub has no setting for a custom merge commit message. This skill merges the PR with a merge commit whose subject starts with the PR's work ID. Invoking it with a PR URL is the request to merge: ask no confirmation question.

## Steps

1. Run `node "${CLAUDE_SKILL_DIR}/scripts/merge-pr.mjs" <PR URL>` once, adding `--work-id <ID>` only when the user supplied it. When the request has no PR URL, ask the user for it in one question first.
   - Use `AskUserQuestion` when it is available.
   - Inside a subagent, reply `needs input: PR URL`.
2. Exit 0: report the merged subject and SHA in one or two lines. When the output starts with `Queued:`, report that the PR entered the merge queue with that subject. Relay a `NOTE:` line.
   - Relay the `UAT PR:` line when there is one.
   - Only when that line is exactly `UAT PR: <PR URL>`, run `/hean-harness:env-release-pr uat <PR number>` with the Skill tool and follow that skill to its end, including its questions and the `yes` it waits for before submitting. The PR number is the number after `/pull/` in that URL.
   - Otherwise stop.
3. Exit 2 with `REFUSED: no work ID`: tell the user the PR title has no `@WORK-ID:` prefix and ask for the work ID in one question.
   - Use `AskUserQuestion` when it is available.
   - Inside a subagent, reply `needs input: work ID — the PR title has no @WORK-ID: prefix`.
   - On an answer, run step 1 again with `--work-id <ID>`.
   - Never guess the ID from the branch name.
4. Exit 2 with `REFUSED: invalid work ID` after an answer from the user: ask for the work ID once more, then run step 1 again.
5. Any other exit 2: relay the `REFUSED:` line word for word and stop.
6. Exit 1: relay the `ERROR:` line and stop.

## Refusal reasons

- **Not open:** the PR state is not `OPEN`.
- **Draft:** the PR is a draft.
- **Not approved:** `reviewDecision` is not `APPROVED`. A repository without required reviews leaves `reviewDecision` empty, so the skill refuses there.
- **No work ID:** the PR title has no `@WORK-ID:` prefix.

## Rules

- **Direct merge:** never call `gh pr merge` directly.
- **No retry:** never retry a refused merge with other flags.
- **Title:** never edit the PR title.
