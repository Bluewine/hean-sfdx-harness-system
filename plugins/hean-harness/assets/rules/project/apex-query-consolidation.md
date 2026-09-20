---
paths:
  - "**/*.cls"
---

# Apex Query Consolidation

Apply before writing any line that builds or executes a database query in a `.cls` file — no exceptions.

## Core Principle

One query per logical dataset. Never issue a second query when the result can be derived from a list already fetched.

## Rule 1 — Identify the logical dataset first

Before writing a query, name the logical set of records it targets (e.g. "open work orders for this account", "upcoming appointments this week"). If a query for that same logical dataset was already issued earlier in the same execution path, stop — derive from the existing list instead.

## Rule 2 — Derive, not re-query, when one set is a subset of another

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

## Rule 3 — Build once, derive multiple metrics from the same list

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

## Rule 4 — Include all required fields in one query

Identify every field needed by every downstream metric before issuing the query. Never query the same SObject a second time just to access a field omitted from the first query.

## Rule 5 — Service methods that serve the same caller return a list, not a scalar

When two or more metrics about the same dataset are needed by the same caller, the service method returns `List<SObject>` (sorted and field-complete). The caller derives scalars. Do not create a parallel method that re-queries for a single scalar.

## Rule 6 — Count via `.size()`, not a separate aggregate query

Never issue a `SELECT COUNT()` solely to count records already queryable as a list, unless the list itself would exceed heap limits (>50 000 records). Use `.size()` on the fetched list.

## Rule 7 — Order field lists: Id first, then alphabetically

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
- [ ] Is there already a query for this logical dataset earlier in this execution path?
- [ ] Is this dataset a strict subset of a dataset already queried? If yes — derive, don't re-query.
- [ ] Are all fields needed by downstream metrics included in this single query?
- [ ] Are all metrics for this dataset computable in one pass over the result list?
- [ ] Is a service method about to be created that duplicates a query already issued by the caller?
- [ ] Field list: `Id` first, remaining fields alphabetical?