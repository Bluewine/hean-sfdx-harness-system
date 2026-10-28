---
paths:
  - "**/*.cls"
---

# Apex Query Consolidation

Apply before writing any line that builds or executes a database query in a `.cls` file, and before writing any query method in a service class — no exceptions.

## Core Principle

Per transaction, identify the minimal superset: the smallest set of records that holds every record the transaction needs. Read it with one query whose WHERE clause holds only the filters that limit that set. Derive everything else from that list in code: segregation, derivation, identification, classification, grouping, categorisation, counting and other metrics. Decide which superset to read and how to split it case by case.

A transaction is one Apex transaction of any kind: a controller call from a component, a trigger run, one batch chunk, a button action.

## Rule 1 — Identify the records the transaction needs first

Before writing a query, name the set of records it targets (e.g. "open work orders for this account", "upcoming appointments this week"). If a query that already returns that set, or a superset of it, was issued earlier in the same transaction, stop — derive from the existing list instead.

## Rule 2 — Read the minimal superset with one query

Follow these steps for every transaction that uses more than one subset of the same object:

1. **List the subsets.** Write down every subset of records the transaction uses (e.g. "new work orders", "in-progress work orders", "overdue work orders").
2. **Shared filters limit the superset.** A filter that every subset shares limits the superset. Keep it in the WHERE clause.
3. **Remaining filters split in code.** A filter that only some subsets use splits the superset. Apply it in Apex over the fetched list, not in the WHERE clause, except where the cost check below joins it with `OR`.
4. **One query per superset.** Never issue one query per subset of a superset already read in the transaction.

**Cost check for subsets that share few records.** Subsets overlap when they share at least one limiting filter, even if they share few or no records. Use one superset query unless it reads clearly more rows than the subsets' own queries together. In that case, join the subsets' own filters with `OR` in one query where SOQL allows it, otherwise use the fewest queries that cover the subsets. Never use one query per subset when the subsets share a limiting filter.

Example: a transaction needs a user's open cases of any date plus the user's cases closed in the last 7 days. The two subsets share no records but overlap through the user filter, and a query with only the shared filter would read the user's whole case history.

```apex
// ✅ Fewest limited queries — one read covers both subsets, the split runs in code
List<Case> cases = [
    SELECT Id, ClosedDate, IsClosed, Status, Subject
    FROM Case
    WHERE CreatedById = :createdById
      AND (IsClosed = false OR ClosedDate = LAST_N_DAYS:7)
];
List<Case> openCases = new List<Case>();
List<Case> recentlyClosed = new List<Case>();
for (Case c : cases) {
    if (c.IsClosed) recentlyClosed.add(c); else openCases.add(c);
}

// ❌ Wrong — only the shared filter in the WHERE clause; reads every case the user ever created
List<Case> cases = [SELECT Id, ClosedDate, IsClosed FROM Case WHERE CreatedById = :createdById];

// ❌ Wrong — one query per subset of the same user's cases
List<Case> openCases      = [SELECT Id FROM Case WHERE CreatedById = :createdById AND IsClosed = false];
List<Case> recentlyClosed = [SELECT Id FROM Case WHERE CreatedById = :createdById AND ClosedDate = LAST_N_DAYS:7];
```

**Example (a) — several counts of one set in one operation.** Limiting filters: account and date window. Split in code: status category and priority.

```apex
// ✅ One query — every count comes from the same list
List<WorkOrder> workOrders = [
    SELECT Id, Priority, StatusCategory
    FROM WorkOrder
    WHERE AccountId = :accountId
      AND CreatedDate >= :windowStart AND CreatedDate < :windowEnd
];
Integer newCount = 0;
Integer inProgressCount = 0;
Integer highPriorityCount = 0;
for (WorkOrder wo : workOrders) {
    if (wo.StatusCategory == 'New') newCount++;
    if (wo.StatusCategory == 'InProgress') inProgressCount++;
    if (wo.Priority == 'High') highPriorityCount++;
}

// ❌ Wrong — one count query per category of the same account and window
Integer newCount        = [SELECT COUNT() FROM WorkOrder WHERE AccountId = :accountId AND CreatedDate >= :windowStart AND CreatedDate < :windowEnd AND StatusCategory = 'New'];
Integer inProgressCount = [SELECT COUNT() FROM WorkOrder WHERE AccountId = :accountId AND CreatedDate >= :windowStart AND CreatedDate < :windowEnd AND StatusCategory = 'InProgress'];
```

**Example (b) — a list of one user's submitted records split by status.** Limiting filters: record type, origin, creator and contact. Split in code: status.

