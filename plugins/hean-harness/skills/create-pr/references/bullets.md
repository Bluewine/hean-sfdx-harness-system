# "What was Done?" Bullet Rules

Release champions and reviewers read these bullets. They glance at each one for a few seconds. Each bullet tells them one thing the system now does differently. The story link carries the why and what the app's user gains.

## Main bullets

These rules apply to every main bullet under "What was Done?", new or kept.

### Sources, in order

1. Read the story's `ISSUE_DESCRIPTION` first. List the problems or requests it describes.
2. Read the subjects of the story's main-bucket commits. Decide which listed problems this branch solved. Add any extra problem the commits clearly solve.
3. Open the main-bucket files to confirm what a commit subject leaves unclear. A design spec or plan among the changed files may be read for this. A change found only by opening the files gets a bullet when a reviewer must know it.

When the sources disagree, the files win:

- Write what the branch does, even where it differs from the acceptance criteria or goes further than the description.
- Write no bullet for a described item the branch does not deliver.
- Write no bullet for a change a commit subject claims and the files do not contain.

### Bullet count

- Write one bullet per behaviour change a reviewer must know: a new condition, a new place a value is stored, a new failure or guard, a removal.
- Merge several file changes that make one behaviour change into one bullet.
- Merge several conditions that together decide one behaviour into one bullet: "Copy only when the Work Order is new or its Subject changed and is not blank."
- Give conditions that lead to different results their own bullets: one bullet for the records set Active, one for the records set Inactive.
- Write at most 10 bullets per story, not counting the fixed bullets. This cap outranks the other rules in this section. When a story has more behaviour changes, merge the changes to one screen, one job or one set of access changes into one bullet, and merge a guard into the bullet of the behaviour it guards. When a merge would make a bullet longer than 20 words, keep that bullet separate, even past 10.
- A guard or failure the change adds gets its own bullet.
- A post-deploy script that changes data gets a bullet like any other change.
- Write no bullet for changes whose net effect is zero, such as a guard removed by one commit and restored by a later one.
- Describe the branch's final state. When a later commit replaces a rule, label or message, write only the final one.
- A commit with no file changes gets no bullet.
- A test class or a translation file belongs to the behaviour it tests or translates. It gets no bullet of its own.
- Files matching no requirement (`.claude/` files, docs, specs, plans, `README.md`) → one trailing bullet: "Project configuration was updated." This fixed bullet keeps this exact text and is exempt from the Sentence form rules below.

### Content

- State only what the system now does. Write no "so …" clause and no outcome for the app's user; the story link carries both.
- Name data and records by their business labels: "Work Type", "Work Order Origin", "Primary Vendor". A setting used as a condition is named by its label too: "while Use Active Work Types Only is on".
- Write an API name, in backticks, only when the bullet is about that artifact itself: a custom metadata type that now stores a value; a custom metadata type or record, permission set, profile, field or tab the change adds or whose access changes; or a component the change deletes, which is always named by its API name. A new class or flow that does the work is the implementing component and is never named.
- Never name the flow, class or component that implements the change.
- Quote a value the app's user sees only when it is a few words, such as "<no-subject>" or a button label. Describe a longer message instead: "Explain in the refusal message that another user may have reopened a line item."
- The visible order or placement of fields is behaviour, not technique: "Place Subject directly above Description on each card."
- Describe no technique: no line, method body, query text, CSS rule or attribute value, and no "added a class" or "moved the query".
- State the fact, not a defense of it. A bullet never argues against a hypothetical reviewer objection.

### Sentence form

- Write one imperative sentence of 8 to 20 words, ending with a period. An API name counts as one word.
- Start with an imperative verb, the same form as a commit subject: "Check", "Store", "Show", "Remove".
- Start a bullet with "Stop" only when the change refuses or halts something: "Stop a Work Order file upload when the Work Order is closed."
- Start any other guard or failure with the verb for what happens:
  - a skip: "Leave a record unchanged when no Active Work Type shares its Name."
  - partial success: "Keep updating the other Work Orders when one Work Order fails to save."
  - clean-up after a refusal: "Delete the refused files from the Work Order after a file upload is stopped."
- Start a removal with "Remove" or "Delete": "Remove the one-time `ABC_WorkTypeActiveBackfill` job that set Work Type Active."
- Use no semicolon. Use plain words: no jargon, no idiom, no figurative phrase.

### Example

A story where vendor portal work orders must not get a Primary Vendor assigned automatically:

- Right: "Check both the Work Type and the Work Order Origin before skipping the Primary Vendor assignment."
- Right: "Store the portal origin in the existing `ABC_VendorPortal_WO_Request_WorkType__mdt`."
- Right: "Stop the vendor portal work order submission when this custom metadata is not configured."
- Right: "Project configuration was updated."
- Wrong, outcome clause and implementing flow named: "Skip Primary Service Provider routing in `ABC_Work_Order_Before_Save` only for portal submissions, so vendor portal work orders stay unassigned"
- Wrong, outcome clause: "Route portal-work-type work orders that other users create, so requests created on a vendor's behalf now get a provider"
- Wrong, outcome clause: "Store the portal origin in `ABC_VendorPortal_WO_Request_WorkType__mdt`, so a missing setting now stops portal submissions before saving"

A story that restricts who may create Work Types:

- Right: "Remove Work Type create, edit and delete access from `ABC_Manager` and `ABC_Technician_Permission_Set`."
- Right: "Add the `ABC_Work_Type_View` permission set with read-only access to all Work Type records and fields."
- Wrong, implementing component named: "Update `ABC_WorkTypeService` to check the new permission set before saving"

## Sonar Fixes bullets

These bullets are technical notes for developers. None of the main-bullet rules above apply to them.

- Write one short past-tense bullet per commit, derived from the commit subject.
- Wrap identifiers in backticks under the identifier convention below.
- Merge two commits into one bullet only when they clearly describe the same fix.

## Framework Changes bullets

These bullets are technical notes for developers. None of the main-bullet rules above apply to them.

- Group all files serving the same intent into a single bullet, even across metadata types. Write one bullet per distinct change.
- **Roll up internal details of a net-new artifact.** When a file is an internal detail of another file in the same set that is itself net-new (status `A`) — a new LWC's own CSS/HTML/test files, a helper class created solely for a new component, an attribute or markup change inside a component being added for the first time — describe it within that artifact's own bullet, not as a separate bullet. Give a change its own bullet only when it is a capability a reviewer needs to evaluate independently (e.g. a shared service class other callers depend on, a distinct object/profile/permission change).
- Each bullet is a short past-tense phrase describing what was accomplished, not what files changed.
- Wrap identifiers in backticks under the identifier convention below.
- Verb selection from net status: `A` → **Add**/**Create**/**Introduce** (describe the capability, not an incremental change); `M` → **Update**/**Extend**/**Migrate** (describe what changed). When a bullet groups both `A` and `M` files, the verb follows the primary artifact's status.
- **State the fact, not a defense of it.** A bullet reports what changed; it does not pre-empt or argue against a hypothetical reviewer objection (e.g. no "...so this is expected, not a leftover file" framing). If a design choice genuinely needs explaining (e.g. why a change is split across two files), state the reason plainly and stop — don't editorialize about how it should be perceived.

## Identifier convention

Wrap any Salesforce API identifier in backticks (field references, object names used technically, metadata artifact names, Apex/Flow/Label/LWC names). Plain-English Salesforce concepts ("permission set", "record type", "flow") stay unformatted.
