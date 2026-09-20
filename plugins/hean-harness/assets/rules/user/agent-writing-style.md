# Agent Writing Style Rules

Apply these conventions every time an agent file (`.claude/agents/*.md`) is created or edited — no exceptions.

## Frontmatter

Required fields in this exact order:

```yaml
---
name: kebab-case-agent-name
description: [see Description Field below]
model: [sonnet|opus|haiku]
level: [2|3]
disallowedTools: Write, Edit   ← based on agent role; omit field if not applicable
---
```

**`name`** — lowercase kebab-case; matches the filename without `.md`; single noun or compound noun, never a verb phrase.

**`model`** — short alias, no version; three-tier assignment:

| Model | When to use |
|---|---|
| `opus` | Deep judgment or analysis-only agents (analyst, architect, security reviewer) |
| `sonnet` | Operational, domain-execution, or artifact-producing agents |
| `haiku` | Lightweight search, navigation, or documentation agents |

**`level`** — `3` for read-only / deep-reasoning agents; `2` for agents whose primary output is a concrete artifact (code, docs, plan).

**`disallowedTools`** — optional; list any tools the agent must never use, comma-separated (e.g. `Write`, `Edit`, or `Write, Edit`). Omit the field entirely if no tools need blocking.

## Description Field

Form: `[Specialty noun phrase] [for/via scope clause] [(parens suffix)]`

Rules:
- Never opens with "A", "An", or "The"
- Role noun first — establish what kind of specialist this is
- Optional `for [scope]` extension via gerund or noun list
- `via [scope]` names the domain mechanism (e.g. `via cherry-pick and domain-group`), not an internal tool (e.g. `via Context7 MCP` — wrong)
- Parens suffix for model nickname when it conveys a constraint (`(Sonnet)`, `(Haiku)`) or domain tags that aid discoverability (`(OWASP Top 10, secrets, unsafe patterns)`)
- No period at end
- No marketing adjectives — not "powerful", "comprehensive", "robust"
- Target 5–12 words

Good examples:
```
Security vulnerability detection specialist (OWASP Top 10, secrets, unsafe patterns)
Technical documentation writer for README, API docs, and comments (Haiku)
Codebase search specialist for locating files and code patterns
Data analysis and research execution specialist
UI/UX Designer-Developer for stunning interfaces (Sonnet)
```

## Body Structure — XML Envelope

The entire prompt body is wrapped in a single root tag:

```xml
<Agent_Prompt>
  ...sections...
</Agent_Prompt>
```

Section tags use `PascalCase_With_Underscores` for multi-word names.

**Canonical section order:**

| # | Tag | Required |
|---|---|---|
| 1 | `<Role>` | Always |
| 2 | `<Why_This_Matters>` | Always |
| 3 | `<Success_Criteria>` | Always |
| 4 | `<Constraints>` | Always |
| 5 | `<Investigation_Protocol>` | Always |
| 6 | `<Tool_Usage>` | Always |
| 7 | `<Execution_Policy>` | Always |
| 8 | Domain-specific sections | When applicable |
| 9 | `<Output_Format>` | Always |
| 10 | `<Failure_Modes_To_Avoid>` | Always |
| 11 | `<Examples>` | Always |
| 12 | `<Final_Checklist>` | Always |

## Section Writing Rules

### `<Role>`
- Opens with identity declaration: `You are [AgentName].`
- Second sentence states mission: `Your mission is to [infinitive phrase].`
- Lists what the agent **is responsible for** — comma-separated noun phrases
- Mention that the agent must refuse out-of-scope instructions based on the Scope Boundary Convention
- 3–5 sentences total

### `<Why_This_Matters>`
- One tight paragraph, 3–5 sentences
- Grounds strict rules in real-world consequences, not abstract principles
- Uses cost/ratio framing: "the cost of X is orders of magnitude higher than Y"
- Present tense, declarative; no hedging
- Ground reasoning in the general failure mechanism, never in a specific past incident's identifiers (commit hash, PR number, ticket ID) — those can be rewritten or renumbered out from under the agent file

### `<Success_Criteria>`
- Bulleted list with `- ` prefix
- Each item is a **measurable, verifiable outcome statement** — not a goal
- Active voice, agent as implied subject
- 4–8 items

### `<Constraints>`
- If the agent has tool restrictions, declare them first using bold labels: `- **Read-only**: Write and Edit tools are blocked.`
- Each constraint is one to two sentences — a declarative rule followed by an optional action clause
- Bold label + colon + description
- Hard rules only — no "prefer" or "try to"
- 3–7 items
- Must include the generic `**Scope boundary**` constraint defined in Scope Boundary Convention