```apex
// ✅ One query — the limiting filters stay in the WHERE clause, the status split runs in code
List<Case> submitted = [
    SELECT Id, CaseNumber, Status, Subject
    FROM Case
    WHERE RecordTypeId = :recordTypeId
      AND Origin = 'Web'
      AND CreatedById = :createdById
      AND ContactId = :contactId
];
Map<String, List<Case>> casesByStatus = new Map<String, List<Case>>();
for (Case c : submitted) {
    if (!casesByStatus.containsKey(c.Status)) casesByStatus.put(c.Status, new List<Case>());
    casesByStatus.get(c.Status).add(c);
}

// ❌ Wrong — one query per status for the same user's submitted cases
List<Case> newCases     = [SELECT Id FROM Case WHERE RecordTypeId = :recordTypeId AND Origin = 'Web' AND CreatedById = :createdById AND ContactId = :contactId AND Status = 'New'];
List<Case> workingCases = [SELECT Id FROM Case WHERE RecordTypeId = :recordTypeId AND Origin = 'Web' AND CreatedById = :createdById AND ContactId = :contactId AND Status = 'Working'];
```

## Rule 3 — Derive, not re-query, when one set is a subset of another

If set B shares the same base filters as set A and only adds an extra condition, B is a subset of A. Fetch A once with all necessary fields, then filter in Apex:

```apex
// ✅ One query — open WOs. Overdue is a subset (same base + DueDate < today).
List<WorkOrder> openWOs = [
    SELECT Id, LocationId, DueDate
    FROM WorkOrder
    WHERE Status NOT IN ('Closed', 'Completed', 'Cancelled')
      AND AccountId = :accountId
];

Integer overdue = 0;
Set<Id> locationIds = new Set<Id>();
Date today = Date.today();
for (WorkOrder wo : openWOs) {
    if (wo.LocationId != null) locationIds.add(wo.LocationId);
    if (wo.DueDate != null && wo.DueDate < today) overdue++;
}

// ❌ Wrong — two queries when overdue is already derivable from openWOs
Integer openCount    = [SELECT COUNT() FROM WorkOrder WHERE Status NOT IN ('Closed','Completed','Cancelled') AND AccountId = :accountId];
Integer overdueCount = [SELECT COUNT() FROM WorkOrder WHERE Status NOT IN ('Closed','Completed','Cancelled') AND AccountId = :accountId AND DueDate < TODAY];
```

## Rule 4 — Build once, derive multiple metrics from the same list

When a method must return multiple metrics about the same dataset (count, min/max value, aggregate), issue one query that fetches all needed fields. Compute every metric in a single pass over the result list.

```apex
// ✅ One query — count and next start time both come from the same sorted list
List<ServiceAppointment> upcoming = [
    SELECT Id, SchedStartTime
    FROM ServiceAppointment
    WHERE SchedEndTime >= :weekStart AND SchedEndTime < :weekEnd
      AND Status NOT IN ('Completed', 'Cancelled')
    ORDER BY SchedStartTime ASC
];

Integer count = upcoming.size();
Datetime nextStart = null;
Datetime now = Datetime.now();
for (ServiceAppointment sa : upcoming) {
    if (sa.SchedStartTime != null && sa.SchedStartTime >= now) {
        nextStart = sa.SchedStartTime;
        break;
    }
}

// ❌ Wrong — two queries when next start is derivable from the same sorted list
Integer count      = [SELECT COUNT() FROM ServiceAppointment WHERE ...];
Datetime nextStart = [SELECT SchedStartTime FROM ServiceAppointment WHERE SchedStartTime >= :now ... LIMIT 1][0].SchedStartTime;
```

## Rule 5 — Include all required fields in one query

Identify every field needed by every downstream metric before issuing the query. Never query the same SObject a second time just to access a field omitted from the first query.

## Rule 6 — Service methods that serve the same caller return a list, not a scalar

When two or more metrics about the same dataset are needed by the same caller, the service method returns `List<SObject>` (sorted and field-complete). The caller derives scalars. Do not create a parallel method that re-queries for a single scalar.

## Rule 7 — Count via `.size()`, not a separate aggregate query

Never issue a `SELECT COUNT()` solely to count records already queryable as a list. Use `.size()` on the fetched list.

