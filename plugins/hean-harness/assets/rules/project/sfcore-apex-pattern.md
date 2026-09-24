---
paths:
  - "force-app/main/**/*.cls"
---

# SFCORE Apex Pattern

> `ACME_` stands in for whatever class prefix the project uses. Set one during setup and it
> is read from the project's local settings; leave it unset and no prefix is enforced.

Apply these rules **every time** an Apex class is created or edited — no exceptions.

## Step 0 — Retrieve SFCORE classes (MANDATORY, always first)

Read the `alias` of the org whose `role` is `development` in `.claude/hean-harness.json` (see `org-roles.md`). Run the retrieve with that alias written out as text, and wait for completion before any other action:

```bash
sf project retrieve start --metadata "ApexClass:SFCORE*" --ignore-conflicts -o <alias>
```

When no org is saved with the `development` role, stop and report that to the user or caller.

Skip only if SFCORE classes were already retrieved earlier in the same session.

## Step 1 — Delete SFCORE classes after task completion (MANDATORY, always last)

Once all Apex work is complete and verified, delete all retrieved SFCORE files from the working tree:

```bash
git ls-files --others --exclude-standard force-app/main/default/classes/SFCORE_* \
  | xargs rm -f
```

This removes only **untracked** SFCORE files (those retrieved but never committed). Tracked files are not affected.

Skip only if no SFCORE files are present in the working tree (`git status` shows no `SFCORE_*` untracked files).

## Architecture

```
@AuraEnabled Controller  →  Service  →  ACME_RepoFactory  →  SFCORE_IRepository
```

## Central Factory — `ACME_Factory`

Add one `virtual` provisioning method per service. Do **not** create a per-object factory.

```apex
public virtual class ACME_Factory {
    public ACME_RepoFactory repoFactory { get; set; }

    @TestVisible
    private static ACME_Factory factory;

    protected ACME_Factory() {
        this.repoFactory = new ACME_RepoFactory();
    }

    public static ACME_Factory getFactory() {
        factory = factory == null ? new ACME_Factory() : factory;
        return factory;
    }

    public virtual MyObjectService getMyObjectService() {
        return new MyObjectService(this);
    }

    @TestVisible
    private ACME_Factory withMocks {
        get {
            this.repoFactory.setFacade(new SFCORE_RepoFactoryMock.FacadeMock());
            return this;
        }
    }
}
```

## Service Layer

**Naming:** Follow `apex-naming-conventions.md` — all service classes carry the `ACME_` prefix (e.g. `ACME_UserService`, `ACME_WorkOrderService`). Abbreviate when total length exceeds 30 chars (e.g. `ACME_ServiceAppointmentSvc`). Inner classes are plain PascalCase with no prefix.

```apex
public virtual class MyObjectService {

    private ACME_Factory factory;

    public MyObjectService(ACME_Factory factory) {
        this.factory = factory;
    }

    public virtual List<MyObject__c> getRecentThree() {
        List<Schema.SObjectField> fields = new List<Schema.SObjectField>{
            MyObject__c.Id,
            MyObject__c.Name,
            MyObject__c.Status__c
        };

        return (List<MyObject__c>) factory.repoFactory
            .getRepo(MyObject__c.SObjectType, fields)
            .addSortOrder(MyObject__c.Name, SFCORE_RepositorySortOrder.DESCENDING)
            .setLimit(3)
            .getAll();
    }
}
```

### Query API — `SFCORE_IRepository`

| Method | Purpose |
|---|---|
| `.getAll()` | Fetch all records (no WHERE clause) |
| `.get(SFCORE_Query query)` | Fetch with one filter |
| `.get(List<SFCORE_Query> queries)` | Fetch with multiple filters (AND) |
| `.addSortOrder(SObjectField, SFCORE_RepositorySortOrder)` | Append ORDER BY clause |
| `.setLimit(Integer)` | Append LIMIT clause |

`getAll()` / `get()` must be the terminal call.

### Building filter conditions — `SFCORE_Query`

```apex
// Single condition
SFCORE_Query.equals(MyObject__c.Status__c, 'Active')

// Compound
SFCORE_Query.andQuery(
    SFCORE_Query.equals(MyObject__c.Status__c, 'Active'),
    SFCORE_Query.greaterThan(MyObject__c.CreatedDate, someDate)
)

SFCORE_Query.orQuery(q1, q2)
```

### Sort order constants — `SFCORE_RepositorySortOrder`

```apex
SFCORE_RepositorySortOrder.ASCENDING
SFCORE_RepositorySortOrder.DESCENDING

// With null handling
new SFCORE_RepositorySortOrder(
    SFCORE_RepositorySortOrder.SortOrder.DESCENDING,
    SFCORE_RepositorySortOrder.NullSortOrder.LAST
)
```

## Inner Class Ordering

Declare all inner classes at the bottom of the outer class. Order them by first appearance in the source — the class whose name appears earliest in a method signature or return type is declared first.

```apex
// ✅ AppointmentTableResult appears first at line 123, AppointmentRow at 286,
//    EnrichmentContext at 286 (after AppointmentRow), ColumnDef at 400
public class AppointmentTableResult { ... }
public class AppointmentRow         { ... }
@TestVisible private class EnrichmentContext { ... }
public class ColumnDef              { ... }

// ❌ Wrong — declared in reverse or arbitrary order
@TestVisible private class EnrichmentContext { ... }
public class ColumnDef              { ... }
public class AppointmentRow         { ... }
public class AppointmentTableResult { ... }
```

## Controller Layer

