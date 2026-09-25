---
name: flow-trigger-order
description: Record-triggered flow run-order report for an SFDX repository — groups flows sharing an object and trigger timing, shows each one's trigger order, ties, missing-order flows, declared field reads and writes, and async or scheduled paths, in the platform's actual run order, or places one flow with --flow
argument-hint: "[ObjectApiName] [--flow FlowApiName]"
allowed-tools: ["Bash"]
---

# Flow trigger order

Report which record-triggered flows in this SFDX repository share an object and trigger timing.
Show the order the platform runs them in.

Arguments: $ARGUMENTS

## Steps

1. Run the listing script from the repository root, passing the object API name from the arguments above when
   one was given, and `--flow <FlowApiName>` when the arguments name a flow to place:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow-trigger-order.mjs" <ObjectApiName> --flow <FlowApiName>
   ```

   Leave the object name off to list every object; leave `--flow` off to list every flow instead of
   placing one.

2. Report the output as printed. A group of two or more flows lists each flow's trigger order,
   whether it ties with another flow in the group, any async or scheduled paths it declares, and the
   fields it writes and reads, plus any existing order conflict between two flows in the group. A
   group with only one flow is printed as a single compact line. With `--flow`, report the named
   flow's predecessors, successors, related flows, allowed range and suggested triggerOrder as
   printed.
3. The reads and writes come from matching references in the flow's XML, not from tracing which
   elements actually run — say that each dependency must be confirmed in the flow files before it is
   acted on.

## Rules

- Never change a flow. This skill only reads and reports.
- When the output says there is no force-app/ folder, report that and stop.