- **Row limit:** 50,000 is the total number of records retrieved by SOQL queries across the whole transaction, synchronous or asynchronous — not a per-query figure.
- **Heap limit:** heap size is a separate limit: 10 MB synchronous, 25 MB asynchronous (https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm). A sandbox with the Apex setting "Enforce the Summer '26 Apex heap limit" turned on keeps 6 MB synchronous, 12 MB asynchronous until its production org upgrades. Read the limit in force with `Limits.getLimitHeapSize()`; never assume one figure.
- **When to count:** use `SELECT COUNT()` only when the list would not fit within those limits.

## Rule 8 — Limiting values are method parameters

A query method takes every limiting value as a parameter (`Id createdById`, `Id contactId`, a work type Id). Never read a limiting value inside the service (for example from `UserInfo`). A method that takes its values as parameters serves any caller and any test user.

```apex
// ✅ The caller passes the user; the service reads nothing from the running context
public List<WorkOrder> getSubmittedWorkOrders(Id createdById, Id contactId, Id workTypeId) {
    return [
        SELECT Id, Status, Subject, WorkOrderNumber
        FROM WorkOrder
        WHERE CreatedById = :createdById AND ContactId = :contactId AND WorkTypeId = :workTypeId
        WITH USER_MODE
    ];
}
// Controller: svc.getSubmittedWorkOrders(UserInfo.getUserId(), contactId, workTypeId);

// ❌ Wrong — the service reads the running user itself; no other caller or test user can reuse it
public List<WorkOrder> getSubmittedWorkOrders(Id contactId, Id workTypeId) {
    Id createdById = UserInfo.getUserId();
    // ...
}
```

## Rule 9 — A limiting filter is not access control

A user or contact filter reduces the rows read. It never replaces `with sharing` on the class or a user-mode query (`WITH USER_MODE`). Keep the filter and the sharing enforcement: the filter limits the superset, and sharing decides which of those records the running user may see.

## Rule 10 — Method name describes the records returned

A query method's name describes the records it returns, not its caller or the metric it feeds. A dataset named by its limiting filters is valid: `getSubmittedWorkOrders(Id createdById, …)` returns "work orders submitted by a given user". The caller (controller or orchestrator) derives metrics and combines results from several query methods.

| Wrong | Right |
|---|---|
| `getOverdueCountForDashboard()` | `getOverdueServiceAppointments()` |
| `getKpiOpenWorkItems()` | `getOpenWorkOrderServiceAppointments()` |
| `fetchMyWorkOrdersForPortal()` | `getSubmittedWorkOrders(Id createdById, Id contactId, Id workTypeId)` |

## Rule 11 — Order field lists: Id first, then alphabetically

In any `List<Schema.SObjectField>` declaration, place `Id` first and sort all remaining fields alphabetically by API name.

```apex
// ✅ Id first, then alphabetical
private static final List<Schema.SObjectField> saFields = new List<Schema.SObjectField>{
    ServiceAppointment.Id,
    ServiceAppointment.AppointmentNumber,
    ServiceAppointment.Description,
    ServiceAppointment.DueDate,
    ServiceAppointment.ParentRecordId,
    ServiceAppointment.SchedEndTime,
    ServiceAppointment.SchedStartTime,
    ServiceAppointment.Status,
    ServiceAppointment.Subject
};

// ❌ Wrong — arbitrary declaration order
private static final List<Schema.SObjectField> saFields = new List<Schema.SObjectField>{
    ServiceAppointment.Id,
    ServiceAppointment.ParentRecordId,
    ServiceAppointment.Subject,
    ServiceAppointment.Description,
    ServiceAppointment.Status,
    ServiceAppointment.SchedStartTime,
    ServiceAppointment.SchedEndTime,
    ServiceAppointment.DueDate
};
```

## Checklist

Before writing any query line:
- [ ] Is there already a query earlier in this transaction that returns this set or a superset of it?
- [ ] Have I listed every subset this transaction uses, kept only the shared filters in the WHERE clause, and split the rest in code?
- [ ] Is this dataset a strict subset of a dataset already queried? If yes — derive, don't re-query.
- [ ] If the subsets share few records, does the superset read clearly more rows than the subsets' own queries together? If yes — join their filters with `OR` where SOQL allows, otherwise use the fewest queries, never one per subset when they share a limiting filter.
- [ ] Are all fields needed by downstream metrics included in this single query?
- [ ] Are all metrics for this dataset computable in one pass over the result list?
- [ ] Is a service method about to be created that duplicates a query already issued by the caller?
- [ ] Is every limiting value (user, contact, work type) a method parameter, not read inside the service?
- [ ] Does the class still use `with sharing` or the query run in user mode, independent of any user or contact filter?
- [ ] Does the method name describe the records returned, not the caller or the metric?
- [ ] Field list: `Id` first, remaining fields alphabetical?
