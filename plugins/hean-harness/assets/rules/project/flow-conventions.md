---
paths:
  - "force-app/main/**/*.flow-meta.xml"
---

# Salesforce Flow Conventions

Apply these rules **every time** a flow is built, edited, adjusted, or modified — no exceptions.

## Metadata requirements

Every flow file must include the following fields. **Element order matters** — Salesforce serializes flow XML in alphabetical tag order. Writing elements out of order causes the Flow Builder to ignore `AUTO_LAYOUT_CANVAS` and display the flow in free-form layout instead. Always place elements in the order shown below (alphabetical among siblings):

```xml
<apiVersion>65.0</apiVersion>
<areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
<!-- ... assignments, customErrors, decisions, loops, recordLookups, recordUpdates ... -->
<environments>Default</environments>        <!-- required; alphabetically after flow elements -->
<label>...</label>                          <!-- alphabetically after environments -->
<processMetadataValues>
    <name>BuilderType</name>
    <value><stringValue>LightningFlowBuilder</stringValue></value>
</processMetadataValues>
<processMetadataValues>
    <name>CanvasMode</name>
    <value><stringValue>AUTO_LAYOUT_CANVAS</stringValue></value>   <!-- always auto-layout -->
</processMetadataValues>
<processMetadataValues>
    <name>OriginBuilderType</name>
    <value><stringValue>LightningFlowBuilder</stringValue></value>
</processMetadataValues>
<processType>AutoLaunchedFlow</processType> <!-- or Screen, RecordTriggered, etc. -->
<!-- ... start, status, triggerOrder, variables ... -->
<triggerOrder>1500</triggerOrder>            <!-- record-triggered flows; starting value, the trigger order review suggests the final one -->
```

## Fault path pattern

Every element that can fault (`recordLookups`, `recordUpdates`, `recordCreates`, `recordDeletes`, `actionCalls`) **must** have a `faultConnector`. Never leave a fault path unconnected. Do **not** include `<isGoTo>` on fault connectors — Salesforce strips it on retrieve and its presence can cause deployment drift. **`subflows` do NOT accept a `faultConnector`** — the Flow metadata schema rejects it (deploy error: *Element faultConnector invalid at this location in type FlowSubflow*). A called subflow must handle its own faults internally (write an error-log record and end normally); the caller cannot catch a subflow fault.

```xml
<faultConnector>
    <targetReference>Check_Error_Type</targetReference>
</faultConnector>
```

The fault connector's **target depends on execution context**:

| Flow context (by `TriggerType`) | Fault routing |
|---|---|
| Synchronous record-triggered (before/after-save) | `Check_Error_Type` → `Show_Error_to_User` (custom error) |
| Standalone screen flow (`TriggerType: None`, has screens) | plain **error Screen** displaying `{!$Flow.FaultMessage}` |
| Standalone autolaunched (`TriggerType: None`, no screens) | error-log record |
| Async-path, platform-event-triggered, subflow | error-log record |

`TriggerType` is the discriminator, not "screen vs record". The custom-error pattern applies only to a synchronous record-triggered flow, where blocking the transaction is the intent. A standalone screen flow — any flow whose `TriggerType` is `None` — **cannot use `customErrors`**: the platform rejects them at deploy time (`A flow can't include Custom Error elements when TriggerType is set to None`), so surface the fault on a plain error Screen instead. Autolaunched, async-path, platform-event, and subflow contexts have no user to surface to, so persist the fault to an error-log record.

### Custom-error pattern (synchronous record-triggered flows)

Include these shared nodes in every such flow. Two error paths both converge on `Show_Error_to_User`:

- **Technical fault** (`Flow_Error` rule): `$Flow.FaultMessage` is set → `Set_Flow_Error` → `Show_Error_to_User`
- **Business error** (`No Fault` default): developer has added messages to the `Errors` collection → `Loop_Errors` → `Flatten_Custom_Error` → `Show_Error_to_User`

The `Errors` string collection variable is the intentional error channel. Flow logic explicitly adds to it when something invalid happens that is not a technical exception (e.g. validation failures, missing config). After the main flow completes without a fault, the No Fault branch loops `Errors`, flattens them into the single `Error` string via a formula, then surfaces the result through the same `Show_Error_to_User` node.

