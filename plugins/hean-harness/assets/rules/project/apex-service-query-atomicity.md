---
paths:
  - "**/*Svc.cls"
  - "**/*Service.cls"
---

# Apex Service Query Atomicity

Apply before writing any query method in a service class — no exceptions.

## Core Principle

A query method has exactly one logical dataset as its purpose. It never mixes caller-specific scoping, business-process filters, or cross-cutting concerns into the query itself.

## Rule 1 — One logical dataset per method

Name the dataset before writing the method. If the name requires "and" or "for [caller]", the method is doing too much. Split it.

- `getUpcomingServiceAppointments()` — one dataset: SAs scheduled to start this week
- `getOpenWorkOrderServiceAppointments()` — one dataset: SAs whose parent WOs are not closed
- `getUpcomingServiceAppointmentsForVendor(Id accountId)` — wrong: mixes dataset with caller scope

## Rule 2 — No caller-specific filters inside shared query methods

Scoping that belongs to a specific business process (vendor account filter, user filter, feature-flag-driven narrowing) must never be baked into a shared query method. The caller applies scoping on top of the base result.

```apex
// ✅ Atomic — returns the dataset, no caller scope
public List<ServiceAppointment> getUpcomingServiceAppointments() {
    Datetime weekStart = ...;
    Datetime weekEnd   = ...;
    return factory.repoFactory.getRepo(ServiceAppointment.SObjectType)
        .get(new SFCORE_Query(ServiceAppointment.SObjectType)
            .gte(ServiceAppointment.SchedStartTime, weekStart)
            .lt(ServiceAppointment.SchedStartTime, weekEnd));
}

// ❌ Wrong — vendor scope baked in; method is not reusable across business processes
public List<ServiceAppointment> getUpcomingServiceAppointments(Id vendorAccountId) {
    // ... adds ParentRecordId IN (WorkOrder WHERE Secondary_Service_Provider__c = :vendorAccountId)
}
```

## Rule 3 — Caller owns scoping and derivation

The orchestrator or controller layer is responsible for:
- Applying account/user/feature-flag scope to the result of a base query
- Deriving multiple metrics (count, aggregate, subset) from a single fetched list
- Combining results from multiple atomic query methods

```apex
// ✅ Orchestrator applies vendor scope after fetching atomic base result
List<ServiceAppointment> all = svc.getUpcomingServiceAppointments();
List<ServiceAppointment> vendorSas = filterByVendor(all, accountId);
Integer count = vendorSas.size();

// ❌ Wrong — service method returns vendor-scoped count directly, not reusable
Integer count = svc.countUpcomingForVendor(accountId);
```

## Rule 4 — Method name describes the dataset, not the consumer

The name must describe what records are returned, not who calls it or what business metric it feeds.

| Wrong | Right |
|---|---|
| `getKpiOpenWorkItems()` | `getOpenWorkOrderServiceAppointments()` |
| `getOverdueCountForDashboard()` | `getOverdueServiceAppointments()` |
| `fetchThisWeekForVendorPortal()` | `getUpcomingServiceAppointments()` |

## Checklist

Before writing any service query method:
- [ ] Can the method name be stated without "for [caller/process]"?
- [ ] Does the method apply zero caller-specific WHERE clauses?
- [ ] Would this method return useful results if called from a completely different feature?
- [ ] Is scoping (account, user, feature flag) left to the caller?