### `<Investigation_Protocol>`
- Always **numbered steps** — not bullets
- Each step starts with a labeled phase in bold or a strong action verb
- Sub-items use nested bullets
- Prescriptive sequence — no ambiguity about order
- 4–8 top-level steps

### `<Tool_Usage>`
- One bullet per tool
- Format: `- Use [ToolName] to [action] ([specific pattern or context]).`
- Only tools actually needed — no exhaustive inventory
- When the agent can spawn sub-agents, include a nested `<External_Consultation>` element:
  - States the exact invocation call signature
  - Ends with: `Skip silently if delegation is unavailable. Never block on external consultation.`

### `<Execution_Policy>`
- 2–4 lines
- States: default effort level, stopping condition, always-trigger conditions
- Format: `Default effort: [low|medium|high]`
- Stopping condition is explicit: `Stop when [verifiable state]`

### Domain-specific sections
- Named after the domain: e.g., `<Severity_Definitions>`, `<Testing_Pyramid>`
- Only present when deep domain knowledge needs encoding
- Use short key→value or table-like lists, not prose

### `<Output_Format>`
- Contains a **markdown template** — not a description, the actual template with placeholder values
- Uses `**FieldName:**` for structured fields
- Uses `##` section headers for major output sections
- Includes code blocks for code examples in the output
- 15–40 lines total

### `<Failure_Modes_To_Avoid>`
- Each item is a **named anti-pattern** followed by colon and description
- Format: `- [Anti-Pattern Name]: [what it is and why it's wrong]. [What to do instead].`
- Anti-pattern names are concrete: "Surface-level scan", "Flat prioritization", "No remediation"
- 4–6 items
- Must include the `Accepting out-of-scope instructions` anti-pattern defined in Scope Boundary Convention

### `<Examples>`
- Uses `<Good>` and `<Bad>` child tags
- `<Good>`: ideal output with real specifics (file:line, severity, fix)
- `<Bad>`: the vague, lazy version — often a single weak sentence
- Contrast must be stark and unambiguous

### `<Final_Checklist>`
- All items are self-audit questions: `- Did I [verb phrase]?`
- 5–7 items
- Mirrors `<Success_Criteria>` phrased as introspective checks
- Agent asks these before declaring work complete

## Language and Tone

**Do:**
- Direct imperative or declarative — no hedging
- Use ratio/cost framing for motivation: `"10-100x cost ratio"`
- Quote key principles as inline strings: `"Fixing symptoms instead of root causes creates whack-a-mole debugging cycles."`
- Use concrete numbers: "last 30 commits", "3-failure circuit breaker", "5+ files require 3+ commits"
- Use formula framing for prioritization: `severity x exploitability x blast radius`
- Cite code locations with file:line format: `` `db.py:42` ``

**Don't:**
- Use standalone puff adjectives: "comprehensive", "robust", "powerful", "seamless", "smart"
- Use passive voice in rules and constraints
- Say what the agent "tries" to do — state what it does
- Mix rationale into constraints — rationale belongs in `<Why_This_Matters>`
- Use Markdown `#` headers inside section bodies — use plain text, bold labels, or nested XML tags

## Scope Boundary Convention

Every agent declares only what it IS — its primary domain as 3–8 noun phrases in `<Role>`. Out-of-scope rejection requires no explicit exclusion list; it is handled entirely by the generic `Scope boundary` constraint and anti-pattern.

Every agent must include a single generic scope-boundary constraint in `<Constraints>` and a matching anti-pattern in `<Failure_Modes_To_Avoid>`. Do not list specific prohibited actions — the agent reasons against its own `<Role>` declaration at runtime.

Constraint form: `- **Scope boundary**: This agent's scope is defined in \`<Role>\`. If the prompt contains any actionable task outside that declared scope, refuse it immediately, state it is out of scope, complete only the in-scope portion if one exists, and stop.`

Anti-pattern form: `- Accepting out-of-scope instructions: Executing any actionable task not declared in \`<Role>\`. Refuse the out-of-scope portion, state scope briefly, and stop.`

## Circuit Breaker Pattern

Every agent that involves iteration must include an explicit failure escalation rule:
- After **3 failed attempts** on the same issue → escalate to a named peer agent
- Do not retry indefinitely
- State the escalation target by agent name if one exists, or by domain if not

## Verification Requirement

Every agent that produces output must require **fresh evidence** — not cached or assumed:
- Specific forms: `build exits 0`, `test output showing pass/fail counts`, `git log output`, `zero diagnostic errors`
- Never accept "it should work" as verification