```xml
<!-- 1. Decision — routes technical faults vs business errors -->
<decisions>
    <name>Check_Error_Type</name>
    <label>Check Error Type</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <defaultConnector>
        <targetReference>Loop_Errors</targetReference>  <!-- No Fault → business error path -->
    </defaultConnector>
    <defaultConnectorLabel>No Fault</defaultConnectorLabel>
    <rules>
        <name>Flow_Error</name>
        <conditionLogic>and</conditionLogic>
        <conditions>
            <leftValueReference>$Flow.FaultMessage</leftValueReference>
            <operator>IsNull</operator>
            <rightValue><booleanValue>false</booleanValue></rightValue>
        </conditions>
        <connector><targetReference>Set_Flow_Error</targetReference></connector>
        <label>Flow Error</label>
    </rules>
</decisions>

<!-- 2. Assignment — captures the technical fault message -->
<assignments>
    <name>Flatten_Custom_Error</name>
    <label>Flatten Custom Error</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <assignmentItems>
        <assignToReference>Error</assignToReference>
        <operator>Assign</operator>
        <value>
            <!-- Formula: prefix with newline only when Error is already non-empty -->
            <elementReference>Error_Concat_Formula</elementReference>
        </value>
    </assignmentItems>
    <connector><targetReference>Loop_Errors</targetReference></connector>
</assignments>

<assignments>
    <name>Set_Flow_Error</name>
    <label>Set Flow Error</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <assignmentItems>
        <assignToReference>Error</assignToReference>
        <operator>Assign</operator>
        <value><elementReference>$Flow.FaultMessage</elementReference></value>
    </assignmentItems>
    <connector><targetReference>Show_Error_to_User</targetReference></connector>
</assignments>

<!-- 3. Custom error — surfaces the message (reached from both paths) -->
<customErrors>
    <name>Show_Error_to_User</name>
    <label>Show Error to User</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <customErrorMessages>
        <errorMessage>{!Error}</errorMessage>
        <isFieldError>false</isFieldError>
    </customErrorMessages>
</customErrors>

<!-- 4. Formula — concatenates current loop item onto Error with a newline separator -->
<formulas>
    <name>Error_Concat_Formula</name>
    <dataType>String</dataType>
    <expression>IF(ISBLANK({!Error}), {!Loop_Errors}, {!Error} &amp; BR() &amp; {!Loop_Errors})</expression>
</formulas>

<!-- 5. Loop — iterates over the Errors business-error collection -->
<loops>
    <name>Loop_Errors</name>
    <label>Loop Errors</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <collectionReference>Errors</collectionReference>
    <iterationOrder>Asc</iterationOrder>
    <nextValueConnector>
        <targetReference>Flatten_Custom_Error</targetReference>
    </nextValueConnector>
    <noMoreValuesConnector>
        <targetReference>Show_Error_to_User</targetReference>
    </noMoreValuesConnector>
</loops>

<!-- 6. Variables -->
<variables>
    <name>Error</name>           <!-- single flattened string shown to the user -->
    <dataType>String</dataType>
    <isCollection>false</isCollection>
    <isInput>false</isInput>
    <isOutput>false</isOutput>
    <value><stringValue></stringValue></value>
</variables>

<variables>
    <name>Errors</name>          <!-- collection populated by flow logic for business errors -->
    <dataType>String</dataType>
    <isCollection>true</isCollection>
    <isInput>false</isInput>
    <isOutput>false</isOutput>
</variables>
```

### Error-Screen pattern (standalone screen flows, `TriggerType: None`)

A standalone screen flow cannot use `customErrors` (see the table). Route every faultable element's `faultConnector` to a plain error Screen that shows the fault message and ends the flow — no `Check_Error_Type`, no `customErrors`, no `Errors` collection.

```xml
<screens>
    <name>Screen_Error</name>
    <label>Error</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <allowBack>false</allowBack>
    <allowFinish>true</allowFinish>
    <allowPause>false</allowPause>
    <fields>
        <name>Error_Message</name>
        <fieldText>&lt;p&gt;{!$Flow.FaultMessage}&lt;/p&gt;</fieldText>
        <fieldType>DisplayText</fieldType>
    </fields>
    <showFooter>true</showFooter>
    <showHeader>true</showHeader>
</screens>
```

For a business error the flow detects itself (a validation, not a technical exception), route to a Screen whose DisplayText reads from the flow's own message variable instead of `{!$Flow.FaultMessage}`.

### Error-log pattern (async-path, platform-event, and subflow flows)

**Find the org's error-log object before writing any of this.** This pattern persists a record, so it needs an object to persist into, and which one that is belongs to the org rather than to Salesforce. Ask the connected org rather than assuming:

```bash
sf sobject list --sobject CUSTOM -o <alias> | grep -iE 'exception|error|log'
```

