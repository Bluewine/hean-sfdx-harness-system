# Task List

Apply in every session and every subagent whenever work has two or more steps, whether or not a skill was invoked.

## Tools

- **Task tools**: Use `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet`.
- **Deferred loading**: When the Task tools appear only as deferred tool names, load them with `ToolSearch` query `select:TaskCreate,TaskUpdate,TaskList,TaskGet` before the first call.
- **Legacy tool**: Use `TodoWrite` only when the session lists it in place of the Task tools.
- **Missing tools**: When neither the Task tools nor `TodoWrite` is listed, state it in one line and continue without a task list.

## Rules

- **Create first**: Create one task per step before starting the first step.
- **Step source**: Create one task per plan task, skill checklist item or skill phase when a plan or skill supplies the steps.
- **Start marking**: Mark a task `in_progress` when its step starts.
- **Completion marking**: Mark a task `completed` as soon as its step ends. Never batch completions.
- **Discovered steps**: Add a task for a step discovered mid-run before starting it.
- **Single-step exception**: Skip the task list only when the request is one step, such as one command or one answer from one file read.
- **Ledger files**: Keep a ledger or progress file a skill requires in addition to the task list, never in place of it.
