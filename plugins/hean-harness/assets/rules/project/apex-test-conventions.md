---
paths:
  - "force-app/**/test/**/*.cls"
  - "force-app/**/tests/**/*.cls"
  - "force-app/**/*Test.cls"
---

# Apex Test Conventions

> `ACME_` stands in for whatever class prefix the project uses. Set one during setup and it
> is read from the project's local settings; leave it unset and no prefix is enforced.

Apply these rules **every time** an Apex test class is created, edited, extended, or reviewed — no exceptions.


## Test Data Setup

- Create test records via `SFCORE_TestFactory.createSObject(sObject, insertNow)`.
- Use `@testSetup` for shared data setup shared across multiple test methods.
- Coverage threshold is **100%** (enforced in CI).


## Org-Independent Test Data

A record inserted with no `RecordTypeId` takes the running user's default record type, and a field
left empty takes the default that record type or the field defines. Both are org configuration. CI
runs tests as a deploy user whose profile can differ in every org, so a test that passes on one
pipeline org fails with `REQUIRED_FIELD_MISSING` or `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` on
the next.

- **Record type:** Set `RecordTypeId` on every test record of an object that has record types.
  Resolve it by developer name, never by label or hardcoded ID:
  `Schema.SObjectType.WorkType.getRecordTypeInfosByDeveloperName().get('Administrative').getRecordTypeId()`.
- **Required fields:** Set every required field explicitly, including every required picklist. Never
  rely on a record type default or a field default.
- **Restricted picklists:** Use a value the chosen record type allows. Read it from that record
  type's `<picklistValues>` in `force-app/**/objects/<Object>/recordTypes/<RecordType>.recordType-meta.xml`.
  When the record type is not in source, retrieve it from the development org before choosing.
- **Shared helpers:** Apply these rules to every helper and `@testSetup` method that inserts records.
  Copy an existing helper's record type and values only after checking them against these rules.
- **Branch build:** A pass on one pipeline org does not prove the test is org-independent. Check the
  record type and required fields of each inserted record before committing.

```apex
// ❌ Depends on the running user's default record type and its Category__c default
new WorkType(Name = 'Submitted Work Type', EstimatedDuration = 1, DurationType = 'Hours');

// ✅ Same result in every org
Id adminRt = Schema.SObjectType.WorkType.getRecordTypeInfosByDeveloperName()
    .get('Administrative').getRecordTypeId();
new WorkType(Name = 'Submitted Work Type', EstimatedDuration = 1, DurationType = 'Hours',
             RecordTypeId = adminRt, Category__c = 'HVAC');
```


## Controller Tests — `SFCORE_Stub.Builder` + `MockFactory` pattern

Use `SFCORE_Stub.Builder` to mock the service and inject it via a private `MockFactory` that extends `ACME_Factory`:

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


## Service Tests — `withMocks` + `SFCORE_RepoFactoryMock` pattern

Use `ACME_Factory.getFactory().withMocks` to wire `SFCORE_RepoFactoryMock`, then call the service directly:

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


## `SFCORE_RepoFactoryMock` Reference

| Member | Type | Purpose |
|---|---|---|
| `QueryResults` | `List<SObject>` | Seed records returned by any `.get()` / `.getAll()` call, filtered by SObjectType |
| `QueriesMade` | `List<SFCORE_Query>` | Tracks `SFCORE_Query` filter objects passed to `.get(queries)`. **Always empty when using `.getAll()`** — do not assert on its size for unfiltered queries |
| `FieldToSortOrders` | `Map<SObjectType, Map<String, SFCORE_RepositorySortOrder>>` | Tracks sort orders applied via `.addSortOrder()`. Key is the field API name |
| `FacadeMock` | Inner class | Injected via `factory.repoFactory.setFacade(new SFCORE_RepoFactoryMock.FacadeMock())` |


## `SFCORE_TestFactory` Gotcha

`SFCORE_TestFactory.createSObjectList` resolves the `Name` field to make each record unique. Objects that **do not have a `Name` field** (e.g. `ServiceAppointment`, `Task`, `Event`) will throw a `NullPointerException`. For those objects, construct the list manually:

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

- [ ] Test data created via `SFCORE_TestFactory.createSObject` or built manually for Name-less SObjects
- [ ] Shared setup uses `@testSetup`
- [ ] Every inserted record of an object with record types sets `RecordTypeId` by developer name
- [ ] Every required field and required picklist is set explicitly, with a value its record type allows
- [ ] Controller test uses `SFCORE_Stub.Builder` + private `MockFactory extends ACME_Factory`
- [ ] Service test uses `ACME_Factory.getFactory().withMocks` + `SFCORE_RepoFactoryMock.QueryResults`
- [ ] Mock data for Name-less SObjects (`ServiceAppointment`, `Task`, `Event`) built manually, not via `SFCORE_TestFactory.createSObjectList`
- [ ] Sort order verified via `SFCORE_RepoFactoryMock.FieldToSortOrders`, not `QueriesMade.size()`
- [ ] Coverage at or above **100%***