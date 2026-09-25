# "What was Done?" Bullet Rules

Release champions read these bullets. They glance at each one for about one second. They need to know which problem was solved, not which part of the system changed. The story link serves the few readers who want more.

## Main bullets

These rules apply to every main bullet under "What was Done?", new or kept.

### Sources, in order

1. Read the story's `ISSUE_DESCRIPTION` first. List the problems or requests it describes.
2. Read the subjects of the story's main-bucket commits. Decide which listed problems this branch solved. Add any extra problem the commits clearly solve.
3. Open the main-bucket files only to confirm what a commit subject leaves unclear.

### Bullet count

- Write one bullet per problem solved or capability delivered, not one per change.
- Merge several changes that fix one problem into one bullet.
- Split one change that fixes two problems into two bullets.
- Target 1 to 5 bullets per story. A story that solves one problem gets one bullet.

### Content

- State what the issue was and that it is fixed, or what was delivered. Never state how the fix was applied.
- Describe no technique: no "added a class", "changed the CSS rule", "moved the query".
- Name things by what the app's user sees on the screen: "the Status dropdown", "the Save Changes button", "the appointment detail page". Use the story's own words for them when the story has them.
- Name a code element (class, field, flow, component) only when the story itself names that element as the problem, such as a ticket raised during code review. Otherwise name no class, file, method, field, CSS rule, component or metadata item.
- Wrap every code element a bullet names in backticks.
- State the fact, not a defense of it. A bullet never argues against a hypothetical reviewer objection, such as "...so this is expected, not a leftover file".
- Files matching no requirement (for example `.claude/` config) → one trailing bullet: "Project configuration was updated".

### Sentence form

- Keep each bullet to one line of at most 15 words, readable in one second.
- Write one sentence with a clear subject and verb: "Clicking beside Save Changes no longer saves the appointment".
- Use past tense, or the "no longer" or "now" form.
- Use no semicolon and no second clause that explains the fix.
- Use plain words: no jargon, no idiom, no figurative phrase.

### Example

Wrong — each bullet describes how the code changed:

- Removed the `slds-scrollable_none` class from the `rewsfsMyWorkDetailPage` content container, whose overflow clip cut off the open Status dropdown at the footer's top edge; the inner line-clamp usage of that class is unchanged
- Added a `save-changes-button` class to the service appointment Save Changes `c-wes-button` and an `.action-button, .save-changes-button { display: inline-block; }` rule

Right — each bullet states the problem that was fixed:

- The Status dropdown on the appointment detail page is no longer cut off
- Clicking beside Save Changes no longer saves the appointment
- Clicking beside the buttons on work order lines no longer triggers them

A story about code itself, where the story asks to stop a query running inside a loop:

- Right: "`AccountService` no longer queries inside a loop"
- Wrong: "Moved the SOQL query in `AccountService.getAccounts` above the for loop into a Map"

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
