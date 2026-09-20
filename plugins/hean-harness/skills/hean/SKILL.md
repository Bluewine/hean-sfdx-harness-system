---
name: hean
description: Prompt wrapper for superpowers:brainstorming — appends three fixed answer rules (search-verified current information, drafting only in the final answer, no mannered prose) to the user's prompt and inlines the brainstorming skill at load time with no relay call
when_to_use: The user's message needs reasoning before acting or answering — a new story, feature, or behavior change to implement; a bug, failure, or unexpected result to investigate, debug, or explain; a technical question about how, why, or which option; a design, plan, architecture, or approach to evaluate; a long or multi-part request. When unsure whether a message needs reasoning, invoke it. Invoke it in place of superpowers:brainstorming, never both, and pass the user's full message verbatim as args. Skip it for a single fully specified mechanical action (run a named command, commit, show git status, open a file, invoke another named skill), for replies inside a session this skill already started (answers to clarifying questions, approvals, corrections), and when the message already starts with /hean or /superpowers:brainstorming.
argument-hint: "<prompt>"
allowed-tools: Bash(sh *hean/inject.sh*)
---

```!
sh "${CLAUDE_SKILL_DIR}/inject.sh"
```

ARGUMENTS: $ARGUMENTS

# UN-NEGOTIABLE USER'S REQUIRED RULES

## MANDATORY GLOBAL RULES REGARDLESS OF THE SCENARIO
- Always search to verify the latest information, even when you already know the content.
- While thinking, only decide the structure and key points. Write the final document only in the final answer.
- Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still matters," they write "this point earns its keep." The phrases exist to display the writer, not to convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase is available, use it. The golden rule: **Please do not use and always remove all mannered prose** when writing answers, providing overview, analysis, report, summary, anything to the user or consulting agent.

## RULES WHEN MODIFYING CODEBASE
- Do not fix unrelated issues you encounter. Complete the requested task first, then report any unrelated issues you identified. Only make changes necessary to resolve the requested issue.
- If the same result can be achieved with targeted changes, do not rewrite the entire file. Modify only the necessary sections.

## RULES WHEN WRITING TESTS
- Verify that the modified functionality works as expected. Do not create separate test files just for verification. If tests are explicitly requested or the project already maintains tests of the same type, add/modify only the tests necessary and follow the existing testing conventions.

## RULES FOR WORKFLOW
- Before starting, state the task in one sentence. Provide brief progress updates while working. When finished, summarize what you verified and completed. Remember: **Please do not use and always remove all mannered prose**.
- Complete the requested work. If part is blocked, finish everything else and report what could not be completed and why. Remember: **Please do not use and always remove all mannered prose**.
- I cannot respond while work is in progress. Do not re-ask for information already provided. Ask all necessary questions at the start.

Fallback: if `HEAN_INJECT_FAILED` or `[shell command execution disabled by policy]` appears above in place of the brainstorming instructions, invoke superpowers:brainstorming with the prompt and the three rules above as args.
