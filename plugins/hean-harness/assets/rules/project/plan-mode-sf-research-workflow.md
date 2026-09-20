# Plan Mode: SF Research and Normalization Workflow

Apply during plan mode for any Salesforce metadata, LWC, Apex, Flow, or configuration change — before Phase 2 (Design).

## Source Tiers

Classify every finding into exactly one tier before recording it. Tier determines citation format and enforcement rules.

| Tier | Source type | How to obtain |
|------|-------------|---------------|
| 1 | Programmatic source retrieved from the org | `sf project retrieve start --metadata "<Type>:<Name>" --ignore-conflicts -o <alias>` |
| 2 | Declarative metadata retrieved from the org | `sf project retrieve start --metadata "<Type>:<Name>" --ignore-conflicts -o <alias>` |
| 3 | Official Salesforce docs via Context7 | `mcp__context7__get-library-docs` result — record library slug, topic, and API version |
| 4 | Official Salesforce docs URL | developer.salesforce.com URL — record full URL and API version |
| 5 | Third-party library source at a fixed version | GitHub repo, tag, file, and line number |
| 6 | Naming convention reasoning | NOT VERIFIED — automatic uncertainty |
| 7 | Training data inference | NOT VERIFIED — automatic uncertainty |

**Citation format:** `[T<n>: <identifier> | <version-or-date>]`

- T1: `[T1: ApexClass:fflib_QueryFactory@<org-alias> | retrieved 2026-04-12]`
- T2: `[T2: Flow:Field_Service_Screenflow_Create@<org-alias> | retrieved 2026-04-12]`
- T3: `[T3: context7/salesforce-apex | topic "QueryFactory setCondition", API v65.0]`
- T4: `[T4: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/… | API v65.0]`
- T5: `[T5: github.com/apex-enterprise-patterns/fflib-apex-common@v2.0.0 | fflib_QueryFactory.cls:142]`
- T6: `[T6: naming-convention | NOT VERIFIED]`
- T7: `[T7: training-inference | NOT VERIFIED]`

## Enforcement Gate

Tier 6 and Tier 7 citations are automatically unresolved uncertainties. Apply the same rules as any other unresolved uncertainty: block normalization and block the `developer` agent until each is upgraded to Tier 1–5. Do not treat Tier 6/7 as low-risk or acceptable for any constraint claim.

## Research Phase

1. Identify the key platform mechanisms in the user's request: Flow element types, LWC property constraints, Apex patterns, metadata field requirements, API version behavior.
2. Assign Tier 7 to every finding as a starting state — nothing is verified until a source is retrieved.
3. For each mechanism, call `mcp__context7__resolve-library-id` then `mcp__context7__get-library-docs` with a targeted topic filter. On success, record the finding with a Tier 3 citation including the API version returned.
4. For any behavior that cannot be confirmed by documentation alone, retrieve the relevant artifact from the org using `sf project retrieve start --metadata "<Type>:<Name>" --ignore-conflicts -o <alias>`. Programmatic source upgrades to Tier 1; declarative metadata upgrades to Tier 2. Record the citation with today's date.
5. After each round, list every finding with its current tier and citation. Flag any finding still at Tier 6 or Tier 7.
6. For each unresolved uncertainty or Tier 6/7 finding, run another research round targeting that specific gap.
7. Repeat up to **5 rounds total**. If a finding remains at Tier 6/7 or an uncertainty survives round 5, escalate — do not normalize and do not proceed to design.

## Uncertainty Escalation

When any uncertainty is unresolved after 5 rounds, or when a Tier 6/7 finding cannot be upgraded:
- Use `AskUserQuestion` to surface each open item explicitly.
- State: the claim, its current tier and citation, what retrieval or documentation search was attempted, and what information is needed from the user to resolve it.
- Do not write or finalize the plan.
- Do not invoke the `developer` agent.
- Resume only after the user has resolved all outstanding items.

## Normalization

After all uncertainties are resolved and every finding carries a Tier 1–5 citation, rewrite the plan file as a developer-ready brief using these required sections:

- **Context** — one paragraph: why the change is needed and what it achieves
- **Files** — exact file paths to modify
- **Elements to add** — typed and named: `IsNewContact (Boolean variable, default false)`, not "a variable"
- **Changes to existing elements** — table: element name | current wiring target | new wiring target
- **Platform constraints confirmed** — one bullet per finding with inline citation: `[T<n>: <identifier> | <version-or-date>]`
- **Verification** — how to confirm the change works end-to-end

Format rules:
- Imperative voice only — no exploration prose, no alternatives, no hedging
- Every element that connects to another names the target explicitly
- Every constraint traces to a Tier 1–5 source; Tier 6/7 citations are not permitted in a normalized plan
- No finding appears without its inline citation bracket

## Developer Handoff

Pass the normalized plan verbatim as the `developer` agent's input prompt. Do not summarize or paraphrase the normalized text.