`Exception_Log__c` is the usual name and the one used throughout the examples below. When the org has a differently named object, substitute it along with its own field names. When the org has none, stop and ask which object to use, or whether to add one — never invent a name, and never fall back to leaving the fault path unconnected, which is the one outcome this rule exists to prevent.

Each faultable element's `faultConnector` targets an assignment that builds an error-log record from `$Flow.FaultMessage` and adds it to an `Errors` collection; a single `recordCreates` persists the collection near the flow's end (gate it with a `Has_Errors` decision so nothing runs when empty). In subflows there is no `$Record` — use the `recordId` input variable for the record-reference field. The flow never raises a custom error.

```xml
<assignments>
    <name>Collect_Flow_Error</name>
    <label>Collect Flow Error</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <assignmentItems>
        <assignToReference>Error.Error_Message__c</assignToReference>
        <operator>Assign</operator>
        <value><elementReference>$Flow.FaultMessage</elementReference></value>
    </assignmentItems>
    <assignmentItems>
        <assignToReference>Error.RecordId__c</assignToReference>
        <operator>Assign</operator>
        <value><elementReference>$Record.Id</elementReference></value>
    </assignmentItems>
    <assignmentItems>
        <assignToReference>Error.Application__c</assignToReference>
        <operator>Assign</operator>
        <value><stringValue>Field Service</stringValue></value>
    </assignmentItems>
    <assignmentItems>
        <assignToReference>Errors</assignToReference>
        <operator>Add</operator>
        <value><elementReference>Error</elementReference></value>
    </assignmentItems>
    <connector><targetReference>Has_Errors</targetReference></connector>
</assignments>

<recordCreates>
    <name>Log_Errors</name>
    <label>Log Errors</label>
    <locationX>0</locationX>
    <locationY>0</locationY>
    <inputReference>Errors</inputReference>
</recordCreates>

<variables>
    <name>Error</name>
    <dataType>SObject</dataType>
    <isCollection>false</isCollection>
    <isInput>false</isInput>
    <isOutput>false</isOutput>
    <objectType>Exception_Log__c</objectType>
</variables>

<variables>
    <name>Errors</name>
    <dataType>SObject</dataType>
    <isCollection>true</isCollection>
    <isInput>false</isInput>
    <isOutput>false</isOutput>
    <objectType>Exception_Log__c</objectType>
</variables>
```

## Entry criteria filters

When adding `IsChanged` filters to a record-triggered flow's `<start>` element, order the `<filters>` blocks alphabetically by `<field>` name. This is consistent with the overall alphabetical XML ordering rule and keeps diffs clean when fields are added or removed.

```xml
<!-- Correct: alphabetical by field name -->
<filters>
    <field>Account__c</field>
    <operator>IsChanged</operator>
    <value><booleanValue>true</booleanValue></value>
</filters>
<filters>
    <field>Certification_Expiration_Date__c</field>
    <operator>IsChanged</operator>
    <value><booleanValue>true</booleanValue></value>
</filters>
<filters>
    <field>Location__c</field>
    <operator>IsChanged</operator>
    <value><booleanValue>true</booleanValue></value>
</filters>
```

Update `<filterLogic>` to match the number of filters (e.g. `1 OR 2 OR 3`).

### Flows carrying a date-driven scheduled path

A record-triggered flow whose `<start>` declares a scheduled path anchored on a record date field is governed by two prohibitions. Violating either fails silently — the flow stops re-entering, the pending path is never rescheduled, and no error surfaces anywhere.

- **Never set "only when a record is updated to meet the condition requirements"** (`doesRequireRecordChangedToMeetCriteria`). With an always-true entry filter the criteria never transition from unmet to met, so the flow never re-enters on update. Salesforce reschedules a pending scheduled path only when the flow re-enters, so a date moved after the first save is silently ignored.
- **Never add an `IsChanged` filter.** It cannot coexist with a date-driven scheduled path.

Such a flow must stay on **Created and Updated** with its entry filter left unrestricted. That combination is what lets the platform reschedule a pending path when its date moves and cancel it when the date is cleared.

## Trigger order review

Apply once a record-triggered flow is finished: after it is created, or after its trigger timing, entry criteria or record writes change. Never run the review while the flow is still being written.

The review covers the synchronous paths of flows triggered by the same object. The platform runs flows on one object and one trigger timing in this order: `triggerOrder` 1–1000 ascending, then flows with no `triggerOrder` by created date, then 1001–2000 ascending. Flows with equal values run in API-name order. Every before-save flow runs before every after-save flow, so a dependency between them needs no `triggerOrder`. `triggerOrder` has no effect on asynchronous or scheduled paths.

