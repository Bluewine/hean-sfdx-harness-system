# "What was Done?" Bullet Rules

Release champions and reviewers read these bullets. They glance at each one for a few seconds. Each bullet tells them, in one short sentence, the core of what the branch fixed and then what that fix solves. The story link serves the few readers who want more.

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

- Write each bullet in two parts, in this order: the core of what the branch fixed, then what that fix solves.
- **The core** is the one change that makes the fix work, named by the part that changed and what it now does: "Force `ABC_RepoFactory` to add requested fields to cache". Name the class, flow or component that changed when it is that part.
- Describe no technique below the core: no line, method body, query text, CSS rule or attribute value, and no "added a class" or "moved the query".
- **What it solves** is the problem from the story, named by what the app's user sees on the screen: "the Status dropdown", "the Save Changes button", "creating a work order". Use the story's own words for them when the story has them.
- For a delivered request rather than a fix, the core is what was built and the second part is what the user can now do.
- Wrap every code element a bullet names in backticks.
- State the fact, not a defense of it. A bullet never argues against a hypothetical reviewer objection, such as "...so this is expected, not a leftover file".
- Files matching no requirement (for example `.claude/` config) → one trailing bullet: "Project configuration was updated". This fixed bullet keeps this exact text and is exempt from the Sentence form rules below.

### Sentence form

- Keep each bullet to one line of at most 20 words.
- Write one sentence: "{core of the fix}, so {what it solves}".
- Start the core with an imperative verb, the same form as a commit subject: "Force", "Stop", "Limit", "Add".
- Write what it solves in the "no longer" or "now" form.
- Use no semicolon and no clause that explains how the fix works.
- Use plain words: no jargon, no idiom, no figurative phrase.

### Example

A story where creating a work order failed because a shared repository cache dropped the fields a class asked for. The story's title names the core of the fix: "Force `ABC_RepoFactory` to add requested fields to cache".

- Right: "Force `ABC_RepoFactory` to add requested fields to cache, so creating a work order no longer fails"
- Wrong, outcome only: "Creating a work order no longer fails with a `WorkOrderNumber` error"
- Wrong, technique: "`ABC_RepoFactory.getRepo` now calls `addParentFields` with an empty parent list after the facade returns the repository"

A story about two clicks and a clipped dropdown on the appointment detail page:

- Right: "Stop the appointment detail page from clipping its content, so the Status dropdown is no longer cut off"
- Right: "Limit the Save Changes click area to the button, so clicking beside it no longer saves the appointment"
- Wrong, technique: "Removed the `slds-scrollable_none` class from the `mycustomWorkDetailPage` content container, whose overflow clip cut off the open Status dropdown at the footer's top edge; the inner line-clamp usage of that class is unchanged"

A story about code itself, where the story asks to stop a query running inside a loop:

- Right: "Move the `AccountService` query out of its loop, so loading many accounts no longer hits the query limit"
- Wrong, technique: "Moved the SOQL query in `AccountService.getAccounts` above the for loop into a Map"

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