```apex
public with sharing class ACME_MyCtrl {

    @AuraEnabled(cacheable=true)
    public static List<MyObject__c> getRecentThree() {
        try {
            return ACME_Factory.getFactory()
                .getMyObjectService()
                .getRecentThree();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage() + '\n\n' + e.getStackTraceString());
        }
    }
}
```

## Testing

### Controller test — stub the service

```apex
@IsTest
private class ACME_MyCtrlTest {

    @IsTest
    static void test_getRecentThree_returnsStubData() {
        MyObjectService mockSvc = (MyObjectService) new SFCORE_Stub.Builder(MyObjectService.class)
            .mockingMethodCall('getRecentThree')
            .withParameterTypes()
            .returning(new List<MyObject__c>{ new MyObject__c(), new MyObject__c() })
            .defineStub()
            .createStub();
        ACME_Factory.factory = new MockFactory(mockSvc);

        Test.startTest();
        List<MyObject__c> results = ACME_MyCtrl.getRecentThree();
        Test.stopTest();

        System.assertEquals(2, results.size());
    }

    @IsTest
    static void test_getRecentThree_wrapsExceptionAsAura() {
        MyObjectService mockSvc = (MyObjectService) new SFCORE_Stub.Builder(MyObjectService.class)
            .mockingMethodCall('getRecentThree')
            .withParameterTypes()
            .throwingException(new System.TypeException('Simulated failure'))
            .defineStub()
            .createStub();
        ACME_Factory.factory = new MockFactory(mockSvc);

        Test.startTest();
        try {
            ACME_MyCtrl.getRecentThree();
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null);
        }
        Test.stopTest();
    }

    private class MockFactory extends ACME_Factory {
        private MyObjectService mockService;
        public MockFactory(MyObjectService svc) { this.mockService = svc; }
        public override MyObjectService getMyObjectService() { return this.mockService; }
    }
}
```

### Service test — exercise the repo mock

```apex
@IsTest
static void test_getRecentThree_queriesRepoSortedDesc() {
    List<MyObject__c> mockData = new List<MyObject__c>{
        new MyObject__c(),
        new MyObject__c(),
        new MyObject__c()
    };
    SFCORE_TestUtilities.generateIds(mockData);
    SFCORE_RepoFactoryMock.QueryResults.addAll(mockData);

    ACME_Factory factory = ACME_Factory.getFactory().withMocks;

    Test.startTest();
    List<MyObject__c> results = factory.getMyObjectService().getRecentThree();
    Test.stopTest();

    System.assertEquals(3, results.size());
    System.assertEquals(
        SFCORE_RepositorySortOrder.DESCENDING,
        SFCORE_RepoFactoryMock.FieldToSortOrders
            .get(MyObject__c.SObjectType)
            ?.get('Name'),
        'Should sort by Name DESC'
    );
}
```

### `SFCORE_RepoFactoryMock` reference

| Member | Type | Purpose |
|---|---|---|
| `QueryResults` | `List<SObject>` | Seed records returned by `.get()` / `.getAll()`, filtered by SObjectType |
| `QueriesMade` | `List<SFCORE_Query>` | Tracks filter objects passed to `.get(queries)`. Always empty for `.getAll()` — do not assert on its size for unfiltered queries |
| `FieldToSortOrders` | `Map<SObjectType, Map<String, SFCORE_RepositorySortOrder>>` | Tracks sort orders applied via `.addSortOrder()`. Key is the field API name |
| `FacadeMock` | Inner class | Injected via `factory.repoFactory.setFacade(new SFCORE_RepoFactoryMock.FacadeMock())` |

### `SFCORE_TestFactory` gotcha

`SFCORE_TestFactory.createSObjectList` requires a standard `Name` field — do **not** use it for `ServiceAppointment`, `Task`, `Event`, or any Name-less SObject. Build those lists manually:

```apex
// ✅ Safe for any SObject type
List<ServiceAppointment> mockData = new List<ServiceAppointment>{
    new ServiceAppointment(),
    new ServiceAppointment()
};
SFCORE_TestUtilities.generateIds(mockData);

// ✅ Only safe for SObjects with a standard Name field
List<Account> mockAccounts = SFCORE_TestFactory.createSObjectList(new Account(), 3);
SFCORE_TestUtilities.generateIds(mockAccounts);
```

## Checklist

- [ ] **SFCORE classes retrieved first** — `sf project retrieve start --metadata "ApexClass:SFCORE*" --ignore-conflicts -o <alias>` ran and completed before any other action (alias of the `development` org per Step 0)
- [ ] **SFCORE classes deleted after task** — all untracked `SFCORE_*` files removed from working tree before committing
- [ ] No direct SOQL in service or controller
- [ ] No `fflib_SObjectSelector`, `fflib_QueryFactory`, or `ISelector` interface
- [ ] Service constructor takes `ACME_Factory` (not a custom per-object factory)
- [ ] New service provisioned via a `virtual` method on `ACME_Factory`
- [ ] Query built with `factory.repoFactory.getRepo(SObjectType, fields)` chain
- [ ] Controller test uses `SFCORE_Stub.Builder` + `MockFactory extends ACME_Factory`
- [ ] Service test uses `ACME_Factory.getFactory().withMocks` + `SFCORE_RepoFactoryMock.QueryResults`
- [ ] Mock data for Name-less SObjects built manually, not via `SFCORE_TestFactory.createSObjectList`
- [ ] Sort order verified via `SFCORE_RepoFactoryMock.FieldToSortOrders`, not `QueriesMade.size()`
- [ ] Apex class names validated with `apex-naming-conventions` skill before creation
- [ ] Inner classes declared at the bottom of the outer class, ordered by first appearance in source