1. Run `/hean-harness:flow-trigger-order <Object> --flow <FlowApiName>` for the finished flow.
2. Confirm each dependency the listing prints by reading the flow files, and add any it missed. The listing matches field references in the XML, so a match can be wrong.
3. Work out the allowed range from all dependencies together:
   - after every flow that writes a field the finished flow reads
   - before every flow that reads a field the finished flow writes
4. Suggest a `triggerOrder`:
   - With no flow required after it, place it after the last related flow. A related flow shares a field with the finished flow, directly or through other flows on the same object and timing.
   - Otherwise, place it in the middle of the allowed range.
   - With no related flow, keep its current `triggerOrder`; the order does not matter.
   - When a flow next to the suggested position has no `triggerOrder`, report that flow instead of a number.
   - When a flow must run both before and after the finished flow, report that the two depend on each other; no `triggerOrder` resolves it.
   - With an empty range or no free value, name the existing flows that would need renumbering.
5. When two flows write the same field, name the one that runs later; it sets the final value.
6. Name every existing flow on the same object and timing that already runs before a flow whose written field it reads. Leave Draft and Obsolete flows out of every step; they do not run.
7. Report to the user as a table: each dependency, the field, each flow's current `triggerOrder`, and the suggested value. A subagent puts the table in its final message. Change no `triggerOrder`, on any flow, until the user answers.

## Context restrictions by trigger type

The platform rejects each construct below at deploy time. These are restrictions, not conventions.

| Context | Restriction |
|---|---|
| Platform-event-triggered | Cannot call a `subflows` element at all. Inline the logic; a shared helper must be an invocable Apex action instead. |
| Before-delete record-triggered | Cannot write setup objects (`Group`, `GroupMember`, `User`, permission assignments). Publish a platform event and let a subscriber perform the write. `$Record` field values **are** readable in this context. |

## Decision branch layout

**Nested decisions** — where a decision's continuation branch leads into further decision logic deeper down (any depth, with or without intervening non-decision nodes) — must **alternate the branch side that carries the non-empty continuation logic at each nesting level**. Place the continuation on the rule branch at one level, then on the `defaultConnector` at the next, flip-flopping all the way down, so the active path zig-zags vertically instead of extending to one side. This prevents horizontal scrolling in `AUTO_LAYOUT_CANVAS`. Mechanically, invert the decision's condition polarity at alternating levels so the continuation swaps between the rule branch and the default branch.

Do **not** apply this to **vertical decisions** — a linear chain where every branch reconverges on the next single node or decision. Those never grow sideways, so their branch sides need no alternation.

## Record-triggered flow checklist

Before deploying any record-triggered flow, confirm:

- [ ] `<label>` is present (positioned alphabetically, after `<environments>`)
- [ ] `<environments>Default</environments>` is present
- [ ] `AUTO_LAYOUT_CANVAS` is set in `processMetadataValues`
- [ ] XML elements are in **alphabetical order** (labels/processMetadata/processType after flow nodes, not at top)
- [ ] Every faultable element has `<faultConnector><targetReference>…</targetReference></faultConnector>` (no `<isGoTo>`) — but **not** on `subflows` (schema rejects it; subflows self-handle faults)
- [ ] Fault routing matches `TriggerType` (see the Fault path pattern table) — synchronous record-triggered → custom-error (`Check_Error_Type` → `Show_Error_to_User`); async-path record-triggered → error-log record. Standalone screen/autolaunched flows use the error-Screen / error-log patterns from that table (`customErrors` is invalid when `TriggerType` is `None`).
- [ ] Synchronous record-triggered (custom-error): fault paths converge on `Check_Error_Type`; `Loop_Errors` → `Flatten_Custom_Error`/`Show_Error_to_User`; `Error_Concat_Formula` present; `Error` (String) + `Errors` (String collection) declared
- [ ] Autolaunched/async/platform-event/subflow: fault paths build error-log records into an `Errors` collection persisted by one `Log_Errors` create; `Error` + `Errors` are variables of the org's error-log object
- [ ] The error-log object was confirmed to exist in the connected org before the pattern was written
- [ ] Trigger order review run after the flow was finished; dependency table reported to the user; no `triggerOrder` changed without the user's answer
- [ ] Nested decisions alternate the continuation branch side per level (vertical decisions exempt)
- [ ] `<status>Active</status>` is set
