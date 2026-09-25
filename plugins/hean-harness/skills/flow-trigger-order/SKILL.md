---
name: flow-trigger-order
description: Record-triggered flow run-order report for an SFDX repository — groups flows sharing an object and trigger timing, shows each one's trigger order value, ties, missing-order flows, and any AsyncAfterCommit or scheduled paths, in the platform's actual run order
argument-hint: "[ObjectApiName]"
allowed-tools: ["Bash"]
---

# Flow trigger order

Report which record-triggered flows in this SFDX repository share an object and trigger timing.
Show the order the platform runs them in.

Arguments: $ARGUMENTS

## Steps

1. Run the listing script from the repository root, passing the object API name from the arguments above when
   one was given:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-trigger-order.mjs" <ObjectApiName>
   ```

   Leave the object name off to list every object.

2. Report the output as printed. A group of two or more flows lists each flow's trigger order,
   whether it ties with another flow in the group, and any async or scheduled paths it declares —
   that is the output the review needs. A group with only one flow is printed as a single
   compact line.

## Rules

- Never change a flow. This skill only reads and reports.
- When the output says there is no force-app/ folder, report that and stop.
